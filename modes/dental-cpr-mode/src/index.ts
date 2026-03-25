import { addTool, Enums as ToolEnums } from '@cornerstonejs/tools';
import DentalArchSplineTool from '@ambientwork/ohif-extension-dental-cpr/src/tools/DentalArchSplineTool';

const extensionDependencies = {
  '@ohif/extension-default': '^3.9.0',
  '@ohif/extension-cornerstone': '^3.9.0',
  '@ambientwork/ohif-extension-dental-cpr': '^0.1.0',
};

function modeFactory() {
  return {
    id: '@ambientwork/ohif-mode-dental-cpr',
    routeName: 'dentalCPR',
    version: '0.1.0',
    displayName: 'Dental CPR',
    description:
      'Draw a dental arch curve on axial CBCT → automatic panoramic reconstruction (Curved Planar Reformation)',

    extensions: extensionDependencies,

    sopClassHandlers: [
      '@ohif/extension-default.sopClassHandlerModule.stack',
      '@ohif/extension-cornerstone.sopClassHandlerModule.3DSopClassHandler',
    ],

    routes: [
      {
        path: 'dentalCPR',

        layoutTemplate: ({ location, servicesManager }: any) => ({
          id: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
          props: {
            leftPanels: ['@ohif/extension-default.panelModule.seriesList'],
            rightPanels: [
              '@ambientwork/ohif-extension-dental-tools.panelModule.dentalTools',
            ],
            viewports: [
              // Single entry — DentalViewRouter handles all three panes.
              // OHIF's _getViewportComponent finds this entry first (it matches
              // 'stack' display sets) and routes all panes here.
              // DentalViewRouter then dispatches by viewportId:
              //   'cbctAxial'          → Cornerstone3D volume viewport
              //   'dentalCPR'          → DentalCPRViewport (vtk.js panoramic)
              //   'dentalCrossSection' → DentalCrossSectionViewport (vtk.js)
              {
                namespace:
                  '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalViewRouter',
                displaySetsToDisplay: [
                  '@ohif/extension-default.sopClassHandlerModule.stack',
                ],
              },
            ],
          },
        }),

        init: async ({ servicesManager, extensionManager }: any) => {
          const { toolGroupService } = servicesManager.services;

          // Register DentalArchSplineTool with Cornerstone3D (idempotent)
          try {
            addTool(DentalArchSplineTool);
          } catch {
            // Tool already registered — no-op
          }

          // Create tool group for axial viewport (DentalArchSplineTool active here)
          const TOOL_GROUP_ID = 'dentalCPRToolGroup';
          let toolGroup = toolGroupService.getToolGroup(TOOL_GROUP_ID);
          if (!toolGroup) {
            toolGroup = toolGroupService.createToolGroup(TOOL_GROUP_ID);
          }

          toolGroup.addTool(DentalArchSplineTool.toolName);
          toolGroup.setToolActive(DentalArchSplineTool.toolName, {
            bindings: [{ mouseButton: ToolEnums?.MouseBindings?.Primary ?? 1 }],
          });

          // Create empty tool group for CPR/cross-section viewports.
          // These render via vtk.js and have no imageData, so Cornerstone's
          // annotation filtering (filterAnnotationsWithinSlice) would crash
          // if a real tool group with tools was attached.
          const VIEWS_GROUP_ID = 'dentalViewsGroup';
          if (!toolGroupService.getToolGroup(VIEWS_GROUP_ID)) {
            toolGroupService.createToolGroup(VIEWS_GROUP_ID);
          }

          console.log('[DentalCPR] Mode init — DentalArchSplineTool active on left click');
        },
      },
    ],

    hangingProtocol: ['cbctDentalCPR'],

    hotkeys: [],

    isValidMode: ({ modalities }: { modalities: string }) => ({
      valid:
        modalities?.split('\\').some((m: string) => m === 'CT') ?? false,
      verificationMessage:
        'Dental CPR mode requires CT/CBCT data (modality = CT)',
    }),

    onModeEnter() {
      console.log(
        '[DentalCPR] Mode entered.\n' +
        '  1. Open a CBCT study → axial + CPR panels appear\n' +
        '  2. Click axial panel to place arch control points\n' +
        '  3. Double-click to complete → panoramic reconstruction generates'
      );
    },

    onModeExit() {
      console.log('[DentalCPR] Mode exited');
    },
  };
}

export default {
  id: '@ambientwork/ohif-mode-dental-cpr',
  modeFactory,
  extensionDependencies,
};
