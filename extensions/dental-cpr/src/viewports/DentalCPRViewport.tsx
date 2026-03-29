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

  // Cross-section cursor position as arc-fraction (0-1) — state for rendering, ref for event handlers
  const [cursorArcFrac, setCursorArcFrac] = useState<number | null>(null);
  const cursorArcFracRef = useRef<number>(0.5);

  // Navigate cross-section via slider, click, drag, or wheel.
  // `pct` is a panel-% (0-100).  We map it to the closest arch sample by arc-length.
  const navigateArch = useCallback((pct: number) => {
    const frames = splineFramesRef.current;
    const fracs  = arcFractionsRef.current;
    if (!frames.length) return;

    const frac = Math.max(0, Math.min(1, pct / 100));
    cursorArcFracRef.current = frac;

    // Binary-search fracs[] to find the index whose arc-fraction is closest to frac
    let idx = 0;
    if (fracs.length === frames.length && fracs.length > 1) {
      let lo = 0, hi = fracs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fracs[mid] < frac) lo = mid + 1;
        else hi = mid;
      }
      idx = lo;
    } else {
      idx = Math.round(frac * (frames.length - 1));
    }

    setCursorArcFrac(fracs.length ? fracs[idx] : frac);
    window.dispatchEvent(new CustomEvent(ARCH_CROSS_SECTION_POSITION, {
      detail: { frame: frames[idx], splineIndex: idx, numSamples: frames.length },
    }));
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
      openGLWindow.setSize(container.clientWidth || 700, container.clientHeight || 450);
      renderWindow.addView(openGLWindow);

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

    // Resize observer — keep vtk canvas in sync with container
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        openGLWindow.setSize(Math.round(width), Math.round(height));
        renderWindow.render();
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

    // Wheel on panoramic → step through cross-sections
    const onWheel = (e: WheelEvent) => {
      if (!splineFramesRef.current.length) return;
      e.preventDefault();
      const step = e.deltaY > 0 ? 2 : -2;
      navigateArch(cursorArcFracRef.current * 100 + step);
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

        // depthMm: use the actual CT scan height (Z-extent of the volume) so the
        // full volume is always visible without cropping.
        const volDims    = volume.imageData.getDimensions?.() ?? [1, 1, 1];
        const volSpacing = volume.imageData.getSpacing?.()    ?? [1, 1, 1];
        const scanHeightMm = volDims[2] * volSpacing[2];
        const depthMm = Math.max(archScale * 2, scanHeightMm, 80);

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
        actor.getProperty().setColorWindow(2000);
        actor.getProperty().setColorLevel(500);

        renderer.addActor(actor);

        const camera = renderer.getActiveCamera();
        camera.setParallelProjection(true);

        // Step 1: first render so the CPR mapper computes its output image and
        // the actor reports correct world-space bounds.
        renderWindow.render();

        // Step 2: set viewUp BEFORE resetCamera so vtk.js fits the frustum
        // around the correct axis. viewUp=[1,0,0] makes world-X go UP on screen
        // (tooth depth = vertical, arch length = horizontal).
        // resetCamera() respects the current viewUp when sizing parallelScale.
        camera.setViewUp(1, 0, 0);
        renderer.resetCamera();
        camera.setParallelScale(camera.getParallelScale() * 1.05); // 5 % margin
        renderer.resetCameraClippingRange();
        renderWindow.render();

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
      const { splineIndex } = (evt as CustomEvent<CrossSectionEventDetail>).detail;
      const fracs = arcFractionsRef.current;
      const frac  = fracs.length > splineIndex ? fracs[splineIndex] : splineIndex / Math.max((evt as CustomEvent<CrossSectionEventDetail>).detail.numSamples - 1, 1);
      cursorArcFracRef.current = frac;
      setCursorArcFrac(frac);
    };
    window.addEventListener(ARCH_CROSS_SECTION_POSITION, handler);
    return () => window.removeEventListener(ARCH_CROSS_SECTION_POSITION, handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!splineFramesRef.current.length) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); navigateArch(cursorArcFracRef.current * 100 - 2); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navigateArch(cursorArcFracRef.current * 100 + 2); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigateArch]);

  // Cross-section wheel → navigate arch
  useEffect(() => {
    const handler = (e: Event) => {
      const { delta } = (e as CustomEvent<{ delta: number }>).detail;
      navigateArch(cursorXPctRef.current + delta);
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
          padding: '4px 12px',
          background: '#0d0d0d',
          borderBottom: '1px solid #1a1a1a',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: Colors.textDim,
        }}>
          <span>◀</span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={(cursorArcFrac ?? 0.5) * 100}
            onChange={e => navigateArch(Number(e.target.value))}
            style={{ flex: 1, accentColor: Colors.primary, cursor: 'pointer' }}
          />
          <span>▶</span>
          <span style={{ color: '#555', minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round((cursorArcFrac ?? 0.5) * getSharedTotalArcMm())}mm
          </span>
        </div>
      )}

      {/* ── VTK WebGL canvas ─────────────────────────────────────────────── */}
      <div
        ref={vtkContainerRef}
        style={{
          flex: 1,
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

        {/* Cross-section cursor lines: ⊥ Prev (dashed), ⊥ Center (solid), ⊥ Next (dashed) */}
        {cursorArcFrac !== null && (() => {
          const fracs     = arcFractionsRef.current;
          const cursorPct = (cursorArcFrac ?? 0.5) * 100;
          // Find nearest index for prev/next cursor lines using arc-fractions
          const frames    = splineFramesRef.current;
          const numSamples = frames.length || 1;
          let centerIdx = 0;
          if (fracs.length === numSamples && numSamples > 1) {
            let lo = 0, hi = numSamples - 1;
            const frac = cursorArcFrac ?? 0.5;
            while (lo < hi) { const m = (lo+hi)>>1; if (fracs[m] < frac) lo=m+1; else hi=m; }
            centerIdx = lo;
          } else {
            centerIdx = Math.round((cursorArcFrac ?? 0.5) * (numSamples - 1));
          }
          const prevIdx = Math.max(0, centerIdx - CROSS_SECTION_STEP);
          const nextIdx = Math.min(numSamples - 1, centerIdx + CROSS_SECTION_STEP);
          const prevPct = (fracs.length === numSamples ? fracs[prevIdx] : prevIdx / (numSamples - 1)) * 100;
          const nextPct = (fracs.length === numSamples ? fracs[nextIdx] : nextIdx / (numSamples - 1)) * 100;
          const dashedBg = `repeating-linear-gradient(to bottom, ${Colors.primary} 0px, ${Colors.primary} 5px, transparent 5px, transparent 10px)`;
          return (
            <>
              <div style={{ position: 'absolute', left: `${prevPct}%`, top: 0, bottom: 0, width: 1,
                background: dashedBg, opacity: 0.7, pointerEvents: 'none', zIndex: 10 }} />
              <div style={{ position: 'absolute', left: `${cursorPct}%`, top: 0, bottom: 0, width: 2,
                background: Colors.primary, opacity: 0.9, pointerEvents: 'none', zIndex: 11,
                boxShadow: `0 0 5px ${Colors.primary}99` }} />
              <div style={{ position: 'absolute', left: `${nextPct}%`, top: 0, bottom: 0, width: 1,
                background: dashedBg, opacity: 0.7, pointerEvents: 'none', zIndex: 10 }} />
            </>
          );
        })()}
      </div>
    </div>
  );
}
