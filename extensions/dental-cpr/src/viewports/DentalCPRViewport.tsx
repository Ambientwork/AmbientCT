import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react';
import { cache, volumeLoader } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
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
import { ARCH_SPLINE_COMPLETED } from '../tools/DentalArchSplineTool';
import {
  ARCH_CROSS_SECTION_POSITION,
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
  const [slabMm, setSlabMm] = useState(5);

  // Spline frames stored after each arch completion — used for cross-section clicks
  const splineFramesRef = useRef<CenterlinePoint[]>([]);

  // Cross-section cursor position (0-100 %) — updated on click and on auto-fire
  const [cursorXPct, setCursorXPct] = useState<number | null>(null);

  // Navigate cross-section via slider or arrow keys
  const navigateArch = useCallback((pct: number) => {
    const frames = splineFramesRef.current;
    if (!frames.length) return;
    const clamped = Math.max(0, Math.min(100, pct));
    const idx = Math.round((clamped / 100) * (frames.length - 1));
    setCursorXPct(clamped);
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

    // Click on panoramic → fire cross-section event for DentalCrossSectionViewport
    const onCanvasClick = (e: MouseEvent) => {
      const frames = splineFramesRef.current;
      if (!frames.length) return;
      const rect = container.getBoundingClientRect();
      const xFraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const splineIndex = Math.round(xFraction * (frames.length - 1));
      const detail: CrossSectionEventDetail = {
        frame: frames[splineIndex],
        splineIndex,
        numSamples: frames.length,
      };
      window.dispatchEvent(
        new CustomEvent(ARCH_CROSS_SECTION_POSITION, { detail })
      );
    };
    container.addEventListener('click', onCanvasClick);

    return () => {
      observer.disconnect();
      container.removeEventListener('click', onCanvasClick);
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
        // Build Catmull-Rom centerline polydata (300 samples for smooth panoramic)
        const centerline = buildCenterline(controlPoints, NUM_SAMPLES);
        // Also store frames for cross-section click events
        const cprFrames = buildCenterlinePoints(controlPoints, NUM_SAMPLES);
        splineFramesRef.current = cprFrames;

        // Compute arc length from sampled points (mm)
        let arcLengthMm = 0;
        for (let i = 1; i < cprFrames.length; i++) {
          const [x0, y0, z0] = cprFrames[i - 1].point;
          const [x1, y1, z1] = cprFrames[i].point;
          arcLengthMm += Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
        }

        // Wire vtkImageCPRMapper
        const mapper = vtkImageCPRMapper.newInstance();
        mapper.setImageData(imgData ?? volume.imageData); // port 0 — CBCT volume
        mapper.setCenterlineData(centerline);       // port 1 — arch centerline

        // Straightened CPR: output is a flat rectangle at Z=0 in local model space.
        //   X: [0..width=70mm]   = buccal-lingual depth (across teeth)
        //   Y: [0..arcLength mm] = arc length along dental arch
        //   Z: 0 (flat image plane)
        mapper.useStraightenedMode();
        mapper.setWidth(70); // 70 mm covers crown to root apex (model coords = mm for DICOM)
        mapper.setOrientationArrayName('Orientation');
        mapper.setUseUniformOrientation(false);

        // Our quaternion at each point maps:
        //   Q * [1,0,0] = N_new = tooth height (Z)  → tangentDirection (image X = width, crown→root)
        //   Q * [0,1,0] = T    = arch tangent        → normalDirection  (image Y = arc length)
        //   Q * [0,0,1] = B_new = buccal-lingual     → bitangentDirection (MIP focal trough slab)
        (mapper as any).setTangentDirection([1, 0, 0]);   // tooth height = width (70mm crown to root)
        (mapper as any).setBitangentDirection([0, 0, 1]); // buccal-lingual = MIP slab (focal trough)
        (mapper as any).setNormalDirection([0, 1, 0]);    // arch tangent = arc length

        // MIP slab along tooth height — simulates panoramic focal trough
        mapper.setProjectionSlabThickness(slabMm);
        mapper.setProjectionSlabNumberOfSamples(slabMm * 5 + 1); // must be odd
        mapper.setProjectionMode(ProjectionMode.MAX);

        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);
        // Bone window for dental CBCT (HU -500 to +1500 → W=2000, L=500)
        actor.getProperty().setColorWindow(2000);
        actor.getProperty().setColorLevel(500);

        renderer.addActor(actor);

        // The CPR actor lives in local model space at Z=0: X=[0,70], Y=[0,arcLen].
        // Camera orientation: viewUp=(1,0,0) → X-axis (tooth depth) runs vertically,
        // Y-axis (arch arc-length) runs horizontally → traditional horizontal panoramic.
        // parallelScale accounts for the viewport aspect ratio so the full arch (Y)
        // fits horizontally within the panel.
        const bounds = actor.getBounds?.() ?? [0, 70, 0, arcLengthMm, 0, 0];
        const imgW = bounds[1] ?? 70;          // tooth depth in mm (X axis, 0–70 mm)
        const imgH = bounds[3] ?? arcLengthMm; // arch length in mm (Y axis)
        const camera = renderer.getActiveCamera();
        camera.setParallelProjection(true);
        camera.setFocalPoint(imgW / 2, imgH / 2, 0);
        camera.setPosition(imgW / 2, imgH / 2, 500);
        // viewUp=(1,0,0): X-axis (buccal-lingual depth) points up on screen
        //                  Y-axis (arch arc-length) runs left → right
        camera.setViewUp(1, 0, 0);

        // Compute parallelScale so the FULL arch (imgH mm) fits in the viewport width.
        // parallelScale = half the model-space height visible on screen.
        // viewport_width_model = 2 × parallelScale × aspectRatio
        // Solve for parallelScale: PS = imgH / (2 × aspectRatio)
        // Also ensure tooth depth (imgW mm) is fully visible: PS ≥ imgW / 2
        const glSize = openGLWindowRef.current
          ? (openGLWindowRef.current as any).getSize?.() as [number, number] | undefined
          : undefined;
        const viewW = glSize?.[0] ?? container.clientWidth  ?? 400;
        const viewH = glSize?.[1] ?? container.clientHeight ?? 600;
        const aspect = viewH > 0 ? viewW / viewH : 1;
        const parallelScale = Math.max(imgW / 2, imgH / (2 * aspect));
        camera.setParallelScale(parallelScale);
        renderer.resetCameraClippingRange();
        renderWindow.render();

        console.log('[DentalCPR] CPR rendered — arc:', Math.round(arcLengthMm), 'mm',
          '| actor bounds:', actor.getBounds?.().map((v: number) => v.toFixed(1)).join(','),
          '| parallelScale:', camera.getParallelScale?.().toFixed(1));

        actorRef.current = actor;
        mapperRef.current = mapper;
        setStatus('ready');
        setStatusMsg(
          `Panoramic ready — ${Math.round(arcLengthMm)} mm arch length. ` +
          'Draw a new arch to update.'
        );

        // Auto-fire cross-section at arch midpoint so the bottom-left panel shows
        // something immediately without requiring a user click
        const midIdx = Math.floor(cprFrames.length / 2);
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
      setCursorXPct((splineIndex / Math.max(numSamples - 1, 1)) * 100);
    };
    window.addEventListener(ARCH_CROSS_SECTION_POSITION, handler);
    return () => window.removeEventListener(ARCH_CROSS_SECTION_POSITION, handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!splineFramesRef.current.length) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); navigateArch((cursorXPct ?? 50) - 2); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navigateArch((cursorXPct ?? 50) + 2); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursorXPct, navigateArch]);

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
    waiting: '#888',
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
        fontFamily: 'system-ui, -apple-system, sans-serif',
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
        <span style={{ color: '#00aaff', fontWeight: 700, letterSpacing: '0.02em' }}>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, color: '#888', fontSize: 11 }}>
          Slab
          <input
            type="range"
            min={1}
            max={20}
            value={slabMm}
            onChange={e => setSlabMm(Number(e.target.value))}
            style={{ width: 64, accentColor: '#00aaff' }}
          />
          <span style={{ color: '#ccc', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
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
          color: '#666',
        }}>
          <span>◀</span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={cursorXPct ?? 50}
            onChange={e => navigateArch(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#00aaff', cursor: 'pointer' }}
          />
          <span>▶</span>
          <span style={{ color: '#555', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(cursorXPct ?? 50)}%
          </span>
        </div>
      )}

      {/* ── VTK WebGL canvas ─────────────────────────────────────────────── */}
      <div
        ref={vtkContainerRef}
        style={{ flex: 1, position: 'relative', background: '#050505' }}
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

        {/* Cross-section cursor line */}
        {cursorXPct !== null && (
          <div
            style={{
              position: 'absolute',
              left: `${cursorXPct}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: '#00aaff',
              opacity: 0.85,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}
      </div>
    </div>
  );
}
