import React from 'react';
import DentalCPRViewport from './DentalCPRViewport';
import DentalContainerViewport from './DentalContainerViewport';

/**
 * DentalViewRouter — the single viewport component for all panes.
 *
 * Why a single router?
 * OHIF's _getViewportComponent iterates the layout template's viewports array
 * and returns the FIRST component whose displaySetsToDisplay matches the
 * display set's SOPClassHandlerId.  Because all panes receive the same
 * CBCT stack display set (SOPClassHandlerId = 'stack'), we can only reliably
 * select ONE viewport component for all of them.
 *
 * We register DentalViewRouter as the sole entry with
 * displaySetsToDisplay: ['stack'].  OHIF always routes here, and we dispatch
 * to the correct component using viewportId (always provided by OHIF as a
 * direct prop).
 *
 * Dispatch table:
 *   'cbctAxial'       → standard Cornerstone3D viewport (from extensionManager)
 *   'dentalContainer' → DentalContainerViewport (panoramic top 60% + 3 cross-sections bottom 40%)
 *   'dentalEmpty'     → empty dark placeholder
 */
export default function DentalViewRouter(props: any) {
  const { viewportId } = props;

  // Axial CBCT pane — delegate to the standard Cornerstone viewport component.
  // OHIF does not pass extensionManager as a prop to viewport components;
  // instead it is available as window.extensionManager (set by OHIF's app bootstrap).
  if (viewportId === 'cbctAxial') {
    const em = (window as any).extensionManager;
    const entry = em?.getModuleEntry?.(
      '@ohif/extension-cornerstone.viewportModule.cornerstone'
    );
    const CornerstoneViewport = entry?.component;
    if (CornerstoneViewport) {
      return <CornerstoneViewport {...props} />;
    }
    console.warn('[DentalViewRouter] CornerstoneViewport not found on window.extensionManager');
    return <div style={{ width: '100%', height: '100%', background: '#050505' }} />;
  }

  if (viewportId === 'dentalContainer') {
    return <DentalContainerViewport {...props} />;
  }

  if (viewportId === 'dentalEmpty' || !viewportId) {
    return <div style={{ width: '100%', height: '100%', background: '#050505' }} />;
  }

  // Default: panoramic CPR pane (dentalCPR)
  return <DentalCPRViewport {...props} />;
}
