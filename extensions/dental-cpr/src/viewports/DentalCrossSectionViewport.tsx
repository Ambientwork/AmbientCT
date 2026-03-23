import React, { useEffect, useRef, useState, useCallback } from 'react';
import { cache } from '@cornerstonejs/core';
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

    const renderWindow = vtkRenderWindow.newInstance();
    const renderer = vtkRenderer.newInstance({ background: [0.03, 0.03, 0.03] });
    renderWindow.addRenderer(renderer);

    const openGLWindow = vtkOpenGLRenderWindow.newInstance();
    openGLWindow.setContainer(container);
    openGLWindow.setSize(container.clientWidth || 350, container.clientHeight || 450);
    renderWindow.addView(openGLWindow);

    const interactor = vtkRenderWindowInteractor.newInstance();
    interactor.setView(openGLWindow);
    interactor.initialize();
    interactor.bindEvents(container);

    rendererRef.current = renderer;
    renderWindowRef.current = renderWindow;
    openGLWindowRef.current = openGLWindow;

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

  // ── Get volume ──────────────────────────────────────────────────────────────
  const getVolume = useCallback(() => {
    if (!displaySets?.length) return null;
    const ds = displaySets[0];
    const volumeId =
      ds.volumeId ?? `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;
    return cache.getVolume(volumeId);
  }, [displaySets]);

  // ── Render cross-section at a Frenet frame ──────────────────────────────────
  const renderCrossSection = useCallback(
    (frame: CenterlinePoint, positionPct: number) => {
      const volume = getVolume();
      if (!volume?.imageData) {
        setStatus('error');
        return;
      }

      const renderer = rendererRef.current;
      const renderWindow = renderWindowRef.current;
      if (!renderer || !renderWindow) return;

      const { point, tangent: T, normal: N, binormal: B } = frame;

      // Build or reuse the reslice filter
      let reslice = resliceRef.current;
      if (!reslice) {
        reslice = vtkImageReslice.newInstance();
        reslice.setInputData(volume.imageData);
        reslice.setOutputDimensionality(2);
        reslice.setInterpolationModeToLinear();
        reslice.setTransformInputSampling(false);

        // 40 mm × 40 mm cross-section at 0.3 mm/pixel
        const sliceSizeMm = 40;
        const pixPerMm = 0.3;
        const halfPx = Math.round(sliceSizeMm / pixPerMm / 2);
        reslice.setOutputExtent([-halfPx, halfPx, -halfPx, halfPx, 0, 0]);
        reslice.setOutputSpacing([1 / pixPerMm, 1 / pixPerMm, 1]);

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
        reslice.setInputData(volume.imageData);
      }

      // Direction cosines: rows = output x/y/z axes in world space
      // Output x = N (left-right across arch)
      // Output y = B (superior-inferior)
      // Output z = T (along arch = slice normal)
      reslice.setResliceAxesDirectionCosines([
        N[0], N[1], N[2],
        B[0], B[1], B[2],
        T[0], T[1], T[2],
      ]);
      reslice.setResliceAxesOrigin(point);

      renderer.resetCamera();
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
        fontFamily: 'ui-monospace, monospace',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          flexShrink: 0,
          padding: '5px 12px',
          background: '#181818',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
        }}
      >
        <span style={{ color: '#00aaff', fontWeight: 700 }}>✚ Cross-Section</span>
        <span style={{ color: statusColour, flex: 1 }}>
          {status === 'idle'
            ? 'Click on the panoramic to show a perpendicular cross-section.'
            : status === 'error'
            ? 'CBCT volume not ready.'
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
