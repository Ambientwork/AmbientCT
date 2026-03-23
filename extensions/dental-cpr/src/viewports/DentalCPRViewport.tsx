import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react';
import { cache } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { ProjectionMode } from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper/Constants';
import { buildCenterline } from '../utils/buildCenterline';
import { ARCH_SPLINE_COMPLETED } from '../tools/DentalArchSplineTool';

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

  // ── VTK pipeline initialisation ──────────────────────────────────────────
  useEffect(() => {
    const container = vtkContainerRef.current;
    if (!container) return;

    const renderWindow = vtkRenderWindow.newInstance();
    const renderer = vtkRenderer.newInstance({ background: [0.04, 0.04, 0.04] });
    renderWindow.addRenderer(renderer);

    const openGLWindow = vtkOpenGLRenderWindow.newInstance();
    openGLWindow.setContainer(container);
    openGLWindow.setSize(container.clientWidth || 700, container.clientHeight || 450);
    renderWindow.addView(openGLWindow);

    const interactor = vtkRenderWindowInteractor.newInstance();
    interactor.setView(openGLWindow);
    interactor.initialize();
    interactor.bindEvents(container);

    rendererRef.current = renderer;
    renderWindowRef.current = renderWindow;
    openGLWindowRef.current = openGLWindow;

    // Resize observer — keep vtk canvas in sync with container
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        openGLWindow.setSize(Math.round(width), Math.round(height));
        renderWindow.render();
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      interactor.unbindEvents(container);
      renderWindow.finalize();
      openGLWindow.delete();
    };
  }, []);

  // ── Get volume from Cornerstone3D cache ──────────────────────────────────
  const getVolume = useCallback(() => {
    if (!displaySets?.length) return null;
    const ds = displaySets[0];
    // Try explicit volumeId first, then derive from displaySetInstanceUID
    const volumeId =
      ds.volumeId ??
      `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;
    return cache.getVolume(volumeId);
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
        // Build Catmull-Rom centerline polydata (300 samples for smooth panoramic)
        const centerline = buildCenterline(controlPoints, 300);

        // Wire vtkImageCPRMapper
        const mapper = vtkImageCPRMapper.newInstance();
        mapper.setImageData(volume.imageData);      // port 0 — CBCT volume
        mapper.setCenterlineData(centerline);       // port 1 — arch centerline

        // Straightened CPR = classic panoramic equivalent
        mapper.useStraightenedMode();
        mapper.setWidth(80);                        // 80 mm covers a full dental arch
        mapper.setOrientationArrayName('Orientation');
        mapper.setUseUniformOrientation(false);

        // MIP slab for richer panoramic contrast
        mapper.setProjectionSlabThickness(slabMm);
        mapper.setProjectionSlabNumberOfSamples(slabMm * 5 + 1); // must be odd
        mapper.setProjectionMode(ProjectionMode.MAX);

        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);

        renderer.addActor(actor);
        renderer.resetCamera();

        // Orient the camera to face the CPR output plane.
        // The CPR plane is placed at world origin; we look along +Z.
        // Adjust distance based on centerline arc length so it fills the view.
        const arcLengthMm = mapper.getHeight?.() ?? 150;
        const camera = renderer.getActiveCamera();
        camera.setPosition(0, 0, arcLengthMm * 2);
        camera.setFocalPoint(0, 0, 0);
        camera.setViewUp(0, 1, 0);
        camera.setParallelProjection(true);
        camera.setParallelScale(arcLengthMm * 0.6);

        renderer.resetCamera();
        renderWindow.render();

        actorRef.current = actor;
        mapperRef.current = mapper;
        setStatus('ready');
        setStatusMsg(
          `Panoramic ready — ${Math.round(arcLengthMm)} mm arch length. ` +
          'Draw a new arch to update.'
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

  // ── Listen for completed arch spline ────────────────────────────────────
  useEffect(() => {
    const handler = (evt: Event) => {
      const { controlPoints } = (evt as CustomEvent).detail as {
        controlPoints: Types.Point3[];
      };
      renderCPR(controlPoints);
    };

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
        fontFamily: 'ui-monospace, monospace',
        overflow: 'hidden',
      }}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          padding: '5px 12px',
          background: '#181818',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 12,
        }}
      >
        <span style={{ color: '#00aaff', fontWeight: 700 }}>
          🦷 Dental Panoramic CPR
        </span>

        <span
          style={{
            flex: 1,
            color: statusColour[status],
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {statusMsg}
        </span>

        {/* Slab thickness slider */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          <span style={{ color: '#aaa' }}>Slab</span>
          <input
            type="range"
            min={1}
            max={20}
            value={slabMm}
            onChange={e => setSlabMm(Number(e.target.value))}
            style={{ width: 80, accentColor: '#00aaff' }}
          />
          <span style={{ color: '#fff', minWidth: 34, textAlign: 'right' }}>
            {slabMm} mm
          </span>
        </label>
      </div>

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
      </div>
    </div>
  );
}
