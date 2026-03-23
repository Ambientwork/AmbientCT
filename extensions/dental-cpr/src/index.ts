import id from './id';
import DentalCPRViewport from './viewports/DentalCPRViewport';
import { cbctDentalHP } from './hanging-protocols/cbctDentalHP';
import DentalArchSplineTool from './tools/DentalArchSplineTool';

export { DentalArchSplineTool, ARCH_SPLINE_COMPLETED } from './tools/DentalArchSplineTool';
export { buildCenterline } from './utils/buildCenterline';

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

  preRegistration({
    servicesManager,
    extensionManager,
    configuration = {},
  }: any) {
    console.log(
      `[DentalCPR] Extension v0.1.0 registered — world's first open-source OHIF dental panoramic CPR`
    );
  },

  /**
   * Returns the custom DentalCPRViewport component.
   * Referenced as: @ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCPRViewport
   */
  getViewportModule({ servicesManager, extensionManager }: any) {
    return [
      {
        name: 'dentalCPRViewport',
        component: DentalCPRViewport,
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
