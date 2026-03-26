import React, { useEffect } from 'react';
import DentalCPRViewport from './DentalCPRViewport';
import DentalCrossSectionViewport from './DentalCrossSectionViewport';

// Inject CSS to widen the dental container panel relative to the axial panel.
// OHIF's ViewportGrid uses absolute positioning with inline styles; !important
// overrides those inline values without touching OHIF's React state.
const DENTAL_GRID_STYLE_ID = 'dental-grid-col-override';

export default function DentalContainerViewport(props: any) {
  const { displaySets, servicesManager, extensionManager, commandsManager } = props;
  const sharedProps = { displaySets, servicesManager, extensionManager, commandsManager };

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
