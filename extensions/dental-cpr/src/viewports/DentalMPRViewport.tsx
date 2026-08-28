import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cache } from '@cornerstonejs/core';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageReslice from '@kitware/vtk.js/Imaging/Core/ImageReslice';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { ARCH_CROSS_SECTION_POSITION } from './DentalCrossSectionViewport';
import type { CrossSectionEventDetail } from './DentalCrossSectionViewport';
import { startBoundedPoll } from '../utils/boundedPoll';
import { findVolumeForDisplaySet, isVolumeReady } from '../utils/volumeLookup';

// ── Props ─────────────────────────────────────────────────────────────────────

interface DentalMPRViewportProps {
  viewportId: string;
  displaySets: any[];
  servicesManager: any;
  orientation?: 'coronal' | 'sagittal';
  labelOverride?: string;
  accentColor?: string;
  /**
   * Controlled slice-position sync (plan §10 P3.4). Omit entirely for a
   * standalone/uncontrolled viewport (own local slice state, unchanged
   * behaviour). Pass `null` from a compare-mode parent before any column has
   * initialized the shared coordinate, and a number once one has — every
   * viewport sharing the same value re-renders at that patient coordinate.
   */
  sliceWorldCoordinate?: number | null;
  onSliceWorldCoordinateChange?: (worldMm: number) => void;
  /** Controlled window/level sync — see sliceWorldCoordinate for the same contract. */
  windowWidth?: number;
  windowCenter?: number;
  onWindowLevelChange?: (windowWidth: number, windowCenter: number) => void;
  /** Total volume-load time budget before showing a retryable error. Default 20s. */
  pollTimeoutMs?: number;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RenderStatus = 'idle' | 'rendering' | 'ready' | 'error';

/** PHI-free error codes — safe to show in the UI, never derived from tag/pixel data. */
type RenderErrorCode = 'WEBGL_UNAVAILABLE' | 'VOLUME_LOAD_TIMEOUT' | 'VOLUME_EMPTY' | 'RENDER_FAILED';

const ERROR_MESSAGES: Record<RenderErrorCode, string> = {
  WEBGL_UNAVAILABLE: 'WebGL nicht verfügbar',
  VOLUME_LOAD_TIMEOUT: 'Volumen konnte nicht geladen werden (Zeitüberschreitung)',
  VOLUME_EMPTY: 'Volumen enthält keine Daten',
  RENDER_FAILED: 'Rendering fehlgeschlagen',
};

const DEFAULT_POLL_INTERVAL_MS = 800;
// A CBCT series can be hundreds of slices; two of them load concurrently in
// compare mode. 20s proved too tight for that in practice (observed timing
// out mid-load, not on a genuinely missing volume) — 45s still bounds the
// wait (never infinite) while giving a real multi-hundred-slice load a fair
// chance to finish before showing the retryable error state.
const DEFAULT_POLL_TIMEOUT_MS = 45000;
const DEFAULT_WINDOW_WIDTH = 2000;
const DEFAULT_WINDOW_CENTER = 400;

/**
 * DentalMPRViewport
 *
 * Renders a coronal MPR (Multi-Planar Reconstruction) slice of a CBCT volume
 * using vtk.js vtkImageReslice.
 *
 * Coordinate convention (DICOM patient space):
 *   Patient X → left-right
 *   Patient Y → anterior-posterior (A/P)
 *   Patient Z → superior-inferior (S/I)
 *
 * The coronal plane cuts along the A/P axis (Y):
 *   Output image X = patient X [1,0,0]   (left → right)
 *   Output image Y = patient −Z [0,0,−1]  (superior → inferior in screen-up)
 *   Slice normal   = patient Y [0,1,0]   (anterior → posterior)
 *
 * The slider translates the reslice origin along the Y axis to scroll
 * through coronal slices from anterior to posterior.
 *
 * Arch position indicator: listens for DENTAL_ARCH_CROSS_SECTION_POSITION
 * events (fired by DentalCPRViewport when user clicks on the panoramic) and
 * draws a horizontal blue overlay line at the corresponding patient Y
 * coordinate mapped into viewport pixel space.
 */
export default function DentalMPRViewport({
  viewportId,
  displaySets,
  orientation = 'coronal',
  labelOverride,
  accentColor = '#00aaff',
  sliceWorldCoordinate,
  onSliceWorldCoordinateChange,
  windowWidth,
  windowCenter,
  onWindowLevelChange,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
}: DentalMPRViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // vtk.js pipeline refs — not React state; mutations do not trigger re-renders
  const rendererRef    = useRef<ReturnType<typeof vtkRenderer.newInstance> | null>(null);
  const renderWindowRef = useRef<ReturnType<typeof vtkRenderWindow.newInstance> | null>(null);
  const openGLWindowRef = useRef<ReturnType<typeof vtkOpenGLRenderWindow.newInstance> | null>(null);
  const resliceRef     = useRef<ReturnType<typeof vtkImageReslice.newInstance> | null>(null);
  const actorRef       = useRef<ReturnType<typeof vtkImageSlice.newInstance> | null>(null);

  // Y extent of volume in mm — needed to constrain slider and map arch indicator
  const yBoundsRef = useRef<[number, number]>([0, 1]);

  // ── React state ───────────────────────────────────────────────────────────
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [errorCode, setErrorCode] = useState<RenderErrorCode | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Slider: current origin Y in mm (anterior-posterior position)
  const [slicePos, setSlicePos]     = useState(0);
  const [axisMin, setAxisMin]       = useState(0);
  const [axisMax, setAxisMax]       = useState(1);

  // Window/Level — controlled from a compare-mode parent when W/L-lock is
  // active, otherwise this viewport's own independent local value.
  const [ww, setWw] = useState(windowWidth ?? DEFAULT_WINDOW_WIDTH);
  const [wl, setWl] = useState(windowCenter ?? DEFAULT_WINDOW_CENTER);
  const wwRef = useRef(ww);
  const wlRef = useRef(wl);

  // Arch position indicator: pixel-row fraction [0,1] in the viewport,
  // null when no event has been received yet
  const [archLinePct, setArchLinePct] = useState<number | null>(null);

  // Latest-value refs for props read from inside long-lived async callbacks
  // (the bounded-poll onReady handler, the slider handler) — keeps those
  // callbacks from needing to be recreated (and the poll restarted) on every
  // parent re-render while still always seeing the current prop value.
  const sliceWorldCoordinateRef = useRef(sliceWorldCoordinate);
  useEffect(() => { sliceWorldCoordinateRef.current = sliceWorldCoordinate; }, [sliceWorldCoordinate]);
  const onSliceWorldCoordinateChangeRef = useRef(onSliceWorldCoordinateChange);
  useEffect(() => { onSliceWorldCoordinateChangeRef.current = onSliceWorldCoordinateChange; }, [onSliceWorldCoordinateChange]);
  const onWindowLevelChangeRef = useRef(onWindowLevelChange);
  useEffect(() => { onWindowLevelChangeRef.current = onWindowLevelChange; }, [onWindowLevelChange]);

  // The slice position this viewport last actually rendered — used by the
  // controlled-prop sync effect to tell "a sibling moved the shared slider"
  // apart from "the prop just echoed back the value we ourselves sent up".
  const lastAppliedSliceRef = useRef<number | null>(null);

  // ── VTK pipeline init ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const testCanvas = document.createElement('canvas');
    const hasWebGL = !!(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'));
    if (!hasWebGL) {
      setStatus('error');
      setErrorCode('WEBGL_UNAVAILABLE');
      return;
    }

    let renderWindow: ReturnType<typeof vtkRenderWindow.newInstance>;
    let openGLWindow: ReturnType<typeof vtkOpenGLRenderWindow.newInstance>;
    let interactor: ReturnType<typeof vtkRenderWindowInteractor.newInstance>;

    try {
      renderWindow = vtkRenderWindow.newInstance();
      const renderer = vtkRenderer.newInstance({ background: [0.03, 0.03, 0.03] });
      renderWindow.addRenderer(renderer);

      openGLWindow = vtkOpenGLRenderWindow.newInstance();
      openGLWindow.setContainer(container);
      openGLWindow.setSize(container.clientWidth || 350, container.clientHeight || 450);
      renderWindow.addView(openGLWindow);

      interactor = vtkRenderWindowInteractor.newInstance();
      interactor.setView(openGLWindow);
      interactor.initialize();
      interactor.bindEvents(container);

      rendererRef.current     = renderer;
      renderWindowRef.current = renderWindow;
      openGLWindowRef.current = openGLWindow;
    } catch (e) {
      console.error('[DentalMPR] VTK init error:', e);
      setStatus('error');
      setErrorCode('RENDER_FAILED');
      return;
    }

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
      interactor?.unbindEvents(container);
      openGLWindow?.delete();
      renderWindow?.delete();
    };
  }, []);

  // ── Volume lookup (shared 3-tier strategy — see src/utils/volumeLookup.ts) ─
  const getVolume = useCallback(() => findVolumeForDisplaySet(cache as any, displaySets), [displaySets]);

  // ── Render / update the MPR slice ─────────────────────────────────────────
  const renderCoronalSlice = useCallback(
    (originPos: number) => {
      try {
      const volume = getVolume();
      // imageData must exist AND have a valid scalar type (not just an empty proxy)
      const imgDataCheck = volume?.imageData;
      if (!imgDataCheck) { setStatus('error'); setErrorCode('VOLUME_EMPTY'); return; }
      try { if (!imgDataCheck.getNumberOfPoints || imgDataCheck.getNumberOfPoints() < 1) { setStatus('error'); setErrorCode('VOLUME_EMPTY'); return; } } catch { setStatus('error'); setErrorCode('VOLUME_EMPTY'); return; }

      // Cornerstone3D v2+ VoxelManager — populate scalars before vtk.js reads them
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
            console.log('[DentalMPR] Populated', rawScalars.length, 'scalars from VoxelManager');
          }
        } catch (scalarErr) {
          console.warn('[DentalMPR] Scalar population failed:', (scalarErr as Error).message);
        }
      }

      const renderer = rendererRef.current;
      const renderWindow = renderWindowRef.current;
      if (!renderer || !renderWindow) return;

      setStatus('rendering');

      // Derive volume extent in mm for slider bounds (only once per volume)
      const bounds = imgData.getBounds() as [number, number, number, number, number, number];
      // bounds = [xMin, xMax, yMin, yMax, zMin, zMax]
      const sliderMin = orientation === 'sagittal' ? bounds[0] : bounds[2];
      const sliderMax = orientation === 'sagittal' ? bounds[1] : bounds[3];
      yBoundsRef.current = [sliderMin, sliderMax];
      setAxisMin(sliderMin);
      setAxisMax(sliderMax);

      // Compute output image half-extents in pixels
      // Full X/Y extent (horizontal) and Z extent (superior-inferior) of the volume
      const horizontalSpan = orientation === 'sagittal'
        ? bounds[3] - bounds[2]
        : bounds[1] - bounds[0];
      const zSpan = bounds[5] - bounds[4]; // mm
      const mmPerPix = 0.4;
      const halfX = Math.ceil(horizontalSpan / 2 / mmPerPix);
      const halfZ = Math.ceil(zSpan / 2 / mmPerPix);

      // Centre of volume in X/Y and Z
      const centerX = (bounds[0] + bounds[1]) / 2;
      const centerY = (bounds[2] + bounds[3]) / 2;
      const centerZ = (bounds[4] + bounds[5]) / 2;

      // Build or reuse the reslice filter
      let reslice = resliceRef.current;
      let actor = actorRef.current;
      if (!reslice || !actor) {
        reslice = vtkImageReslice.newInstance();
        reslice.setOutputDimensionality(2);
        reslice.setInterpolationMode(1); // linear
        reslice.setTransformInputSampling(false);

        const mapper = vtkImageMapper.newInstance();
        mapper.setInputConnection(reslice.getOutputPort());

        actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);

        renderer.addActor(actor);
        resliceRef.current = reslice;
        actorRef.current = actor;
      }
      // Always apply the current W/L (may be controlled by a compare-mode parent)
      actor.getProperty().setColorWindow(wwRef.current);
      actor.getProperty().setColorLevel(wlRef.current);

      reslice.setInputData(imgData);
      reslice.setOutputExtent([-halfX, halfX, -halfZ, halfZ, 0, 0]);
      reslice.setOutputSpacing([mmPerPix, mmPerPix, 1]);

      // Coronal:
      //   output X = patient X, output Y = -patient Z, normal = patient Y
      // Sagittal:
      //   output X = patient Y, output Y = -patient Z, normal = patient X
      const resliceAxes = orientation === 'sagittal'
        ? new Float64Array([
            0,  1,  0,  centerY,
            0,  0, -1,  centerZ,
            1,  0,  0,  originPos,
            0,  0,  0,  1,
          ])
        : new Float64Array([
            1,  0,  0,  centerX,
            0,  0, -1,  centerZ,
            0,  1,  0,  originPos,
            0,  0,  0,  1,
          ]);
      (reslice as any).setResliceAxes(resliceAxes);

      // Parallel camera looking along -Z at the reslice output plane (Z=0),
      // with +Y screen-up matching the output Y axis (superior → inferior is downward).
      // parallelScale = half the larger output extent in mm.
      const halfScaleX = halfX * mmPerPix;
      const halfScaleZ = halfZ * mmPerPix;
      const camera = renderer.getActiveCamera();
      camera.setParallelProjection(true);
      camera.setFocalPoint(0, 0, 0);
      camera.setPosition(0, 0, 500);
      camera.setViewUp(0, -1, 0); // screen-up = output-Y direction, displayed top-to-bottom
      camera.setParallelScale(Math.max(halfScaleX, halfScaleZ) + 1);
      renderer.resetCameraClippingRange();
      renderWindow.render();

      setStatus('ready');
      setErrorCode(null);
      console.log(
        `[DentalMPR] ${orientation} slice rendered at ${originPos.toFixed(1)} mm`,
        `| extent ±${halfX}×${halfZ} px @ ${mmPerPix} mm/px`
      );
      } catch (err) {
        console.warn('[DentalMPR] renderCoronalSlice error:', (err as Error).message);
        setStatus('error');
        setErrorCode('RENDER_FAILED');
      }
    },
    [getVolume, orientation]
  );

  // Applies a new slice position: renders it, mirrors it into local display
  // state, and remembers it so the controlled-prop sync effect below can
  // distinguish "a sibling moved" from "this is just our own value echoed back".
  const applySlice = useCallback((pos: number) => {
    lastAppliedSliceRef.current = pos;
    setSlicePos(pos);
    renderCoronalSlice(pos);
  }, [renderCoronalSlice]);

  // ── Auto-load: bounded poll until imageData is available, then timeout ────
  // (plan §10 addendum 18.2 — this loop previously had no cap and left the UI
  // stuck on "Waiting for volume…" forever whenever a volume never resolved.)
  useEffect(() => {
    if (!displaySets?.length) {
      setStatus('idle');
      setErrorCode(null);
      return;
    }

    setStatus('idle');
    setErrorCode(null);

    const handle = startBoundedPoll(
      { intervalMs: DEFAULT_POLL_INTERVAL_MS, timeoutMs: pollTimeoutMs },
      {
        isReady: () => isVolumeReady(getVolume()),
        onReady: () => {
          const vol = getVolume();
          const bounds = vol!.imageData.getBounds() as number[];
          const mid = orientation === 'sagittal'
            ? (bounds[0] + bounds[1]) / 2
            : (bounds[2] + bounds[3]) / 2;

          const controlled = sliceWorldCoordinateRef.current;
          const targetPos = typeof controlled === 'number' ? controlled : mid;
          applySlice(targetPos);

          // First controlled viewport to become ready initializes the shared
          // coordinate for its siblings; a viewport that already inherited a
          // concrete value from the parent just renders it (no re-lift).
          if (controlled === null) {
            onSliceWorldCoordinateChangeRef.current?.(mid);
          }
        },
        onTimeout: () => {
          setStatus('error');
          setErrorCode('VOLUME_LOAD_TIMEOUT');
        },
      }
    );

    return () => handle.cancel();
  }, [displaySets, getVolume, orientation, applySlice, pollTimeoutMs, retryToken]);

  // ── Controlled slice-position sync: re-render when a sibling column moves
  //    the shared slider (plan §10 P3.4) ─────────────────────────────────────
  useEffect(() => {
    if (sliceWorldCoordinate === undefined || sliceWorldCoordinate === null) return;
    if (status !== 'ready' && status !== 'rendering') return;
    const last = lastAppliedSliceRef.current;
    if (last !== null && Math.abs(sliceWorldCoordinate - last) < 1e-6) return;
    applySlice(sliceWorldCoordinate);
  }, [sliceWorldCoordinate, status, applySlice]);

  // ── Controlled W/L sync: re-apply when a compare-mode parent's shared
  //    window/level changes (locked panels only — see DentalContainerViewport) ─
  useEffect(() => {
    if (windowWidth === undefined && windowCenter === undefined) return;
    const nextWw = windowWidth ?? wwRef.current;
    const nextWl = windowCenter ?? wlRef.current;
    if (nextWw === wwRef.current && nextWl === wlRef.current) return;
    wwRef.current = nextWw;
    wlRef.current = nextWl;
    setWw(nextWw);
    setWl(nextWl);
    const actor = actorRef.current;
    if (actor) {
      actor.getProperty().setColorWindow(nextWw);
      actor.getProperty().setColorLevel(nextWl);
      renderWindowRef.current?.render();
    }
  }, [windowWidth, windowCenter]);

  // ── Slider change handler ─────────────────────────────────────────────────
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextPos = Number(e.target.value);
      applySlice(nextPos);
      onSliceWorldCoordinateChangeRef.current?.(nextPos);
    },
    [applySlice]
  );

  const applyWindowLevel = useCallback((nextWw: number, nextWl: number) => {
    wwRef.current = nextWw;
    wlRef.current = nextWl;
    setWw(nextWw);
    setWl(nextWl);
    const actor = actorRef.current;
    if (actor) {
      actor.getProperty().setColorWindow(nextWw);
      actor.getProperty().setColorLevel(nextWl);
      renderWindowRef.current?.render();
    }
    onWindowLevelChangeRef.current?.(nextWw, nextWl);
  }, []);

  const handleWindowWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (Number.isFinite(next) && next > 0) applyWindowLevel(next, wlRef.current);
    },
    [applyWindowLevel]
  );

  const handleWindowCenterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (Number.isFinite(next)) applyWindowLevel(wwRef.current, next);
    },
    [applyWindowLevel]
  );

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorCode(null);
    setRetryToken(t => t + 1);
  }, []);

  // ── Arch position indicator ────────────────────────────────────────────────
  // When the CPR viewport fires a cross-section event, the event carries a
  // Frenet frame whose `point` is in patient world space.  We map its Y
  // coordinate to a [0,1] fraction within the displayed Y range so we can
  // draw an overlay line at the correct screen row.
  useEffect(() => {
    const handler = (evt: Event) => {
      const { frame } = (evt as CustomEvent<CrossSectionEventDetail>).detail;
      const [axisLo, axisHi] = yBoundsRef.current;
      const axisRange = axisHi - axisLo;
      if (axisRange <= 0) return;

      const axisPoint = orientation === 'sagittal' ? frame.point[0] : frame.point[1];
      const pct = (axisPoint - axisLo) / axisRange;
      setArchLinePct(Math.max(0, Math.min(1, pct)));
    };

    window.addEventListener(ARCH_CROSS_SECTION_POSITION, handler);
    return () => window.removeEventListener(ARCH_CROSS_SECTION_POSITION, handler);
  }, [orientation]);

  // ── Status colour ─────────────────────────────────────────────────────────
  const statusColor: Record<RenderStatus, string> = {
    idle:      '#555',
    rendering: '#ffcc00',
    ready:     '#00ff88',
    error:     '#ff6b6b',
  };

  const axisRangeSpan = axisMax - axisMin || 1;
  const viewLabel = labelOverride ?? (orientation === 'sagittal' ? 'MPR · Sagittal' : 'MPR · Coronal');
  const sliceLabel = orientation === 'sagittal' ? 'X' : 'Y';
  const canRetry = errorCode !== 'WEBGL_UNAVAILABLE';

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
      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          padding: '5px 12px',
          background: '#111',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
        }}
      >
        {/* Viewport label — also carries the orientation, always visible */}
        <span style={{ color: accentColor, fontWeight: 700, letterSpacing: '0.02em' }}>
          {viewLabel}
        </span>

        {/* Status message — patient coordinate + W/L visible once ready */}
        <span
          style={{
            flex: 1,
            color: statusColor[status],
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: 11,
          }}
        >
          {status === 'idle'      && 'Waiting for volume…'}
          {status === 'rendering' && 'Rendering…'}
          {status === 'ready'     && `Slice ${sliceLabel} ${slicePos.toFixed(1)} mm · W ${Math.round(ww)} / L ${Math.round(wl)}`}
          {status === 'error'     && `Fehler: ${errorCode ? ERROR_MESSAGES[errorCode] : 'Volumen nicht bereit'}`}
        </span>

        {status === 'error' && canRetry && (
          <button
            onClick={handleRetry}
            title="Volumen erneut laden"
            style={{
              background: 'transparent',
              border: '1px solid #555',
              borderRadius: 6,
              color: '#eee',
              cursor: 'pointer',
              fontSize: 11,
              padding: '2px 8px',
              flexShrink: 0,
            }}
          >
            ↻ Erneut versuchen
          </button>
        )}

        {/* A/P slice slider + W/L inputs — only shown once the volume is loaded */}
        {(status === 'ready' || status === 'rendering') && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Fensterbreite (Window Width)">
              <span style={{ color: '#aaa', fontSize: 11 }}>W</span>
              <input
                type="number"
                value={Math.round(ww)}
                min={1}
                step={50}
                onChange={handleWindowWidthChange}
                style={{ width: 52, fontSize: 11, background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 4 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Fensterlage (Window Level)">
              <span style={{ color: '#aaa', fontSize: 11 }}>L</span>
              <input
                type="number"
                value={Math.round(wl)}
                step={50}
                onChange={handleWindowCenterChange}
                style={{ width: 52, fontSize: 11, background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 4 }}
              />
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <span style={{ color: '#aaa', fontSize: 11 }}>Slice</span>
              <input
                type="range"
                aria-label={`Slice ${viewLabel}`}
                min={axisMin}
                max={axisMax}
                step={(axisRangeSpan / 200).toFixed(2)}
                value={slicePos}
                onChange={handleSliderChange}
                style={{ width: 90, accentColor, cursor: 'pointer' }}
                />
              <span
                style={{
                  color: '#fff',
                  minWidth: 50,
                  textAlign: 'right',
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {slicePos.toFixed(1)} mm
              </span>
            </label>
          </>
        )}
      </div>

      {/* ── VTK WebGL canvas ─────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', background: '#050505' }}
      >
        {/* Idle / error placeholder */}
        {(status === 'idle' || status === 'error') && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
              pointerEvents: 'none',
              gap: 12,
              padding: '0 24px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 34, opacity: 0.5 }}>{status === 'error' ? '⚠' : '⚡'}</div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.7,
                color: status === 'error' ? '#7a4a4a' : '#3a3a3a',
              maxWidth: 280,
            }}
          >
              {status === 'error'
                ? (errorCode ? ERROR_MESSAGES[errorCode] : 'Volumen nicht bereit')
                : `${viewLabel} — complete the arch to load volume`}
            </div>
          </div>
        )}

        {/* Arch position indicator — horizontal blue line */}
        {archLinePct !== null && status === 'ready' && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              // Map the A/P fraction to a vertical position in the viewport.
              // archLinePct=0 → anterior (top of A/P range) → top of viewport.
              top: `${archLinePct * 100}%`,
              height: 2,
              background: accentColor,
              opacity: 0.7,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {/* Label */}
            <span
              style={{
                position: 'absolute',
                right: 6,
                top: 3,
                fontSize: 10,
                color: accentColor,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                opacity: 0.9,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                userSelect: 'none',
              }}
            >
              arch pos
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
