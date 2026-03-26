import React from 'react';
import DentalCPRViewport from './DentalCPRViewport';
import DentalCrossSectionViewport from './DentalCrossSectionViewport';

export default function DentalContainerViewport(props: any) {
  const { displaySets, servicesManager, extensionManager, commandsManager } = props;
  const sharedProps = { displaySets, servicesManager, extensionManager, commandsManager };

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
