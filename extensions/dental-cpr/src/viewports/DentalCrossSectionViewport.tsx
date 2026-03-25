import React, { useEffect, useRef, useState, useCallback } from 'react';
import { cache } from '@cornerstonejs/core';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageReslice from '@kitware/vtk.js/Imaging/Core/ImageReslice';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import type { CenterlinePoint } from '../utils/buildCenterline';

export const ARCH_CROSS_SECTION_POSITION = 'DENTAL_ARCH_CROSS_SECTION_POSITION';

export interface CrossSectionEventDetail {
  frame: CenterlinePoint;
  splineIndex: number;
  numSamples: number;
}

interface DentalCrossSectionViewportProps {
  viewportId: string;
  displaySets: any[];
  servicesManager: any;
  extensionManager: any;
  commandsManager: any;
}

/**
 * DentalCrossSectionViewport
 *
 * Renders a 2D cross-section perpendicular to the dental arch at a
 * user-selected position along the panoramic curve.
 *
 * Data flow:
 *   User clicks on panoramic CPR viewport
 *   → DentalCPRViewport fires ARCH_CROSS_SECTION_POSITION
 *   → buildCenterlinePoints() provides the Frenet frame at that position
 *   → vtkImageReslice cuts the CBCT volume at that oblique plane
 *   → vtk.js renders the perpendicular cross-section slice
 *
 * Coordinate system:
 *   Output image X-axis = frame.normal  (points "outward" from arch center)
 *   Output image Y-axis = frame.binormal (points "up" / superior)
 *   Slice normal       = frame.tangent  (points along the arch)
 */
