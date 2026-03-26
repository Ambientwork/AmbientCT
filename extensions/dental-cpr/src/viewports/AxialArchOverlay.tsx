import React, { useRef, useEffect, useCallback } from 'react';
import { getSharedFrames } from '../utils/dentalState';
import {
  ARCH_CROSS_SECTION_POSITION,
  CROSS_SECTION_STEP,
} from './DentalCrossSectionViewport';
import type { CrossSectionEventDetail } from './DentalCrossSectionViewport';
import { ARCH_SPLINE_COMPLETED } from '../tools/DentalArchSplineTool';

/**
 * AxialArchOverlay
 *
 * Transparent canvas overlay rendered on top of the axial Cornerstone3D
 * viewport.  Draws:
 *   - The arch spline path as a thin dashed curve (full arch visible at once)
 *   - Three perpendicular cross-section marker lines:
 *       ⊥ Prev  — dashed, low opacity
 *       ⊥ Center — solid, full opacity  (matches panoramic cursor)
 *       ⊥ Next  — dashed, low opacity
 *
 * Projection: uses Cornerstone3D's viewport.worldToCanvas() so the overlay
 * stays aligned with the CT image through any pan / zoom / window-level.
 */
export default function AxialArchOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentIdxRef = useRef<number>(-1);

  // ── Helpers ──────────────────────────────────────────────────────────────
  /** Returns the Cornerstone3D cbctAxial viewport if available. */
  const getViewport = useCallback((): any | null => {
    const cs = (window as any).cornerstone;
    if (!cs) return null;
    const engines: any[] = cs.getRenderingEngines?.() ?? [];
    for (const engine of engines) {
      try {
        const vp = engine.getViewport('cbctAxial');
        if (vp) return vp;
      } catch { /* viewport not yet registered */ }
    }
    return null;
  }, []);

  // ── Main draw function ───────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const container = canvas.parentElement;
    if (!container) return;

    // Match canvas pixel dimensions to the container
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width  = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const frames = getSharedFrames();
    if (!frames.length) return;

    const viewport = getViewport();
    if (!viewport) return;

    // Project a world point to canvas [col, row]
    const toCanvas = (world: [number, number, number]): [number, number] => {
      try {
        const cp = viewport.worldToCanvas(world);
        return [cp[0], cp[1]];
      } catch {
        return [-9999, -9999];
      }
    };

    // ── Draw arch spline ──────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 170, 255, 0.45)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i < frames.length; i++) {
      const [cx, cy] = toCanvas(frames[i].point);
      if (i === 0) ctx.moveTo(cx, cy);
      else         ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.restore();

    // ── Draw cross-section markers ────────────────────────────────────────
    const centerIdx = currentIdxRef.current;
    if (centerIdx < 0) return;

    const markers: Array<{ offset: number; color: string; width: number; dash: number[] }> = [
      { offset: -CROSS_SECTION_STEP, color: 'rgba(0,170,255,0.60)', width: 1, dash: [5, 5] },
      { offset:  0,                  color: 'rgba(0,170,255,1.00)', width: 2, dash: []     },
      { offset: +CROSS_SECTION_STEP, color: 'rgba(0,170,255,0.60)', width: 1, dash: [5, 5] },
    ];

    // Length of the marker line on each side of the arch (in world mm)
    const HALF_LEN_MM = 20;

    for (const { offset, color, width, dash } of markers) {
      const fi = Math.max(0, Math.min(frames.length - 1, centerIdx + offset));
      const frame = frames[fi];

      // Marker line: from point − normal*HALF to point + normal*HALF
      const pt1: [number, number, number] = [
        frame.point[0] + frame.normal[0] * HALF_LEN_MM,
        frame.point[1] + frame.normal[1] * HALF_LEN_MM,
        frame.point[2],
      ];
      const pt2: [number, number, number] = [
        frame.point[0] - frame.normal[0] * HALF_LEN_MM,
        frame.point[1] - frame.normal[1] * HALF_LEN_MM,
        frame.point[2],
      ];

      const [x1, y1] = toCanvas(pt1);
      const [x2, y2] = toCanvas(pt2);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();

      // Tick mark (small perpendicular cross) at the arch point for center
      if (offset === 0) {
        const [cx, cy] = toCanvas(frame.point);
        const TICK = 5;
        // Perpendicular tick along arch tangent direction
        const [tx1, ty1] = toCanvas([
          frame.point[0] + frame.tangent[0] * TICK,
          frame.point[1] + frame.tangent[1] * TICK,
          frame.point[2],
        ]);
        const [tx2, ty2] = toCanvas([
          frame.point[0] - frame.tangent[0] * TICK,
          frame.point[1] - frame.tangent[1] * TICK,
          frame.point[2],
        ]);
        ctx.save();
        ctx.strokeStyle = 'rgba(0,170,255,1)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tx1, ty1);
        ctx.lineTo(tx2, ty2);
        ctx.stroke();
        // Dot at intersection
        ctx.fillStyle = '#00aaff';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }, [getViewport]);

  // ── Event listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    const onArch = () => setTimeout(redraw, 150); // brief delay for frames to be stored
    const onPos  = (evt: Event) => {
      const { splineIndex } = (evt as CustomEvent<CrossSectionEventDetail>).detail;
      currentIdxRef.current = splineIndex;
      redraw();
    };

    window.addEventListener(ARCH_SPLINE_COMPLETED, onArch);
    window.addEventListener(ARCH_CROSS_SECTION_POSITION, onPos);
    return () => {
      window.removeEventListener(ARCH_SPLINE_COMPLETED, onArch);
      window.removeEventListener(ARCH_CROSS_SECTION_POSITION, onPos);
    };
  }, [redraw]);

  // Redraw when the container is resized (pan/zoom in Cornerstone also fires resize)
  useEffect(() => {
    const container = canvasRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [redraw]);

  // Also redraw when Cornerstone fires a camera-modified event (pan/zoom)
  useEffect(() => {
    const onCameraModified = () => redraw();
    window.addEventListener('cornerstoneViewportCameraModified', onCameraModified);
    window.addEventListener('CORNERSTONE_VIEWPORT_NEW_IMAGE',   onCameraModified);
    // Cornerstone3D custom events
    document.addEventListener('cornerstonecamerareset',         onCameraModified);
    document.addEventListener('cornerstonecameramodified',      onCameraModified);
    return () => {
      window.removeEventListener('cornerstoneViewportCameraModified', onCameraModified);
      window.removeEventListener('CORNERSTONE_VIEWPORT_NEW_IMAGE',   onCameraModified);
      document.removeEventListener('cornerstonecamerareset',          onCameraModified);
      document.removeEventListener('cornerstonecameramodified',       onCameraModified);
    };
  }, [redraw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
