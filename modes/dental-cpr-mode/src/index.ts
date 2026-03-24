import { addTool, MouseBindings } from '@cornerstonejs/tools';
import DentalArchSplineTool from '@ambientwork/ohif-extension-dental-cpr/src/tools/DentalArchSplineTool';

const extensionDependencies = {
  '@ohif/extension-default': '^3.9.0',
  '@ohif/extension-cornerstone': '^3.9.0',
  '@ambientwork/ohif-extension-dental-cpr': '^0.1.0',
};

function modeFactory() {
  return {
    id: '@ambientwork/ohif-mode-dental-cpr',
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
              // Top-left: Axial CBCT — draw the dental arch here
              {
                namespace:
                  '@ohif/extension-cornerstone.viewportModule.cornerstone',
                displaySetsToDisplay: [
                  '@ohif/extension-default.sopClassHandlerModule.stack',
                ],
              },
              // Top-right: Panoramic CPR — click to select cross-section position
              {
                namespace:
                  '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCPRViewport',
                displaySetsToDisplay: [
                  '@ohif/extension-default.sopClassHandlerModule.stack',
                ],
              },
              // Bottom: Perpendicular cross-section at clicked arch position
              {
                namespace:
                  '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCrossSectionViewport',
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

          // Create tool group for this mode
          const TOOL_GROUP_ID = 'dentalCPRToolGroup';
          let toolGroup = toolGroupService.getToolGroup(TOOL_GROUP_ID);
          if (!toolGroup) {
            toolGroup = toolGroupService.createToolGroup(TOOL_GROUP_ID);
          }

          toolGroup.addTool(DentalArchSplineTool.toolName);
          toolGroup.setToolActive(DentalArchSplineTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Primary }],
          });

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
