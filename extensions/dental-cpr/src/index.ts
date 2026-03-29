import id from './id';
import DentalViewRouter from './viewports/DentalViewRouter';
import { cbctDentalHP } from './hanging-protocols/cbctDentalHP';
import DentalArchSplineTool from './tools/DentalArchSplineTool';
import React from 'react';
import ReactDOM from 'react-dom/client';
import DentalFileManager from './viewports/DentalFileManager';

export { DentalArchSplineTool, ARCH_SPLINE_COMPLETED } from './tools/DentalArchSplineTool';
export { buildCenterline, buildCenterlinePoints } from './utils/buildCenterline';
export { ARCH_CROSS_SECTION_POSITION } from './viewports/DentalCrossSectionViewport';

/**
 * @ambientwork/ohif-extension-dental-cpr
 *
 * OHIF v3 extension providing:
 *  - DentalArchSplineTool  — AnnotationTool to draw the dental arch curve
 *  - DentalCPRViewport     — Custom viewport using vtkImageCPRMapper
 *  - cbctDentalHP          — Hanging protocol: CBCT → 2-panel dental layout
 */
const extension = {
  id,
  version: '0.1.0',

  preRegistration({ servicesManager, extensionManager, configuration = {} }: any) {
    console.log('[DentalCPR] Extension v0.1.0 registered — world\'s first open-source OHIF dental panoramic CPR');

    // ── Inject DentalFileManager as a fullscreen portal ────────────────────
    // OHIF viewport components only render when a study is loaded.
    // We inject the file manager at the DOM level so it shows before any study
    // is selected, independent of OHIF's study/display-set lifecycle.

    const studyUIDs = new URLSearchParams(window.location.search).getAll('StudyInstanceUIDs');
    const hasStudy = studyUIDs.length > 0;

    // CSS animation for spinner components
    if (!document.getElementById('dental-animations')) {
      const s = document.createElement('style');
      s.id = 'dental-animations';
      s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(s);
    }

    const portalRoot = document.createElement('div');
    portalRoot.id = 'dental-file-manager-portal';
    portalRoot.style.cssText = `position:fixed;inset:0;z-index:9999;display:${hasStudy ? 'none' : 'block'}`;
    document.body.appendChild(portalRoot);

    const reactRoot = ReactDOM.createRoot(portalRoot);
    const render = (visible: boolean) => {
      portalRoot.style.display = visible ? 'block' : 'none';
      if (visible) {
        reactRoot.render(
          React.createElement(DentalFileManager, {
            onOpen: (studyInstanceUID: string) => {
              portalRoot.style.display = 'none';
              // Navigate to OHIF viewer with the study UID
              window.location.href = `/?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUID)}`;
            },
          })
        );
      }
    };

    render(!hasStudy);
    // Note: navigation uses window.location.href (full reload), not pushState.
    // popstate does not fire for hard navigations, so no listener needed.
    // "Schließen" → window.location.href='/' → full reload → preRegistration re-runs → file manager shown.
  },

  /**
   * Returns the dental view router component.
   * A single router handles both the panoramic CPR slot and the
   * cross-section slot — it dispatches by viewportId at render time.
   * Referenced as: @ambientwork/ohif-extension-dental-cpr.viewportModule.dentalViewRouter
   */
  getViewportModule({ servicesManager, extensionManager }: any) {
    return [
      {
        name: 'dentalViewRouter',
        component: DentalViewRouter,
      },
    ];
  },

  /**
   * Returns the CBCT dental hanging protocol.
   * Referenced as: cbctDentalCPR
   */
  getHangingProtocolModule() {
    return [
      {
        name: cbctDentalHP.id,
        protocol: cbctDentalHP,
      },
    ];
  },

  /**
   * Registers the DentalArchSplineTool with Cornerstone3D.
   * OHIF's cornerstone extension calls getCommandsModule and getToolbarModule
   * from here; we use preRegistration to call addTool() globally.
   */
  getCommandsModule({ servicesManager, commandsManager }: any) {
    return {
      name: 'dentalCPRCommands',
      context: 'VIEWER',
      definitions: {
        setDentalArchSplineToolActive: {
          commandFn: () => {
            const { toolGroupService } = servicesManager.services;
            const toolGroup = toolGroupService.getToolGroup('dentalCPRToolGroup');
            if (toolGroup) {
              toolGroup.setToolActive(DentalArchSplineTool.toolName, {
                bindings: [{ mouseButton: 1 }],
              });
            }
          },
          storeContexts: [],
          options: {},
        },
      },
    };
  },
};

export default extension;
