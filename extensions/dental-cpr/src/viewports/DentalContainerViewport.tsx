import React, { useEffect } from 'react';
import { getRenderingEngines } from '@cornerstonejs/core';
import DentalCPRViewport from './DentalCPRViewport';
import DentalCrossSectionViewport, {
  ARCH_CROSS_SECTION_POSITION,
  CROSS_SECTION_STEP,
} from './DentalCrossSectionViewport';
import type { CrossSectionEventDetail } from './DentalCrossSectionViewport';
import { getSharedFrames } from '../utils/dentalState';

const AXIAL_OVERLAY_ID = 'dental-axial-xsect-overlay';
// Half-width of the cross-section field (SLICE_SIZE_MM / 2 = 80 / 2)
const FAR_MM = 40;

function findAxialViewport() {
  for (const engine of getRenderingEngines()) {
    const vp = (engine as any).getViewport?.('cbctAxial');
    if (vp) return vp;
  }
  return null;
}

// Inject CSS to widen the dental container panel relative to the axial panel.
// OHIF's ViewportGrid uses absolute positioning with inline styles; !important
// overrides those inline values without touching OHIF's React state.
const DENTAL_GRID_STYLE_ID = 'dental-grid-col-override';

export default function DentalContainerViewport(props: any) {
  const { displaySets, servicesManager, extensionManager, commandsManager } = props;
  const sharedProps = { displaySets, servicesManager, extensionManager, commandsManager };

  // ── Axial cross-section overlay ─────────────────────────────────────────────
  useEffect(() => {
    const drawOverlay = (evt: Event) => {
      const { splineIndex, numSamples } = (evt as CustomEvent<CrossSectionEventDetail>).detail;
      const vp = findAxialViewport();
      if (!vp) return;

      const el = vp.element as HTMLElement;

      // Create overlay canvas once, re-use on subsequent events
      let canvas = el.querySelector<HTMLCanvasElement>(`#${AXIAL_OVERLAY_ID}`);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = AXIAL_OVERLAY_ID;
        canvas.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10';
        if (getComputedStyle(el).position === 'static') {
          el.style.position = 'relative';
        }
        el.appendChild(canvas);
      }

      const rect = el.getBoundingClientRect();
      canvas.width  = rect.width;
      canvas.height = rect.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const frames = getSharedFrames();
      if (!frames.length) return;

      // ── Shared orientation from CENTER frame so all 3 rectangles are parallel ──
      const centerIdx = Math.max(0, Math.min(numSamples - 1, splineIndex));
      const cf = frames[centerIdx];
      if (!cf) return;

      const [Nx, Ny, Nz] = cf.normal;   // buccal-lingual (cross-section width axis)
      const [Bx, By, Bz] = cf.binormal; // inferior direction (≈ world -Z)
      // Arch tangent T = N × B (gives the along-arch direction in the axial plane)
      const Tx_raw = Ny * Bz - Nz * By;
      const Ty_raw = Nz * Bx - Nx * Bz;
      const Tz_raw = Nx * By - Ny * Bx;
      const Tlen = Math.sqrt(Tx_raw ** 2 + Ty_raw ** 2 + Tz_raw ** 2) || 1;
      const [Tx, Ty, Tz] = [Tx_raw / Tlen, Ty_raw / Tlen, Tz_raw / Tlen];

      // Rectangle geometry:
      //   ±FAR_MM   along N = buccal-lingual width (= cross-section field width)
      //   ±HALF_D   along T = arch-tangent depth  (= half the 3-D distance between Prev and Next frames)
      const prevFrame = frames[Math.max(0, centerIdx - CROSS_SECTION_STEP)];
      const nextFrame = frames[Math.min(numSamples - 1, centerIdx + CROSS_SECTION_STEP)];
      const [ppx, ppy, ppz] = prevFrame?.point ?? cf.point;
      const [npx, npy, npz] = nextFrame?.point ?? cf.point;
      const stepDist = Math.sqrt((npx-ppx)**2 + (npy-ppy)**2 + (npz-ppz)**2);
      const HALF_D = stepDist / 2; // half the Prev→Next distance

      // prev=dashed blue, center=solid green, next=dashed blue
      const slots = [
        { offset: -CROSS_SECTION_STEP, color: '#00aaff', dash: [5, 4] as number[], lw: 1.5 },
        { offset: 0,                   color: '#00ff88', dash: [] as number[],      lw: 2   },
        { offset:  CROSS_SECTION_STEP, color: '#00aaff', dash: [5, 4] as number[], lw: 1.5 },
      ];

      for (const { offset, color, dash, lw } of slots) {
        const idx = Math.max(0, Math.min(numSamples - 1, splineIndex + offset));
        const frame = frames[idx];
        if (!frame) continue;

        const [px, py, pz] = frame.point;

        // Four corners of the cross-section rectangle projected onto the axial plane:
        //   width  = 80 mm along N (center frame's buccal-lingual axis)
        //   height = 4 mm along T (arch-tangent, shows slice position/thickness)
        const corners = [
          [px + Nx * FAR_MM + Tx * HALF_D, py + Ny * FAR_MM + Ty * HALF_D, pz + Nz * FAR_MM + Tz * HALF_D],
          [px - Nx * FAR_MM + Tx * HALF_D, py - Ny * FAR_MM + Ty * HALF_D, pz - Nz * FAR_MM + Tz * HALF_D],
          [px - Nx * FAR_MM - Tx * HALF_D, py - Ny * FAR_MM - Ty * HALF_D, pz - Nz * FAR_MM - Tz * HALF_D],
          [px + Nx * FAR_MM - Tx * HALF_D, py + Ny * FAR_MM - Ty * HALF_D, pz + Nz * FAR_MM - Tz * HALF_D],
        ].map(p => vp.worldToCanvas(p as any));

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = lw;
        ctx.setLineDash(dash);
        ctx.moveTo(corners[0][0], corners[0][1]);
        ctx.lineTo(corners[1][0], corners[1][1]);
        ctx.lineTo(corners[2][0], corners[2][1]);
        ctx.lineTo(corners[3][0], corners[3][1]);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    };

    window.addEventListener(ARCH_CROSS_SECTION_POSITION, drawOverlay);
    return () => {
      window.removeEventListener(ARCH_CROSS_SECTION_POSITION, drawOverlay);
      // Remove overlay canvas on unmount
      const vp = findAxialViewport();
      vp?.element?.querySelector?.(`#${AXIAL_OVERLAY_ID}`)?.remove();
    };
  }, []);

  // ── OHIF grid CSS ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById(DENTAL_GRID_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = DENTAL_GRID_STYLE_ID;
    // Target OHIF pane children: first pane = axial (33%), second = dental container (67%)
    style.textContent = `
      .group\\/pane:nth-child(1) { width: 33% !important; }
      .group\\/pane:nth-child(2) { left: calc(33% + 4px) !important; width: calc(67% - 6px) !important; }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById(DENTAL_GRID_STYLE_ID)?.remove();
    };
  }, []);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#111',
      overflow: 'hidden',
      gap: 2,
    }}>
      <div style={{ flex: '6', minHeight: 0, overflow: 'hidden' }}>
        <DentalCPRViewport viewportId="dentalCPR" {...sharedProps} />
      </div>
      <div style={{ flex: '4', minHeight: 0, display: 'flex', gap: 2, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <DentalCrossSectionViewport viewportId="xsect-L" position={-1} {...sharedProps} />
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <DentalCrossSectionViewport viewportId="xsect-C" position={0} {...sharedProps} />
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <DentalCrossSectionViewport viewportId="xsect-R" position={1} {...sharedProps} />
        </div>
      </div>
    </div>
  );
}