export default function DentalCrossSectionViewport({
  viewportId,
  displaySets,
}: DentalCrossSectionViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const rendererRef = useRef<ReturnType<typeof vtkRenderer.newInstance> | null>(null);
  const renderWindowRef = useRef<ReturnType<typeof vtkRenderWindow.newInstance> | null>(null);
  const openGLWindowRef = useRef<ReturnType<typeof vtkOpenGLRenderWindow.newInstance> | null>(null);
  const resliceRef = useRef<ReturnType<typeof vtkImageReslice.newInstance> | null>(null);
  const actorRef = useRef<ReturnType<typeof vtkImageSlice.newInstance> | null>(null);

  const [status, setStatus] = useState<'idle' | 'ready' | 'error'>('idle');
  const [positionLabel, setPositionLabel] = useState('');

  // ── VTK pipeline init ───────────────────────────────────────────────────────
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

      rendererRef.current = renderer;
      renderWindowRef.current = renderWindow;
      openGLWindowRef.current = openGLWindow;
    } catch (e) {
      console.error('[DentalCrossSection] VTK init error:', e);
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

  // ── Get volume ──────────────────────────────────────────────────────────────
  const getVolume = useCallback(() => {
    if (!displaySets?.length) return null;
    const ds = displaySets[0];

    // 1. Try explicit volumeId (set by 3D SOP class handler)
    if (ds.volumeId) {
      const vol = cache.getVolume(ds.volumeId);
      if (vol) return vol;
    }

    // 2. Try derived from displaySetInstanceUID
    const derivedId = `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;
    const volByDerived = cache.getVolume(derivedId);
    if (volByDerived) return volByDerived;

    // 3. Scan cache for volume whose imageIds reference this SeriesInstanceUID
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

  // ── Render cross-section at a Frenet frame ──────────────────────────────────
  const renderCrossSection = useCallback(
    (frame: CenterlinePoint, positionPct: number) => {
      const volume = getVolume();
      if (!volume?.imageData) {
        setStatus('error');
        return;
      }

      // Cornerstone3D v2+ uses VoxelManager — populate scalars before vtk.js reslice reads them
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
            console.log('[DentalCS] Populated', rawScalars.length, 'scalars from VoxelManager');
          }
        } catch (scalarErr) {
          console.warn('[DentalCS] Scalar population failed:', (scalarErr as Error).message);
        }
      }

      const renderer = rendererRef.current;
      const renderWindow = renderWindowRef.current;
      if (!renderer || !renderWindow) return;

      const { point, tangent: T, normal: N, binormal: B } = frame;

      // Build or reuse the reslice filter
      let reslice = resliceRef.current;
      if (!reslice) {
        reslice = vtkImageReslice.newInstance();
        reslice.setInputData(imgData ?? volume.imageData);
        reslice.setOutputDimensionality(2);
        reslice.setInterpolationMode(1); // 1 = linear (setInterpolationModeToLinear not available in this vtk.js build)
        reslice.setTransformInputSampling(false);

        // 40 mm × 40 mm cross-section at 0.3 mm/pixel spacing
        const sliceSizeMm = 40;
        const mmPerPix = 0.3;
        const halfPx = Math.round(sliceSizeMm / mmPerPix / 2);
        reslice.setOutputExtent([-halfPx, halfPx, -halfPx, halfPx, 0, 0]);
        reslice.setOutputSpacing([mmPerPix, mmPerPix, 1]);

        const mapper = vtkImageMapper.newInstance();
        mapper.setInputConnection(reslice.getOutputPort());

        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);
        // Bone window: W=2000 L=400
        actor.getProperty().setColorWindow(2000);
        actor.getProperty().setColorLevel(400);

        renderer.addActor(actor);
        resliceRef.current = reslice;
        actorRef.current = actor;
      } else {
        reslice.setInputData(imgData ?? volume.imageData);
      }

      // vtkMatrix4x4 in vtk.js is ROW-MAJOR (data[i*4+j] = element[row i][col j]).
      // setResliceAxes rows 0-2 = direction cosines of output X/Y/Z in world space.
      // Column 3 (positions 3, 7, 11) = world-space origin of the output image.
      // Output X = N (buccal-lingual), Y = B (superior-inferior), Z = T (slice normal)
      (reslice as any).setResliceAxes(new Float64Array([
        N[0], N[1], N[2], point[0],  // row 0: output X direction = N, origin X
        B[0], B[1], B[2], point[1],  // row 1: output Y direction = B, origin Y
        T[0], T[1], T[2], point[2],  // row 2: output Z direction = T, origin Z
        0,    0,    0,    1,          // row 3: homogeneous
      ]));

      // Explicit camera — resetCamera() confuses the flat Z=0 reslice output.
      // Output extent [-67,67,-67,67,0,0] at 0.3 mm/px → ±20.1 mm in X/Y.
      // Look from +Z; viewUp=(0,-1,0) → output-Y (B = inferior) appears at bottom.
      const camera = renderer.getActiveCamera();
      camera.setParallelProjection(true);
      camera.setFocalPoint(0, 0, 0);
      camera.setPosition(0, 0, 500);
      camera.setViewUp(0, -1, 0);
      camera.setParallelScale(21);
      renderer.resetCameraClippingRange();
      renderWindow.render();

      setStatus('ready');
      setPositionLabel(`${Math.round(positionPct)}% along arch`);
    },
    [getVolume]
  );

  // ── Listen for cross-section position events ────────────────────────────────
  useEffect(() => {
    const handler = (evt: Event) => {
      const { frame, splineIndex, numSamples } =
        (evt as CustomEvent<CrossSectionEventDetail>).detail;
      const pct = (splineIndex / Math.max(numSamples - 1, 1)) * 100;
      renderCrossSection(frame, pct);
    };

    window.addEventListener(ARCH_CROSS_SECTION_POSITION, handler);
    return () => window.removeEventListener(ARCH_CROSS_SECTION_POSITION, handler);
  }, [renderCrossSection]);

  // ── Status colour ───────────────────────────────────────────────────────────
  const statusColour = status === 'ready' ? '#00ff88' : status === 'error' ? '#ff6b6b' : '#555';

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
      {/* Toolbar */}
      <div
        style={{
          flexShrink: 0,
          padding: '6px 12px',
          background: '#111',
          borderBottom: '1px solid #222',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
        }}
      >
        <span style={{ color: '#00aaff', fontWeight: 700, letterSpacing: '0.02em' }}>⊥ Cross-Section</span>
        <span style={{ color: statusColour, flex: 1, fontSize: 11 }}>
          {status === 'idle'
            ? 'Click panoramic or use slider to navigate'
            : status === 'error'
            ? 'Volume not ready — complete the arch first'
            : positionLabel}
        </span>
      </div>

      {/* VTK canvas */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', background: '#050505' }}
      >
        {status === 'idle' && (
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
              gap: 10,
            }}
          >
            <div style={{ fontSize: 40 }}>✚</div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 240, lineHeight: 1.6 }}>
              Click anywhere on the panoramic CPR to show the perpendicular
              cross-section at that arch position.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
