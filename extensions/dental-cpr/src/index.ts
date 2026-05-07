import id from './id';
import DentalViewRouter from './viewports/DentalViewRouter';
import { cbctDentalHP } from './hanging-protocols/cbctDentalHP';
import DentalArchSplineTool from './tools/DentalArchSplineTool';
import React from 'react';
import ReactDOM from 'react-dom/client';
import DentalFileManager from './viewports/DentalFileManager';
import { getStudyViewerPath } from './utils/orthancClient';
import AiAssistPanel from './components/AiAssistPanel';

export { default as DentalArchSplineTool, ARCH_SPLINE_COMPLETED } from './tools/DentalArchSplineTool';
export { buildCenterline, buildCenterlinePoints } from './utils/buildCenterline';
export { ARCH_CROSS_SECTION_POSITION } from './viewports/DentalCrossSectionViewport';

// AI Assist — public API (research preview, not for diagnosis)
export * from './ai/types';
export { findingsStore } from './ai/findingsStore';
export { inferenceClient, InferenceClient } from './ai/inferenceClient';

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
    document.title = 'AmbientCT';
    console.log('[DentalCPR] Extension v0.1.0 registered — world\'s first open-source OHIF dental panoramic CPR');

    // ── Inject DentalFileManager as a fullscreen portal ────────────────────
    // OHIF viewport components only render when a study is loaded.
    // We inject the file manager at the DOM level so it shows before any study
    // is selected, independent of OHIF's study/display-set lifecycle.

    // Pre-dismiss the OHIF "investigational use only" disclaimer banner.
    // Key is sessionStorage so it resets on tab close (OHIF's own logic).
    sessionStorage.setItem('investigationalUseDialog', 'hidden');

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
            onOpen: (studyInstanceUID: string, study?: { studyInstanceUID: string; modality: string }) => {
              window.location.href = getStudyViewerPath(
                study ?? { studyInstanceUID, modality: 'CT' }
              );
            },
          })
        );
      }
    };

    render(!hasStudy);
    // Note: navigation uses window.location.href (full reload), not pushState.
    // popstate does not fire for hard navigations, so no listener needed.
    // "Schließen" → window.location.href='/' → full reload → preRegistration re-runs → portal shows.
    // "Öffnen →" → window.location.href='/dentalCPR?StudyInstanceUIDs=...' → OHIF route matched.
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
  /**
   * Registers the AI Assist panel.
   * Referenced as: @ambientwork/ohif-extension-dental-cpr.panelModule.aiAssist
   */
  getPanelModule({ servicesManager }: any) {
    return [
      {
        // `name` becomes data-cy="aiAssist-btn" on the tab button — the
        // most reliable selector for E2E tests (OHIF v3 renders tab labels
        // as icons only; iconLabel is NOT placed as visible text or aria-
        // label on the tab itself).
        name:           'aiAssist',
        // Pinned to a real OHIF icon to avoid "Missing icon" placeholder.
        // 'tab-segmentation' fits the AI-suggested-anatomy semantics.
        iconName:       'tab-segmentation',
        iconLabel:      'AI Assist',
        label:          'AI Assist',
        secondaryLabel: 'AI Assist',
        component:      (props: any) =>
          React.createElement(AiAssistPanel, { ...props, servicesManager }),
      },
    ];
  },

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
