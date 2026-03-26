import React, { useEffect, useRef, useState, useCallback } from 'react';
import { cache } from '@cornerstonejs/core';
import type { CenterlinePoint } from '../utils/buildCenterline';
import { getSharedFrames } from '../utils/dentalState';

export const ARCH_CROSS_SECTION_POSITION = 'DENTAL_ARCH_CROSS_SECTION_POSITION';
/** Fired by cross-section viewport on wheel scroll — tells CPR viewport to step */
export const ARCH_NAVIGATE_DELTA = 'DENTAL_ARCH_NAVIGATE_DELTA';

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
  position?: number; // -1 = prev, 0 = center (default), +1 = next
}

// ~4mm at 300 frames over 150mm arch: step to adjacent prev/next cross-sections
const CROSS_SECTION_STEP = 8;

// 50 mm × 50 mm field at 0.25 mm/px → 200 × 200 pixel output
const SLICE_SIZE_MM = 50;
const MM_PER_PX = 0.25;
const NUM_PX = Math.round(SLICE_SIZE_MM / MM_PER_PX); // 200

// Bone window: W=2000, L=400 → [-600 HU … 1400 HU]
const WL_LOW  = 400 - 1000; // -600
const WL_HIGH = 400 + 1000; // 1400

/**
 * DentalCrossSectionViewport
 *
 * Renders a 2D cross-section perpendicular to the dental arch at a
 * user-selected position along the panoramic curve.
 *
 * Rendering strategy: CPU-based canvas rasteriser using Cornerstone3D's
 * VoxelManager.  No vtk.js, no extra WebGL context — avoids the GPU
 * memory pressure that crashes the tab when the CPR panoramic is also
 * uploading the full 3-D texture.
 *
 * Data flow:
 *   User clicks panoramic CPR viewport
 *   → DentalCPRViewport fires ARCH_CROSS_SECTION_POSITION
 *   → Frenet frame at that position is passed here
 *   → For each pixel (u, v) in the output image:
 *       world = frame.point + N * u + B * v
 *       voxel = worldToIndex(world, volume)
 *       pixel = voxelManager.getAtIndex(voxel)
 *   → Pixels drawn to HTML canvas
 *
 * Coordinate system (stable — does NOT rotate as arch curves):
 *   Output image X = frame.normal   (buccal-lingual; B_stable = N_world-Z × T)
 *   Output image Y = frame.binormal (superior→inferior; top = crown, bottom = root apex)
 */
