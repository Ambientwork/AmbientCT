import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react';
import { cache, volumeLoader } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import { Colors, Font } from '../utils/designTokens';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { ProjectionMode } from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper/Constants';
import { buildCenterline, buildCenterlinePoints } from '../utils/buildCenterline';
import type { CenterlinePoint } from '../utils/buildCenterline';
import { setSharedFrames, setSharedArcData, getSharedTotalArcMm } from '../utils/dentalState';
import { ARCH_SPLINE_COMPLETED } from '../tools/DentalArchSplineTool';
import {
  ARCH_CROSS_SECTION_POSITION,
  ARCH_NAVIGATE_DELTA,
  CROSS_SECTION_STEP,
} from './DentalCrossSectionViewport';
import type { CrossSectionEventDetail } from './DentalCrossSectionViewport';

interface DentalCPRViewportProps {
  viewportId: string;
  displaySets: any[];
  servicesManager: any;
  extensionManager: any;
  commandsManager: any;
}

type RenderStatus = 'waiting' | 'rendering' | 'ready' | 'error';

/**
 * DentalCPRViewport
 *
 * Custom OHIF viewport that renders a Curved Planar Reformation (CPR)
 * panoramic reconstruction from a CBCT volume.
 *
 * Data flow:
 *   User draws arch spline in axial view
 *   → ARCH_SPLINE_COMPLETED event fires
 *   → buildCenterline() converts points to vtkPolyData
 *   → vtkImageCPRMapper generates the panoramic plane
 *   → vtk.js renders it in this viewport's WebGL canvas
 */
