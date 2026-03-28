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

      // prev=dashed blue, center=solid green, next=dashed blue
      const slots = [
        { offset: -CROSS_SECTION_STEP, color: '#00aaff', dash: [6, 4] as number[], width: 1.5 },
        { offset: 0,                   color: '#00ff88', dash: [] as number[],      width: 2   },
        { offset:  CROSS_SECTION_STEP, color: '#00aaff', dash: [6, 4] as number[], width: 1.5 },
      ];

      for (const { offset, color, dash, width } of slots) {
        const idx = Math.max(0, Math.min(numSamples - 1, splineIndex + offset));
        const frame = frames[idx];
        if (!frame) continue;

        const { point, normal: N } = frame;
        // The cross-section plane intersects the axial slice as a line through
        // frame.point in the N (buccal-lingual) direction.
        const p1 = [point[0] + N[0] * FAR_MM, point[1] + N[1] * FAR_MM, point[2] + N[2] * FAR_MM];
        const p2 = [point[0] - N[0] * FAR_MM, point[1] - N[1] * FAR_MM, point[2] - N[2] * FAR_MM];

        const c1 = vp.worldToCanvas(p1 as any);
        const c2 = vp.worldToCanvas(p2 as any);

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = width;
        ctx.setLineDash(dash);
        ctx.moveTo(c1[0], c1[1]);
        ctx.lineTo(c2[0], c2[1]);
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