export default function DentalCrossSectionViewport({
  displaySets,
  position,
}: DentalCrossSectionViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'error'>('idle');
  const [positionLabel, setPositionLabel] = useState('');
  const [sliceCounter, setSliceCounter] = useState<{ idx: number; total: number } | null>(null);
  // Refs for use in event handlers (avoid stale closures)
  const currentIdxRef = useRef<number>(0);
  const totalSamplesRef = useRef<number>(1);

  // ── Volume lookup ──────────────────────────────────────────────────────────
  const getVolume = useCallback(() => {
    if (!displaySets?.length) return null;
    const ds = displaySets[0];

    if (ds.volumeId) {
      const vol = cache.getVolume(ds.volumeId);
      if (vol) return vol;
    }

    const derivedId = `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;
    const vol2 = cache.getVolume(derivedId);
    if (vol2) return vol2;

    const seriesUID: string | undefined = ds.SeriesInstanceUID;
    if (seriesUID) {
      const volumeCache = (cache as any)._volumeCache as Map<string, any> | undefined;
      if (volumeCache) {
        for (const [, v] of volumeCache) {
          if (
            v?.metadata?.SeriesInstanceUID === seriesUID ||
            (v?.imageIds?.[0] as string | undefined)?.includes(seriesUID)
          ) {
            return v;
          }
        }
      }
    }
    return null;
  }, [displaySets]);

  // ── CPU cross-section rasteriser ───────────────────────────────────────────
  const renderCrossSection = useCallback(
    (frame: CenterlinePoint, positionPct: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const volume = getVolume();
      if (!volume?.imageData) { setStatus('error'); return; }

      const vm = (volume as any).voxelManager;
      if (!vm) { setStatus('error'); return; }

      const imgData = volume.imageData;
      let dims: number[], spacing: number[], origin: number[], dir: number[];
      try {
        dims    = imgData.getDimensions?.() ?? [];
        spacing = imgData.getSpacing?.()    ?? [];
        origin  = imgData.getOrigin?.()     ?? [];
        dir     = imgData.getDirection?.()  ?? [1,0,0, 0,1,0, 0,0,1];
        if (!dims.length || dims.some((d: number) => d <= 0)) {
          setStatus('error');
          return;
        }
      } catch {
        setStatus('error');
        return;
      }

      const { point, normal: N, binormal: B } = frame;

      canvas.width  = NUM_PX;
      canvas.height = NUM_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const pixels = ctx.createImageData(NUM_PX, NUM_PX);
      const data   = pixels.data;
      const half   = (NUM_PX - 1) / 2;

      // vtk.js stores direction rows as: i-axis (row 0), j-axis (row 1), k-axis (row 2)
      // All in world space.  Since direction is orthonormal, its transpose = its inverse.
      // World → index:
      //   relative = world - origin
      //   local_i  = dot(relative, dir_row_0) / spacing[0]   etc.
      const [d00,d01,d02, d10,d11,d12, d20,d21,d22] = dir;
      const [sx, sy, sz] = spacing;
      const [ox, oy, oz] = origin;
      const [nx, ny, nz] = dims;

      for (let row = 0; row < NUM_PX; row++) {
        for (let col = 0; col < NUM_PX; col++) {
          // u = col offset (along N = buccal-lingual), v = row offset (along B = superior)
          const u = (col - half) * MM_PER_PX;
          const v = (row - half) * MM_PER_PX;

          const wx = point[0] + N[0] * u + B[0] * v;
          const wy = point[1] + N[1] * u + B[1] * v;
          const wz = point[2] + N[2] * u + B[2] * v;

          // world → voxel index (nearest neighbour)
          const rx = wx - ox, ry = wy - oy, rz = wz - oz;
          const vi = Math.round((rx * d00 + ry * d01 + rz * d02) / sx);
          const vj = Math.round((rx * d10 + ry * d11 + rz * d12) / sy);
          const vk = Math.round((rx * d20 + ry * d21 + rz * d22) / sz);

          let gray = 0;
          if (vi >= 0 && vi < nx && vj >= 0 && vj < ny && vk >= 0 && vk < nz) {
            // Try all common VoxelManager access patterns
            const hu: number =
              vm.getAtIJKPoint?.([vi, vj, vk]) ??
              vm.getAtIJK?.(vi, vj, vk)        ??
              vm.getAtIndex?.(vi + vj * nx + vk * nx * ny) ?? -1024;
            gray = Math.max(0, Math.min(255,
              Math.round(((hu - WL_LOW) / (WL_HIGH - WL_LOW)) * 255)
            ));
          }

          const i4 = (row * NUM_PX + col) * 4;
          data[i4]     = gray;
          data[i4 + 1] = gray;
          data[i4 + 2] = gray;
          data[i4 + 3] = 255;
        }
      }

      ctx.putImageData(pixels, 0, 0);
      setStatus('ready');
      setPositionLabel(`${positionPct.toFixed(0)}%`);
    },
    [getVolume]
  );

  // ── Listen for cross-section position events ───────────────────────────────
  useEffect(() => {
    const handler = (evt: Event) => {
      const { splineIndex, numSamples } =
        (evt as CustomEvent<CrossSectionEventDetail>).detail;
      currentIdxRef.current = splineIndex;
      totalSamplesRef.current = numSamples;

      const frames = getSharedFrames();
      const offset = (position ?? 0) * CROSS_SECTION_STEP;
      const renderIdx = Math.max(0, Math.min(numSamples - 1, splineIndex + offset));
      const frame = frames[renderIdx] ?? (evt as CustomEvent<CrossSectionEventDetail>).detail.frame;

      setSliceCounter({ idx: renderIdx, total: numSamples });
      const pct = (renderIdx / Math.max(numSamples - 1, 1)) * 100;
      renderCrossSection(frame, pct);
    };
    window.addEventListener(ARCH_CROSS_SECTION_POSITION, handler);
    return () => window.removeEventListener(ARCH_CROSS_SECTION_POSITION, handler);
  }, [renderCrossSection, position]);

  // ── Mouse wheel: step along arch ───────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.deltaY > 0 ? 3 : -3;
    window.dispatchEvent(new CustomEvent(ARCH_NAVIGATE_DELTA, { detail: { delta: step } }));
  }, []);

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
        <span style={{ color: '#00aaff', fontWeight: 700, letterSpacing: '0.02em' }}>
          {position === -1 ? '⊥ Prev' : position === 1 ? '⊥ Next' : '⊥ Center'}
        </span>
        <span style={{ color: statusColour, flex: 1, fontSize: 11 }}>
          {status === 'idle'
            ? 'Click panoramic or use slider to navigate'
            : status === 'error'
            ? 'Volume not ready — complete the arch first'
            : positionLabel}
        </span>
        {sliceCounter && (
          <span style={{ color: '#555', fontSize: 11, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {sliceCounter.idx + 1} / {sliceCounter.total}
          </span>
        )}
      </div>

      {/* Canvas fills the remaining space, centered, maintaining square aspect */}
      <div
        onWheel={onWheel}
        style={{
          flex: 1,
          position: 'relative',
          background: '#050505',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: status === 'ready' ? 'ns-resize' : 'default',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: status === 'idle' ? 'none' : 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
          }}
        />
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
            <div
              style={{
                fontSize: 12,
                textAlign: 'center',
                maxWidth: 240,
                lineHeight: 1.6,
              }}
            >
              Click anywhere on the panoramic CPR to show the perpendicular
              cross-section at that arch position.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
