import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cache } from '@cornerstonejs/core';
import { startBoundedPoll } from '../utils/boundedPoll';
import { extractVolumeGeometry, findVolumeForDisplaySet, isVolumeReady } from '../utils/volumeLookup';
import { checkVolumeGeometryCompatibility, type GeometryCompatibilityResult } from '../utils/geometryCompat';

interface DentalMPRDiffViewportProps {
  viewportId: string;
  primaryDisplaySets: any[];
  secondaryDisplaySets: any[];
  orientation?: 'coronal' | 'sagittal';
  labelOverride?: string;
  /**
   * Controlled slice-position sync (plan §10 P3.4) — same contract as
   * DentalMPRViewport. The diff column never initializes this value itself
   * (only the source/MAR columns do); while it is `null`/`undefined` the
   * panel waits rather than picking an independent slice.
   */
  sliceWorldCoordinate?: number | null;
  /** Diff-scale half-range in HU ("compareOpacity"/diffWindow, plan §10 P3.4). */
  diffWindowHU?: number;
  onDiffWindowChange?: (diffWindowHU: number) => void;
  /** Total volume-load time budget before showing a retryable error. Default 45s. */
  pollTimeoutMs?: number;
}

type RenderStatus = 'idle' | 'rendering' | 'ready' | 'error';

/** PHI-free error codes — safe to show in the UI, never derived from tag/pixel data. */
type RenderErrorCode = 'VOLUME_LOAD_TIMEOUT' | 'VOLUME_EMPTY' | 'RENDER_FAILED' | 'GEOMETRY_INCOMPATIBLE';

const ERROR_MESSAGES: Record<RenderErrorCode, string> = {
  VOLUME_LOAD_TIMEOUT: 'Volumen konnte nicht geladen werden (Zeitüberschreitung)',
  VOLUME_EMPTY: 'Volumen enthält keine Daten',
  RENDER_FAILED: 'Rendering fehlgeschlagen',
  GEOMETRY_INCOMPATIBLE: 'Seriengeometrie nicht kompatibel',
};

const MM_PER_PX = 0.4;
const DEFAULT_DIFF_WINDOW_HU = 1500;
const DEFAULT_POLL_INTERVAL_MS = 800;
// See DentalMPRViewport's DEFAULT_POLL_TIMEOUT_MS — same reasoning; the diff
// viewport waits on the same two (up to hundreds-of-slices) volumes.
const DEFAULT_POLL_TIMEOUT_MS = 45000;

