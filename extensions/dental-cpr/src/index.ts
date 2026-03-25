import id from './id';
import DentalViewRouter from './viewports/DentalViewRouter';
import { cbctDentalHP } from './hanging-protocols/cbctDentalHP';
import DentalArchSplineTool from './tools/DentalArchSplineTool';

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
