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

// ── Props ─────────────────────────────────────────────────────────────────────

interface DentalMPRViewportProps {
  viewportId: string;
  displaySets: any[];
  servicesManager: any;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RenderStatus = 'idle' | 'rendering' | 'ready' | 'error';

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

  // Slider: current origin Y in mm (anterior-posterior position)
  const [sliceY, setSliceY]     = useState(0);
  const [yMin, setYMin]         = useState(0);
  const [yMax, setYMax]         = useState(1);

  // Arch position indicator: pixel-row fraction [0,1] in the viewport,
  // null when no event has been received yet
  const [archLinePct, setArchLinePct] = useState<number | null>(null);

  // ── VTK pipeline init ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const testCanvas = document.createElement('canvas');
    const hasWebGL = !!(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'));
    if (!hasWebGL) {
      setStatus('error');
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

  // ── Volume lookup (mirrors DentalCrossSectionViewport.getVolume) ──────────
  const getVolume = useCallback(() => {
    if (!displaySets?.length) return null;
    const ds = displaySets[0];

    // 1. Explicit volumeId set by the 3D SOP class handler
    if (ds.volumeId) {
      const vol = cache.getVolume(ds.volumeId);
      if (vol) return vol;
    }

    // 2. Derived from displaySetInstanceUID (OHIF streaming volume convention)
    const derivedId = `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;
    const volByDerived = cache.getVolume(derivedId);
    if (volByDerived) return volByDerived;

    // 3. Scan the internal volume cache keyed by SeriesInstanceUID
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

  // ── Render / update the coronal slice ─────────────────────────────────────
  const renderCoronalSlice = useCallback(
    (originY: number) => {
      try {
      const volume = getVolume();
      // imageData must exist AND have a valid scalar type (not just an empty proxy)
      const imgDataCheck = volume?.imageData;
      if (!imgDataCheck) { setStatus('error'); return; }
      try { if (!imgDataCheck.getNumberOfPoints || imgDataCheck.getNumberOfPoints() < 1) { setStatus('error'); return; } } catch { setStatus('error'); return; }

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
      const volYMin = bounds[2];
      const volYMax = bounds[3];
      yBoundsRef.current = [volYMin, volYMax];
      setYMin(volYMin);
      setYMax(volYMax);

      // Compute output image half-extents in pixels
      // Full X extent (left-right) and Z extent (superior-inferior) of the volume
      const xSpan = bounds[1] - bounds[0]; // mm
      const zSpan = bounds[5] - bounds[4]; // mm
      const mmPerPix = 0.4;
      const halfX = Math.ceil(xSpan / 2 / mmPerPix);
      const halfZ = Math.ceil(zSpan / 2 / mmPerPix);

      // Centre of volume in X and Z
      const centerX = (bounds[0] + bounds[1]) / 2;
      const centerZ = (bounds[4] + bounds[5]) / 2;

      // Build or reuse the reslice filter
      let reslice = resliceRef.current;
      if (!reslice) {
        reslice = vtkImageReslice.newInstance();
        reslice.setOutputDimensionality(2);
        reslice.setInterpolationMode(1); // linear
        reslice.setTransformInputSampling(false);

        const mapper = vtkImageMapper.newInstance();
        mapper.setInputConnection(reslice.getOutputPort());

        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);
        // Bone window: W=2000, L=400
        actor.getProperty().setColorWindow(2000);
        actor.getProperty().setColorLevel(400);

        renderer.addActor(actor);
        resliceRef.current = reslice;
        actorRef.current = actor;
      }

      reslice.setInputData(imgData);
      reslice.setOutputExtent([-halfX, halfX, -halfZ, halfZ, 0, 0]);
      reslice.setOutputSpacing([mmPerPix, mmPerPix, 1]);

      // Coronal reslice matrix (row-major Float64Array, as required by vtk.js):
      //   Row 0: output X direction = [1,0,0] (patient left-right) + origin.x
      //   Row 1: output Y direction = [0,0,-1] (patient superior-inferior, flipped for screen-up)
      //          + origin.z  (note: origin here is for this OUTPUT axis = patient Z)
      //   Row 2: output Z direction = [0,1,0] (slice normal = patient A/P) + origin.y
      //   Row 3: homogeneous
      //
      // The "origin" column gives the world-space point at the image centre.
      // We keep X and Z at the volume centre and sweep Y for A/P navigation.
      (reslice as any).setResliceAxes(new Float64Array([
        1,  0,  0,  centerX,  // row 0: output X = patient X,  origin = centre X
        0,  0, -1,  centerZ,  // row 1: output Y = -patient Z, origin = centre Z
        0,  1,  0,  originY,  // row 2: slice normal = patient Y, slice Y position
        0,  0,  0,  1,        // row 3: homogeneous
      ]));

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
      console.log(
        `[DentalMPR] Coronal slice rendered at Y=${originY.toFixed(1)} mm`,
        `| extent ±${halfX}×${halfZ} px @ ${mmPerPix} mm/px`
      );
      } catch (err) {
        console.warn('[DentalMPR] renderCoronalSlice error:', (err as Error).message);
        setStatus('error');
      }
    },
    [getVolume]
  );

  // ── Auto-load: poll cache every 500 ms until imageData is available ───────
  useEffect(() => {
    if (!displaySets?.length) return;

    let rafId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tryLoad = () => {
      if (cancelled) return;
      const vol = getVolume();
      let hasData = false;
      try { hasData = !!(vol?.imageData && vol.imageData.getNumberOfPoints?.() > 0); } catch { /* not ready */ }
      if (hasData) {
        // Volume ready — render the middle coronal slice
        const bounds = vol!.imageData.getBounds() as number[];
        const midY = (bounds[2] + bounds[3]) / 2;
        setSliceY(midY);
        renderCoronalSlice(midY);
      } else {
        rafId = setTimeout(tryLoad, 800);
      }
    };

    tryLoad();

    return () => {
      cancelled = true;
      if (rafId !== null) clearTimeout(rafId);
    };
  }, [displaySets, getVolume, renderCoronalSlice]);

  // ── Slider change handler ─────────────────────────────────────────────────
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const y = Number(e.target.value);
      setSliceY(y);
      renderCoronalSlice(y);
    },
    [renderCoronalSlice]
  );

  // ── Arch position indicator ────────────────────────────────────────────────
  // When the CPR viewport fires a cross-section event, the event carries a
  // Frenet frame whose `point` is in patient world space.  We map its Y
  // coordinate to a [0,1] fraction within the displayed Y range so we can
  // draw an overlay line at the correct screen row.
  useEffect(() => {
    const handler = (evt: Event) => {
      const { frame } = (evt as CustomEvent<CrossSectionEventDetail>).detail;
      const [, yBoundsMax] = yBoundsRef.current;
      const yBoundsMin = yBoundsRef.current[0];
      const yRange = yBoundsMax - yBoundsMin;
      if (yRange <= 0) return;

      // frame.point[1] is the arch sample's patient-Y coordinate.
      // Map to fraction along the viewport's Y axis.
      // The viewport displays the volume from yMin (top) to yMax (bottom)
      // (because output Y = -patient Z = superior down; but the A/P position
      // only shifts where we cut, not how it appears within the slice).
      // For the indicator we map arch-Y along the visible Y slider range.
      const pct = (frame.point[1] - yBoundsMin) / yRange;
      setArchLinePct(Math.max(0, Math.min(1, pct)));
    };

    window.addEventListener(ARCH_CROSS_SECTION_POSITION, handler);
    return () => window.removeEventListener(ARCH_CROSS_SECTION_POSITION, handler);
  }, []);

  // ── Status colour ─────────────────────────────────────────────────────────
  const statusColor: Record<RenderStatus, string> = {
    idle:      '#555',
    rendering: '#ffcc00',
    ready:     '#00ff88',
    error:     '#ff6b6b',
  };

  const yRangeSpan = yMax - yMin || 1;

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
        {/* Viewport label */}
        <span style={{ color: '#00aaff', fontWeight: 700, letterSpacing: '0.02em' }}>
          MPR · Coronal
        </span>

        {/* Status message */}
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
          {status === 'ready'     && `Slice  ${sliceY.toFixed(1)} mm`}
          {status === 'error'     && 'Volume not ready'}
        </span>

        {/* A/P slice slider — only shown once the volume is loaded */}
        {(status === 'ready' || status === 'rendering') && (
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
              min={yMin}
              max={yMax}
              step={(yRangeSpan / 200).toFixed(2)}
              value={sliceY}
              onChange={handleSliderChange}
              style={{ width: 90, accentColor: '#00aaff', cursor: 'pointer' }}
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
              {sliceY.toFixed(1)} mm
            </span>
          </label>
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
            <div style={{ fontSize: 34, opacity: 0.5 }}>⚡</div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.7,
                color: '#3a3a3a',
                maxWidth: 280,
              }}
            >
              Coronal MPR — Complete the arch to load volume
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
              background: '#00aaff',
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
                color: '#00aaff',
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