export default function DentalMPRDiffViewport({
  viewportId,
  primaryDisplaySets,
  secondaryDisplaySets,
  orientation = 'coronal',
  labelOverride,
  sliceWorldCoordinate,
  diffWindowHU,
  onDiffWindowChange,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
}: DentalMPRDiffViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [errorCode, setErrorCode] = useState<RenderErrorCode | null>(null);
  const [geometryIssue, setGeometryIssue] = useState<GeometryCompatibilityResult | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [slicePos, setSlicePos] = useState(0);
  const [axisMin, setAxisMin] = useState(0);
  const [axisMax, setAxisMax] = useState(1);
  const [stats, setStats] = useState<{ maxAbs: number; meanAbs: number } | null>(null);
  const [diffWindow, setDiffWindow] = useState(diffWindowHU ?? DEFAULT_DIFF_WINDOW_HU);

  const diffWindowRef = useRef(diffWindow);
  const geometryCheckedRef = useRef(false);
  const lastAppliedSliceRef = useRef<number | null>(null);
  const boundsRef = useRef<[number, number, number, number, number, number] | null>(null);

  const sliceWorldCoordinateRef = useRef(sliceWorldCoordinate);
  useEffect(() => { sliceWorldCoordinateRef.current = sliceWorldCoordinate; }, [sliceWorldCoordinate]);
  const onDiffWindowChangeRef = useRef(onDiffWindowChange);
  useEffect(() => { onDiffWindowChangeRef.current = onDiffWindowChange; }, [onDiffWindowChange]);

  const getPrimaryVolume = useCallback(
    () => findVolumeForDisplaySet(cache as any, primaryDisplaySets),
    [primaryDisplaySets]
  );
  const getSecondaryVolume = useCallback(
    () => findVolumeForDisplaySet(cache as any, secondaryDisplaySets),
    [secondaryDisplaySets]
  );

  const sampleHU = useCallback((volume: any, wx: number, wy: number, wz: number): number => {
    const imgData = volume?.imageData;
    const vm = volume?.voxelManager;
    if (!imgData || !vm) return -1024;

    const dims = imgData.getDimensions?.() ?? [];
    const spacing = imgData.getSpacing?.() ?? [];
    const origin = imgData.getOrigin?.() ?? [];
    const dir = imgData.getDirection?.() ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (!dims.length || !spacing.length || !origin.length || dir.length < 9) return -1024;

    const [d00, d01, d02, d10, d11, d12, d20, d21, d22] = dir;
    const [sx, sy, sz] = spacing;
    const [ox, oy, oz] = origin;
    const [nx, ny, nz] = dims;

    const rx = wx - ox;
    const ry = wy - oy;
    const rz = wz - oz;
    const vi = Math.round((rx * d00 + ry * d01 + rz * d02) / sx);
    const vj = Math.round((rx * d10 + ry * d11 + rz * d12) / sy);
    const vk = Math.round((rx * d20 + ry * d21 + rz * d22) / sz);

    if (vi < 0 || vi >= nx || vj < 0 || vj >= ny || vk < 0 || vk >= nz) {
      return -1024;
    }

    return (
      vm.getAtIJKPoint?.([vi, vj, vk]) ??
      vm.getAtIJK?.(vi, vj, vk) ??
      vm.getAtIndex?.(vi + vj * nx + vk * nx * ny) ??
      -1024
    );
  }, []);

  const diffToRgb = useCallback((diffHU: number): [number, number, number] => {
    const window = diffWindowRef.current || 1;
    const clamped = Math.max(-window, Math.min(window, diffHU));
    const ratio = Math.abs(clamped) / window;
    const intensity = Math.round(40 + ratio * 215);

    if (clamped >= 0) {
      return [intensity, Math.round(intensity * 0.75), 32];
    }
    return [32, Math.round(intensity * 0.7), intensity];
  }, []);

  const renderDiffSlice = useCallback((originPos: number) => {
    const primary = getPrimaryVolume();
    const secondary = getSecondaryVolume();
    const canvas = canvasRef.current;
    if (!primary?.imageData || !secondary?.imageData || !canvas) {
      setStatus('error');
      setErrorCode('VOLUME_EMPTY');
      return;
    }

    try {
      setStatus('rendering');

      const bounds = boundsRef.current
        ?? (primary.imageData.getBounds() as [number, number, number, number, number, number]);
      const sliderMin = orientation === 'sagittal' ? bounds[0] : bounds[2];
      const sliderMax = orientation === 'sagittal' ? bounds[1] : bounds[3];
      setAxisMin(sliderMin);
      setAxisMax(sliderMax);

      const horizontalMin = orientation === 'sagittal' ? bounds[2] : bounds[0];
      const horizontalMax = orientation === 'sagittal' ? bounds[3] : bounds[1];
      const zMin = bounds[4];
      const zMax = bounds[5];

      const widthPx = Math.max(32, Math.ceil((horizontalMax - horizontalMin) / MM_PER_PX));
      const heightPx = Math.max(32, Math.ceil((zMax - zMin) / MM_PER_PX));
      canvas.width = widthPx;
      canvas.height = heightPx;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setStatus('error');
        setErrorCode('RENDER_FAILED');
        return;
      }

      const image = ctx.createImageData(widthPx, heightPx);
      const data = image.data;
      let diffSum = 0;
      let diffMax = 0;
      let count = 0;

      for (let row = 0; row < heightPx; row++) {
        const zFrac = heightPx <= 1 ? 0 : row / (heightPx - 1);
        const wz = zMax - zFrac * (zMax - zMin);

        for (let col = 0; col < widthPx; col++) {
          const xFrac = widthPx <= 1 ? 0 : col / (widthPx - 1);
          const horizontal = horizontalMin + xFrac * (horizontalMax - horizontalMin);

          const wx = orientation === 'sagittal' ? originPos : horizontal;
          const wy = orientation === 'sagittal' ? horizontal : originPos;

          const primaryHU = sampleHU(primary, wx, wy, wz);
          const secondaryHU = sampleHU(secondary, wx, wy, wz);
          const diffHU = secondaryHU - primaryHU;
          const absDiff = Math.abs(diffHU);
          const [r, g, b] = diffToRgb(diffHU);

          diffSum += absDiff;
          diffMax = Math.max(diffMax, absDiff);
          count += 1;

          const i4 = (row * widthPx + col) * 4;
          data[i4] = r;
          data[i4 + 1] = g;
          data[i4 + 2] = b;
          data[i4 + 3] = 255;
        }
      }

      ctx.putImageData(image, 0, 0);
      lastAppliedSliceRef.current = originPos;
      setSlicePos(originPos);
      setStats({
        maxAbs: diffMax,
        meanAbs: count ? diffSum / count : 0,
      });
      setStatus('ready');
      setErrorCode(null);
    } catch (error) {
      console.warn('[DentalMPRDiff] render error:', (error as Error).message);
      setStatus('error');
      setErrorCode('RENDER_FAILED');
    }
  }, [diffToRgb, getPrimaryVolume, getSecondaryVolume, orientation, sampleHU]);

  // ── Bounded poll for both volumes, then a one-time geometry gate (plan §10
  //    P3.5) before any pixel diff is ever drawn ─────────────────────────────
  useEffect(() => {
    if (!primaryDisplaySets?.length || !secondaryDisplaySets?.length) {
      setStatus('idle');
      setErrorCode(null);
      return;
    }

    setStatus('idle');
    setErrorCode(null);
    setGeometryIssue(null);
    geometryCheckedRef.current = false;
    boundsRef.current = null;

    const handle = startBoundedPoll(
      { intervalMs: DEFAULT_POLL_INTERVAL_MS, timeoutMs: pollTimeoutMs },
      {
        isReady: () => isVolumeReady(getPrimaryVolume()) && isVolumeReady(getSecondaryVolume()),
        onReady: () => {
          const primary = getPrimaryVolume();
          const secondary = getSecondaryVolume();

          // Geometry compatibility gate — runs exactly once per (re)load.
          // On mismatch: status=error, no pixel diff is ever drawn, and only
          // a PHI-free reason code / numeric delta reaches the console.
          if (!geometryCheckedRef.current) {
            geometryCheckedRef.current = true;
            const geomA = extractVolumeGeometry(primary);
            const geomB = extractVolumeGeometry(secondary);
            if (!geomA || !geomB) {
              setStatus('error');
              setErrorCode('VOLUME_EMPTY');
              return;
            }
            const compat = checkVolumeGeometryCompatibility(geomA, geomB);
            if (!compat.compatible) {
              console.debug('[DentalMPRDiff] geometry incompatible:', compat.reasonCode, compat.debugDetail);
              setGeometryIssue(compat);
              setStatus('error');
              setErrorCode('GEOMETRY_INCOMPATIBLE');
              return;
            }
          }

          boundsRef.current = primary.imageData.getBounds() as [number, number, number, number, number, number];
          const bounds = boundsRef.current;
          const mid = orientation === 'sagittal'
            ? (bounds[0] + bounds[1]) / 2
            : (bounds[2] + bounds[3]) / 2;

          // The diff column never initializes the shared coordinate itself —
          // it only renders once a source/MAR column has lifted a value.
          const controlled = sliceWorldCoordinateRef.current;
          const targetPos = typeof controlled === 'number' ? controlled : (controlled === undefined ? mid : null);
          if (targetPos === null) return; // controlled but not yet initialized — wait for a sibling
          renderDiffSlice(targetPos);
        },
        onTimeout: () => {
          setStatus('error');
          setErrorCode('VOLUME_LOAD_TIMEOUT');
        },
      }
    );

    return () => handle.cancel();
  }, [getPrimaryVolume, getSecondaryVolume, orientation, primaryDisplaySets, renderDiffSlice, secondaryDisplaySets, pollTimeoutMs, retryToken]);

  // Once geometry has been confirmed compatible and volumes are ready, keep
  // following the shared slice coordinate as siblings move it.
  useEffect(() => {
    if (sliceWorldCoordinate === undefined || sliceWorldCoordinate === null) return;
    if (!geometryCheckedRef.current || geometryIssue) return;
    if (status !== 'ready' && status !== 'rendering') return;
    const last = lastAppliedSliceRef.current;
    if (last !== null && Math.abs(sliceWorldCoordinate - last) < 1e-6) return;
    renderDiffSlice(sliceWorldCoordinate);
  }, [sliceWorldCoordinate, status, geometryIssue, renderDiffSlice]);

  // Controlled diff-scale sync (shared "compareOpacity"/diffWindow, plan §10 P3.4)
  useEffect(() => {
    if (diffWindowHU === undefined || diffWindowHU === diffWindowRef.current) return;
    diffWindowRef.current = diffWindowHU;
    setDiffWindow(diffWindowHU);
    if (lastAppliedSliceRef.current !== null) renderDiffSlice(lastAppliedSliceRef.current);
  }, [diffWindowHU, renderDiffSlice]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    renderDiffSlice(Number(e.target.value));
  }, [renderDiffSlice]);

  const handleDiffWindowChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    if (!Number.isFinite(next) || next <= 0) return;
    diffWindowRef.current = next;
    setDiffWindow(next);
    if (lastAppliedSliceRef.current !== null) renderDiffSlice(lastAppliedSliceRef.current);
    onDiffWindowChangeRef.current?.(next);
  }, [renderDiffSlice]);

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorCode(null);
    setGeometryIssue(null);
    setRetryToken(t => t + 1);
  }, []);

  const viewLabel = labelOverride ?? (orientation === 'sagittal' ? 'Diff · Sagittal' : 'Diff · Coronal');
  const sliceLabel = orientation === 'sagittal' ? 'X' : 'Y';
  const axisRangeSpan = axisMax - axisMin || 1;
  const errorMessage = errorCode === 'GEOMETRY_INCOMPATIBLE'
    ? (geometryIssue?.message ?? ERROR_MESSAGES.GEOMETRY_INCOMPATIBLE)
    : (errorCode ? ERROR_MESSAGES[errorCode] : 'Volumes not ready');

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
        <span style={{ color: '#f59e0b', fontWeight: 700, letterSpacing: '0.02em' }}>
          {viewLabel}
        </span>
        <span
          style={{
            flex: 1,
            color: status === 'error' ? '#ff6b6b' : status === 'ready' ? '#f59e0b' : '#999',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: 11,
          }}
        >
          {status === 'idle' && 'Waiting for volumes…'}
          {status === 'rendering' && 'Rendering difference…'}
          {status === 'ready' && stats && `Slice ${sliceLabel} ${slicePos.toFixed(1)} mm · mean |diff| ${stats.meanAbs.toFixed(1)} HU · max ${stats.maxAbs.toFixed(0)} HU`}
          {status === 'error' && `Fehler: ${errorMessage}`}
        </span>

        {status === 'error' && (
          <button
            onClick={handleRetry}
            title="Erneut versuchen"
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#aaa',
            fontSize: 10,
            flexShrink: 0,
          }}
          title={`Farblegende der HU-Differenz — Skala ±${Math.round(diffWindow)} HU`}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, display: 'inline-block', background: '#f59e0b', borderRadius: 2 }} />
            MAR höher
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, display: 'inline-block', background: '#60a5fa', borderRadius: 2 }} />
            MAR niedriger
          </span>
          <span style={{ color: '#666' }}>±{Math.round(diffWindow)} HU</span>
        </div>

        {(status === 'ready' || status === 'rendering') && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Diff-Skalierung (halbe Skala in HU)">
              <span style={{ color: '#aaa', fontSize: 11 }}>Skala</span>
              <input
                type="range"
                aria-label={`Skala ${viewLabel}`}
                min={100}
                max={3000}
                step={50}
                value={diffWindow}
                onChange={handleDiffWindowChange}
                style={{ width: 60, accentColor: '#f59e0b', cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ color: '#aaa', fontSize: 11 }}>Slice</span>
              <input
                type="range"
                aria-label={`Slice ${viewLabel}`}
                min={axisMin}
                max={axisMax}
                step={(axisRangeSpan / 200).toFixed(2)}
                value={slicePos}
                onChange={handleSliderChange}
                style={{ width: 90, accentColor: '#f59e0b', cursor: 'pointer' }}
              />
            </label>
          </>
        )}
      </div>

      <div style={{ flex: 1, position: 'relative', background: '#050505' }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: status === 'error' ? 'none' : 'block',
            imageRendering: 'pixelated',
          }}
        />
        {(status === 'idle' || status === 'error') && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: status === 'error' ? '#7a4a4a' : '#3a3a3a',
              fontSize: 12,
              padding: '0 24px',
              textAlign: 'center',
            }}
          >
            {status === 'error' ? errorMessage : 'Preparing difference view'}
          </div>
        )}
      </div>
    </div>
  );
}