export default function DentalCPRViewport({
  viewportId,
  displaySets,
  servicesManager,
}: DentalCPRViewportProps) {
  const vtkContainerRef = useRef<HTMLDivElement>(null);

  // vtk.js objects kept in refs (not React state — no re-render on change)
  const rendererRef = useRef<ReturnType<typeof vtkRenderer.newInstance> | null>(null);
  const renderWindowRef = useRef<ReturnType<typeof vtkRenderWindow.newInstance> | null>(null);
  const openGLWindowRef = useRef<ReturnType<typeof vtkOpenGLRenderWindow.newInstance> | null>(null);
  const actorRef = useRef<ReturnType<typeof vtkImageSlice.newInstance> | null>(null);
  const mapperRef = useRef<ReturnType<typeof vtkImageCPRMapper.newInstance> | null>(null);

  const [status, setStatus] = useState<RenderStatus>('waiting');
  const [statusMsg, setStatusMsg] = useState(
    'Click to place control points along the dental arch on the axial view. Double-click to complete.'
  );
  const [slabMm, setSlabMm] = useState(10);

  // Spline frames stored after each arch completion — used for cross-section clicks
  const splineFramesRef   = useRef<CenterlinePoint[]>([]);
  // Arc-length fractions[i] = cumulative arc from 0→i / total arc (0..1)
  const arcFractionsRef   = useRef<Float32Array>(new Float32Array(0));
  // Total arch arc-length in mm — stored so the ResizeObserver can recompute image bounds
  const arcLengthMmRef    = useRef<number>(0);

  // Cross-section cursor position as arc-fraction (0-1) — state for rendering, ref for event handlers
  const [cursorArcFrac, setCursorArcFrac] = useState<number | null>(null);
  const cursorArcFracRef = useRef<number>(0.5);

  // Sample index of the active cross-section — used for cursor rendering (not arc-fraction)
  const [cursorSampleIdx, setCursorSampleIdx] = useState<number | null>(null);
  const cursorSampleIdxRef = useRef<number>(150);

  // Image bounds within the div [0–100 %] — updated after each CPR render and resize.
  // Accounts for the fact that the vtk.js camera may leave horizontal margins when
  // fitting the depth (scan height) rather than the arch length.
  const cprImageBoundsRef = useRef<{ leftPct: number; rightPct: number }>({ leftPct: 0, rightPct: 100 });
  // State copy of image bounds — drives slider positioning (ref alone won't re-render)
  const [cprImgBounds, setCprImgBounds] = useState<{ leftPct: number; rightPct: number }>({ leftPct: 0, rightPct: 100 });

  // Navigate cross-section via slider, click, drag, or wheel.
  // `pct` is a div-% (0-100).  Maps through image bounds → sample index.
  const navigateArch = useCallback((pct: number) => {
    const frames = splineFramesRef.current;
    const fracs  = arcFractionsRef.current;
    if (!frames.length) return;

    const { leftPct, rightPct } = cprImageBoundsRef.current;
    const imgWidthPct = rightPct - leftPct;

    // Map div-% to image-column fraction (arc-length space, not index space).
    // vtk.js CPR mapper places columns by cumulative arc-length, so we must
    // binary-search arcFracs to convert column fraction → sample index.
    const colFrac = imgWidthPct > 1
      ? Math.max(0, Math.min(1, (pct - leftPct) / imgWidthPct))
      : Math.max(0, Math.min(1, pct / 100));

    let idx: number;
    if (fracs.length >= frames.length) {
      let lo = 0, hi = frames.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fracs[mid] < colFrac) lo = mid + 1;
        else hi = mid;
      }
      idx = lo;
    } else {
      idx = Math.round(colFrac * (frames.length - 1));
    }
    idx = Math.max(0, Math.min(frames.length - 1, idx));
    cursorSampleIdxRef.current = idx;
    setCursorSampleIdx(idx);

    const frac = fracs.length > idx ? fracs[idx] : colFrac;
    cursorArcFracRef.current = frac;
    setCursorArcFrac(frac);

    window.dispatchEvent(new CustomEvent(ARCH_CROSS_SECTION_POSITION, {
      detail: { frame: frames[idx], splineIndex: idx, numSamples: frames.length },
    }));
  }, []);

  // Compute image bounds (leftPct / rightPct of div) analytically from camera state.
  // The CPR mapper in straightened mode outputs an image spanning exactly arcLengthMm
  // in world-Y, centered at the camera focal point.  No actor.getBounds() needed —
  // that vtk.js call is unreliable for the CPR mapper output image.
  const computeImageBounds = useCallback((arcLenMm: number) => {
    const renderer  = rendererRef.current;
    const container = vtkContainerRef.current;
    if (!renderer || !container || arcLenMm <= 0) return;
    const camera = renderer.getActiveCamera();
    const vpW = container.clientWidth  || 1;
    const vpH = container.clientHeight || 1;
    const A   = vpW / vpH;
    const ps  = camera.getParallelScale();
    // visibleYWidth = 2 * ps * A  (total world-Y units visible across the div)
    // imageFraction = arcLenMm / visibleYWidth  (what fraction of the div the image fills)
    const visibleYWidth = 2 * ps * A;
    const margin = (visibleYWidth - arcLenMm) / 2;
    const leftPct  = Math.max(0, (margin / visibleYWidth) * 100);
    const rightPct = Math.min(100, 100 - leftPct);
    if (rightPct > leftPct) {
      cprImageBoundsRef.current = { leftPct, rightPct };
      setCprImgBounds({ leftPct, rightPct });
    }
  }, []);

  // ── VTK pipeline initialisation ──────────────────────────────────────────
  useEffect(() => {
    const container = vtkContainerRef.current;
    if (!container) return;

    // WebGL availability check — vtk.js will throw if WebGL is absent
    const testCanvas = document.createElement('canvas');
    const hasWebGL = !!(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'));
    if (!hasWebGL) {
      setStatus('error');
      setStatusMsg('WebGL not available in this browser. Use Chrome or Firefox with hardware acceleration enabled.');
      return;
    }

    let renderWindow: ReturnType<typeof vtkRenderWindow.newInstance>;
    let openGLWindow: ReturnType<typeof vtkOpenGLRenderWindow.newInstance>;
    let interactor: ReturnType<typeof vtkRenderWindowInteractor.newInstance>;

    try {
      renderWindow = vtkRenderWindow.newInstance();
      const renderer = vtkRenderer.newInstance({ background: [0.04, 0.04, 0.04] });
      renderWindow.addRenderer(renderer);

      openGLWindow = vtkOpenGLRenderWindow.newInstance();
      openGLWindow.setContainer(container);
      const initW = container.clientWidth  || 700;
      const initH = container.clientHeight || 450;
      openGLWindow.setSize(initW, initH);
      renderWindow.addView(openGLWindow);

      // Constrain the vtk.js canvas CSS so it never expands the container
      const glCanvas = container.querySelector('canvas');
      if (glCanvas) {
        glCanvas.style.width  = '100%';
        glCanvas.style.height = '100%';
      }

      interactor = vtkRenderWindowInteractor.newInstance();
      interactor.setView(openGLWindow);
      interactor.initialize();
      interactor.bindEvents(container);

      rendererRef.current = renderer;
      renderWindowRef.current = renderWindow;
      openGLWindowRef.current = openGLWindow;
    } catch (initErr: unknown) {
      const msg = initErr instanceof Error ? initErr.message : String(initErr);
      console.error('[DentalCPR] VTK init error:', initErr);
      setStatus('error');
      setStatusMsg(`VTK/WebGL init failed: ${msg}`);
      return;
    }

    // Resize observer — keep vtk canvas in sync with container.
    // Guard against zero/huge sizes to avoid vtk.js canvas runaway.
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        if (w < 10 || h < 10 || h > 10000) continue;
        openGLWindow.setSize(w, h);
        renderWindow.render();
        computeImageBounds(arcLengthMmRef.current);
      }
    });
    observer.observe(container);

    // Drag on panoramic → continuously update cross-section position
    let isDragging = false;
    const getPctFromMouseEvent = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!splineFramesRef.current.length) return;
      isDragging = true;
      navigateArch(getPctFromMouseEvent(e));
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !splineFramesRef.current.length) return;
      navigateArch(getPctFromMouseEvent(e));
    };
    const onMouseUp = () => { isDragging = false; };

    // Wheel on panoramic → step through cross-sections by sample index
    const onWheel = (e: WheelEvent) => {
      const N = splineFramesRef.current.length;
      if (!N) return;
      e.preventDefault();
      const step = e.deltaY > 0 ? 2 : -2;
      const newIdx = Math.max(0, Math.min(N - 1, cursorSampleIdxRef.current + step));
      const { leftPct, rightPct } = cprImageBoundsRef.current;
      const wFracs = arcFractionsRef.current;
      const wArcFrac = wFracs.length > newIdx ? wFracs[newIdx] : newIdx / Math.max(N - 1, 1);
      navigateArch(leftPct + wArcFrac * (rightPct - leftPct));
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      observer.disconnect();
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
      interactor?.unbindEvents(container);
      openGLWindow?.delete();
      renderWindow?.delete();
    };
  }, []);

  // ── Pre-load CBCT volume as soon as displaySets are available ────────────
  // The axial viewport runs as a Stack viewport (slice-by-slice) and never
  // creates a vtkImageData. vtkImageCPRMapper needs a full vtkImageData, so
  // we create and load the volume here explicitly via Cornerstone3D's
  // volumeLoader. By the time the user finishes drawing the arch (~10–30 s),
  // the volume is ready.
  useEffect(() => {
    const ds = displaySets?.[0];
    if (!ds) return;

    // Collect imageIds — OHIF stack displaySets expose them as ds.imageIds
    // (flat string array) or ds.images[].imageId (legacy format).
    const imageIds: string[] =
      (ds.imageIds as string[] | undefined) ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((ds.images as any[] | undefined)?.map((img: any) => img.imageId as string) ?? []);

    if (!imageIds.length) {
      console.warn('[DentalCPR] No imageIds on displaySet — volume pre-load skipped');
      return;
    }

    const volumeId = `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;

    // Skip if already in cache with imageData
    const existing = cache.getVolume(volumeId);
    if (existing?.imageData) {
      console.log('[DentalCPR] Volume already loaded:', volumeId);
      return;
    }

    setStatusMsg('Loading CBCT volume… draw arch when slices appear in axial view.');
    console.log('[DentalCPR] Pre-loading volume', volumeId, '—', imageIds.length, 'slices');

    volumeLoader
      .createAndCacheVolume(volumeId, { imageIds })
      .then((vol: Types.IImageVolume) => {
        vol.load();
        console.log('[DentalCPR] Volume streaming started:', volumeId);
        setStatusMsg(
          'Click to place control points along the dental arch on the axial view. Double-click to complete.'
        );
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[DentalCPR] Volume pre-load failed:', msg);
        setStatusMsg(
          'Click to place control points along the dental arch on the axial view. Double-click to complete.'
        );
      });
  }, [displaySets]);

  // ── Get volume from Cornerstone3D cache ──────────────────────────────────
  const getVolume = useCallback(() => {
    if (!displaySets?.length) return null;
    const ds = displaySets[0];

    // 1. Try explicit volumeId set by 3D SOP class handler (UUID-based)
    if (ds.volumeId) {
      const vol = cache.getVolume(ds.volumeId);
      if (vol) return vol;
    }

    // 2. Try derived from displaySetInstanceUID (OHIF stack handler)
    const derivedId = `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;
    const volByDerived = cache.getVolume(derivedId);
    if (volByDerived) return volByDerived;

    // 3. Scan cache for volume whose imageIds reference this SeriesInstanceUID.
    //    Handles UUID volumeIds generated by the 3D SOP class handler at runtime.
    const seriesUID: string | undefined = ds.SeriesInstanceUID;
    if (seriesUID) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const volumeCache = (cache as any)._volumeCache as Map<string, any> | undefined;
      if (volumeCache) {
        for (const [, vol] of volumeCache) {
          if (
            vol?.metadata?.SeriesInstanceUID === seriesUID ||
            (vol?.imageIds?.[0] as string | undefined)?.includes(seriesUID)
          ) {
            return vol;
          }
        }
      }
    }

    return null;
  }, [displaySets]);

  // ── CPR reconstruction ───────────────────────────────────────────────────
  const renderCPR = useCallback(
    (controlPoints: Types.Point3[]) => {
      if (controlPoints.length < 3) {
        setStatusMsg('Need at least 3 control points — keep drawing.');
        return;
      }

      const volume = getVolume();
      if (!volume?.imageData) {
        setStatusMsg('CBCT volume not loaded yet — wait for the series to finish loading.');
        setStatus('error');
        return;
      }

      // Populate scalars BEFORE renderer check — Cornerstone3D v2+ uses VoxelManager
      // and does NOT populate vtkImageData scalars. vtkImageCPRMapper needs them.
      const imgData = volume.imageData;
      if (imgData && !imgData.getPointData().getScalars() && (volume as any).voxelManager) {
        try {
          const rawScalars = (volume as any).voxelManager.getCompleteScalarDataArray();
          if (rawScalars?.length) {
            const scalarArr = vtkDataArray.newInstance({
              name: 'Scalars',
              values: rawScalars,
              numberOfComponents: 1,
            });
            imgData.getPointData().setScalars(scalarArr);
            imgData.modified();
            console.log('[DentalCPR] Populated', rawScalars.length, 'scalars from VoxelManager');
          }
        } catch (scalarErr) {
          console.warn('[DentalCPR] Scalar population failed:', (scalarErr as Error).message);
        }
      }

      const renderer = rendererRef.current;
      const renderWindow = renderWindowRef.current;
      if (!renderer || !renderWindow) return;

      setStatus('rendering');
      setStatusMsg('Generating panoramic reconstruction…');

      // Remove previous actor
      if (actorRef.current) {
        renderer.removeActor(actorRef.current);
        actorRef.current = null;
        mapperRef.current = null;
      }

      try {
        const NUM_SAMPLES = 300;

        // Normalise all control points to the median Z so the arch stays flat in
        // a single axial plane.  Without this, points placed on different slices
        // make the centerline undulate in Z, causing each CPR column to sample a
        // different depth region and the panoramic to show uneven vertical height.
        const sortedZ = [...controlPoints].map(p => p[2]).sort((a, b) => a - b);
        const medianZ = sortedZ[Math.floor(sortedZ.length / 2)];
        const flatPoints = controlPoints.map(p => [p[0], p[1], medianZ] as Types.Point3);

        // Build Catmull-Rom centerline polydata (300 samples for smooth panoramic)
        const centerline = buildCenterline(flatPoints, NUM_SAMPLES);
        // Also store frames for cross-section click events
        const cprFrames = buildCenterlinePoints(flatPoints, NUM_SAMPLES);
        splineFramesRef.current = cprFrames;
        setSharedFrames(cprFrames);

        // Compute cumulative arc lengths (mm) and normalised fractions.
        // These are stored globally so cross-section viewports can show real mm positions.
        const cumArc = new Float32Array(cprFrames.length);
        let arcLengthMm = 0;
        for (let i = 1; i < cprFrames.length; i++) {
          const [x0, y0, z0] = cprFrames[i - 1].point;
          const [x1, y1, z1] = cprFrames[i].point;
          arcLengthMm += Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
          cumArc[i] = arcLengthMm;
        }
        // Normalise to 0-1
        const arcFracs = new Float32Array(cprFrames.length);
        for (let i = 0; i < cprFrames.length; i++) {
          arcFracs[i] = arcLengthMm > 0 ? cumArc[i] / arcLengthMm : i / (cprFrames.length - 1);
        }
        arcFractionsRef.current = arcFracs;
        arcLengthMmRef.current  = arcLengthMm;
        setSharedArcData(arcFracs, arcLengthMm);

        // Camera geometry (with viewUp=[1,0,0]):
        //   screen-vertical  = world-X = tooth depth (crown → root)
        //   screen-horizontal = world-Y = arch arc-length
        //
        // Strategy: fit the FULL arch into the panel width, then set mapper.setWidth()
        // to exactly the tooth depth that fills the panel height at that zoom.
        // This guarantees both axes fill the viewport with no wasted space.
        //
        //   parallelScale = arcLength / (2 × aspectRatio)   ← fills width
        //   depthMm       = parallelScale × 2               ← exactly fills height
        const container = vtkContainerRef.current;
        const vpW = container?.clientWidth  || 700;
        const vpH = container?.clientHeight || 400;
        const aspectRatio = Math.max(vpW / vpH, 0.1);

        // archScale: minimum parallelScale needed to fit the full arch width on screen
        const archScale = (arcLengthMm / (2 * aspectRatio)) * 1.05;

        // depthMm: dental CPR depth (crown to root tips).
        // Using the full scan height wastes viewport space on empty air above/below teeth.
        // Fit arch width first, let depth fill the remaining height.
        const depthMm = Math.max(archScale * 2, 40);

        // parallelScale must be ≥ archScale (fits arch) AND ≥ depthMm/2 (shows full height).
        const parallelScale = Math.max(archScale, depthMm / 2);

        // Wire vtkImageCPRMapper
        const mapper = vtkImageCPRMapper.newInstance();
        mapper.setImageData(imgData ?? volume.imageData); // port 0 — CBCT volume
        mapper.setCenterlineData(centerline);       // port 1 — arch centerline

        mapper.useStraightenedMode();
        mapper.setWidth(depthMm); // exactly fills the panel height
        mapper.setOrientationArrayName('Orientation');
        mapper.setUseUniformOrientation(false);

        (mapper as any).setTangentDirection([1, 0, 0]);   // tooth depth = world-X = screen-vertical
        (mapper as any).setBitangentDirection([0, 0, 1]); // buccal-lingual = MIP slab
        (mapper as any).setNormalDirection([0, 1, 0]);    // arch tangent = world-Y = screen-horizontal

        // MIP slab along buccal-lingual — simulates panoramic focal trough
        mapper.setProjectionSlabThickness(slabMm);
        mapper.setProjectionSlabNumberOfSamples(slabMm * 5 + 1); // must be odd
        mapper.setProjectionMode(ProjectionMode.MAX);

        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);
        actor.getProperty().setColorWindow(3000);
        actor.getProperty().setColorLevel(800);

        renderer.addActor(actor);

        const camera = renderer.getActiveCamera();
        camera.setParallelProjection(true);

        // Step 1: first render so the CPR mapper computes its output image.
        renderWindow.render();

        // Step 2: manually fit camera to the CPR image bounds.
        // vtk.js resetCamera() uses the bounding SPHERE which wastes ~50% of
        // the viewport for elongated images.  We compute a tight-fit instead.
        //
        // With viewUp=[1,0,0]:
        //   screen-vertical  = world-X (depth, range depthMm)
        //   screen-horizontal = world-Y (arch, range arcLengthMm)
        //
        // parallelScale = half of the visible world-height (world-X).
        // We need:  2*ps >= depthMm  AND  2*ps*aspect >= arcLengthMm
        //   ⟹  ps >= max(depthMm/2, arcLengthMm/(2*aspect))
        const tightScale = Math.max(depthMm / 2, arcLengthMm / (2 * aspectRatio)) * 1.05;

        camera.setViewUp(1, 0, 0);
        renderer.resetCamera();            // sets focal point + position correctly
        camera.setParallelScale(tightScale); // override the loose bounding-sphere scale
        renderer.resetCameraClippingRange();
        renderWindow.render();
        computeImageBounds(arcLengthMm); // update image bounds after camera is finalised

        console.log('[DentalCPR] CPR rendered — arc:', Math.round(arcLengthMm), 'mm',
          '| depthMm:', Math.round(depthMm),
          '| actor bounds:', actor.getBounds?.().map((v: number) => v.toFixed(1)).join(','),
          '| parallelScale:', camera.getParallelScale?.().toFixed(1));

        actorRef.current = actor;
        mapperRef.current = mapper;
        setStatus('ready');
        setStatusMsg(
          `Panoramic ready — ${Math.round(arcLengthMm)} mm arch length. ` +
          'Draw a new arch to update.'
        );

        // Auto-fire cross-section at arch midpoint (by arc-length) so cross-section
        // panels show something immediately without a user click
        const midFrac = 0.5;
        let midIdx = Math.floor(cprFrames.length / 2);
        { // binary-search arcFracs for midpoint
          let lo = 0, hi = arcFracs.length - 1;
          while (lo < hi) { const m = (lo+hi)>>1; if (arcFracs[m] < midFrac) lo=m+1; else hi=m; }
          midIdx = lo;
        }
        cursorSampleIdxRef.current = midIdx;
        setCursorSampleIdx(midIdx);
        cursorArcFracRef.current = midFrac;
        setCursorArcFrac(midFrac);
        window.dispatchEvent(
          new CustomEvent(ARCH_CROSS_SECTION_POSITION, {
            detail: {
              frame: cprFrames[midIdx],
              splineIndex: midIdx,
              numSamples: cprFrames.length,
            } as CrossSectionEventDetail,
          })
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[DentalCPR] Render error:', err);
        setStatus('error');
        setStatusMsg(`Render error: ${message}. See browser console.`);
      }
    },
    [getVolume, slabMm]
  );

  // ── Cursor line + keyboard navigation ───────────────────────────────────
  useEffect(() => {
    const handler = (evt: Event) => {
      const { splineIndex, numSamples } = (evt as CustomEvent<CrossSectionEventDetail>).detail;
      const fracs = arcFractionsRef.current;
      const frac  = fracs.length > splineIndex ? fracs[splineIndex] : splineIndex / Math.max(numSamples - 1, 1);
      cursorArcFracRef.current = frac;
      cursorSampleIdxRef.current = splineIndex;
      setCursorArcFrac(frac);
      setCursorSampleIdx(splineIndex);
    };
    window.addEventListener(ARCH_CROSS_SECTION_POSITION, handler);
    return () => window.removeEventListener(ARCH_CROSS_SECTION_POSITION, handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const N = splineFramesRef.current.length;
      if (!N) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -2 : 2;
      const newIdx = Math.max(0, Math.min(N - 1, cursorSampleIdxRef.current + step));
      const { leftPct, rightPct } = cprImageBoundsRef.current;
      const kFracs = arcFractionsRef.current;
      const kArcFrac = kFracs.length > newIdx ? kFracs[newIdx] : newIdx / Math.max(N - 1, 1);
      navigateArch(leftPct + kArcFrac * (rightPct - leftPct));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigateArch]);

  // Cross-section viewport wheel → step arch by index (delta = ±3 sample steps)
  useEffect(() => {
    const handler = (e: Event) => {
      const { delta } = (e as CustomEvent<{ delta: number }>).detail;
      const N = splineFramesRef.current.length;
      if (!N) return;
      const newIdx = Math.max(0, Math.min(N - 1, cursorSampleIdxRef.current + delta));
      const { leftPct, rightPct } = cprImageBoundsRef.current;
      const dFracs = arcFractionsRef.current;
      const dArcFrac = dFracs.length > newIdx ? dFracs[newIdx] : newIdx / Math.max(N - 1, 1);
      navigateArch(leftPct + dArcFrac * (rightPct - leftPct));
    };
    window.addEventListener(ARCH_NAVIGATE_DELTA, handler);
    return () => window.removeEventListener(ARCH_NAVIGATE_DELTA, handler);
  }, [navigateArch]);

  // ── Listen for completed arch spline ────────────────────────────────────
  useEffect(() => {
    const handler = (evt: Event) => {
      const { controlPoints } = (evt as CustomEvent).detail as {
        controlPoints: Types.Point3[];
      };
      renderCPR(controlPoints);
    };

    // TODO(v0.2): if two DentalCPRViewport instances exist simultaneously (split layout),
    // both will respond to this event. Add viewportId scoping when multi-panel CPR is needed.
    window.addEventListener(ARCH_SPLINE_COMPLETED, handler);
    return () => window.removeEventListener(ARCH_SPLINE_COMPLETED, handler);
  }, [renderCPR]);

  // ── Live slab thickness update ───────────────────────────────────────────
  useEffect(() => {
    const mapper = mapperRef.current;
    const renderWindow = renderWindowRef.current;
    if (!mapper || !renderWindow || status !== 'ready') return;

    mapper.setProjectionSlabThickness(slabMm);
    mapper.setProjectionSlabNumberOfSamples(slabMm * 5 + 1);
    renderWindow.render();
  }, [slabMm, status]);

  // ── Status colour helper ─────────────────────────────────────────────────
  const statusColour: Record<RenderStatus, string> = {
    waiting: Colors.textMuted,
    rendering: '#ffcc00',
    ready: '#00ff88',
    error: '#ff6b6b',
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0a',
        color: '#eee',
        fontFamily: Font.family,
        overflow: 'hidden',
      }}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          padding: '6px 12px',
          background: '#111',
          borderBottom: '1px solid #222',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
        }}
      >
        <span style={{ color: Colors.primary, fontWeight: 700, letterSpacing: '0.02em' }}>
          🦷 Panoramic CPR
        </span>

        <span
          style={{
            flex: 1,
            color: statusColour[status],
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: 11,
          }}
        >
          {statusMsg}
        </span>

        {/* Slab thickness */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, color: Colors.textMuted, fontSize: 11 }}>
          Slab
          <input
            type="range"
            min={1}
            max={40}
            value={slabMm}
            onChange={e => setSlabMm(Number(e.target.value))}
            style={{ width: 64, accentColor: Colors.primary }}
          />
          <span style={{ color: Colors.text, minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {slabMm}mm
          </span>
        </label>
      </div>

      {/* ── Arch navigation slider (shown once arch is drawn) ────────────── */}
      {status === 'ready' && (
        <div style={{
          flexShrink: 0,
          height: 28,
          position: 'relative',
          background: '#0d0d0d',
          borderBottom: '1px solid #1a1a1a',
        }}>
          {/* Slider track positioned exactly over the CPR image (left% … right%) */}
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={cursorSampleIdx !== null
              ? (arcFractionsRef.current.length > cursorSampleIdx
                  ? arcFractionsRef.current[cursorSampleIdx] * 100
                  : (cursorSampleIdx / Math.max((splineFramesRef.current.length || 1) - 1, 1)) * 100)
              : 50}
            onChange={e => {
              const pct = Number(e.target.value);
              const N = splineFramesRef.current.length || 1;
              const { leftPct, rightPct } = cprImageBoundsRef.current;
              navigateArch(leftPct + (pct / 100) * (rightPct - leftPct));
            }}
            style={{
              position: 'absolute',
              left: `${cprImgBounds.leftPct}%`,
              width: `${cprImgBounds.rightPct - cprImgBounds.leftPct}%`,
              top: '50%',
              transform: 'translateY(-50%)',
              accentColor: Colors.primary,
              cursor: 'pointer',
              margin: 0,
            }}
          />
          {/* mm readout — floated to far right, never overlaps slider area */}
          <span style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#555',
            fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
          }}>
            {Math.round((cursorArcFrac ?? 0.5) * getSharedTotalArcMm())}mm
          </span>
        </div>
      )}

      {/* ── VTK WebGL canvas ─────────────────────────────────────────────── */}
      <div
        ref={vtkContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          background: '#050505',
          cursor: status === 'ready' ? 'col-resize' : 'default',
        }}
      >
        {status === 'waiting' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              color: '#444',
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: 52 }}>🦷</div>
            <div
              style={{
                fontSize: 13,
                textAlign: 'center',
                maxWidth: 320,
                lineHeight: 1.7,
                color: '#555',
              }}
            >
              Click to place control points along the dental arch in the axial
              view.
              <br />
              Double-click to complete and generate the panoramic reconstruction.
            </div>
          </div>
        )}

        {status === 'rendering' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffcc00',
              fontSize: 14,
              pointerEvents: 'none',
              background: 'rgba(0,0,0,0.6)',
            }}
          >
            ⟳ Generating panoramic reconstruction…
          </div>
        )}

        {/* Cross-section cursor lines: ⊥ Prev (dashed), ⊥ Center (solid), ⊥ Next (dashed)
            Positions are computed via arcFracs[idx] so they align with vtk.js CPR column
            placement (arc-length based, not uniform index). cprImageBoundsRef maps image → div %. */}
        {cursorSampleIdx !== null && (() => {
          const N = splineFramesRef.current.length || 1;
          const { leftPct, rightPct } = cprImageBoundsRef.current;
          // Convert sample index → div-% via arc-length fractions (matches vtk.js column placement)
          const toPct = (idx: number) => {
            const clampedIdx = Math.max(0, Math.min(N - 1, idx));
            const fracs = arcFractionsRef.current;
            const arcFrac = fracs.length > clampedIdx ? fracs[clampedIdx] : clampedIdx / Math.max(N - 1, 1);
            return leftPct + arcFrac * (rightPct - leftPct);
          };

          const centerX = toPct(cursorSampleIdx);
          const prevX   = toPct(cursorSampleIdx - CROSS_SECTION_STEP);
          const nextX   = toPct(cursorSampleIdx + CROSS_SECTION_STEP);
          const dashedBg = `repeating-linear-gradient(to bottom, ${Colors.primary} 0px, ${Colors.primary} 5px, transparent 5px, transparent 10px)`;
          return (
            <>
              <div style={{ position: 'absolute', left: `${prevX}%`, top: 0, bottom: 0, width: 1,
                background: dashedBg, opacity: 0.7, pointerEvents: 'none', zIndex: 10 }} />
              <div style={{ position: 'absolute', left: `${centerX}%`, top: 0, bottom: 0, width: 2,
                background: Colors.primary, opacity: 0.9, pointerEvents: 'none', zIndex: 11,
                boxShadow: `0 0 5px ${Colors.primary}99` }} />
              <div style={{ position: 'absolute', left: `${nextX}%`, top: 0, bottom: 0, width: 1,
                background: dashedBg, opacity: 0.7, pointerEvents: 'none', zIndex: 10 }} />
            </>
          );
        })()}
      </div>
    </div>
  );
}
