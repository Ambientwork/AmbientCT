import NerveCanalTool from './tools/NerveCanalTool';
import ToothAnnotationTool from './tools/ToothAnnotationTool';
import BoneThicknessTool from './tools/BoneThicknessTool';
import ImplantPlanningTool from './tools/ImplantPlanningTool';
import DentalToolsPanel from './panels/DentalToolsPanel';

/**
 * AmbientCT Dental Tools Extension for OHIF v3
 *
 * Working tools:
 *   NerveCanalTool     — SplineROI-based nerve canal marking with safety margin
 *   ToothAnnotationTool — FDI 11-48 tooth annotations with finding codes
 *   BoneThicknessTool  — LengthTool + HU sampling for bone thickness estimate
 *
 * Phase 5 scaffolds:
 *   ImplantPlanningTool — EllipticalROI placeholder, 3D cylinder coming in Phase 5
 */
const DentalToolsExtension = {
  id: '@ambientwork/ohif-extension-dental-tools',
  version: '1.0.0',

  getToolsModule: () => ({
    tools: [
      { name: 'NerveCanalTool',      toolClass: NerveCanalTool },
      { name: 'ToothAnnotationTool', toolClass: ToothAnnotationTool },
      { name: 'BoneThicknessTool',   toolClass: BoneThicknessTool },
      { name: 'ImplantPlanningTool', toolClass: ImplantPlanningTool },
    ],
    toolGroups: [
      {
        id: 'default',
        tools: [
          { toolName: 'NerveCanalTool',      bindings: [{ mouseButton: 1 }] },
          { toolName: 'ToothAnnotationTool', bindings: [{ mouseButton: 1 }] },
          { toolName: 'BoneThicknessTool',   bindings: [{ mouseButton: 1 }] },
          { toolName: 'ImplantPlanningTool', bindings: [{ mouseButton: 1 }] },
        ],
      },
    ],
  }),

  getPanelModule: ({ servicesManager }) => [
    {
      name: 'dentalTools',
      iconName: 'tab-patient-info',
      iconLabel: 'Dental',
      label: 'Dental Tools',
      secondaryLabel: 'Dental Tools',
      component: (props) => <DentalToolsPanel {...props} servicesManager={servicesManager} />,
    },
  ],

  getToolbarModule: () => [
    {
      name: 'primary',
      defaultContext: 'CORNERSTONE',
      generator: {
        hasFallback: true,
        generate: () => [
          {
            id: 'NerveCanalTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Nervkanal',
              icon: 'tool-length',
              tooltip: 'Nervkanal markieren — N. alv. inf. mit Sicherheitsabstand',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'NerveCanalTool' } }],
            },
          },
          {
            id: 'ToothAnnotationTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Zahn FDI',
              icon: 'tool-annotate',
              tooltip: 'FDI-Zahn markieren (11–48) mit Befund',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'ToothAnnotationTool' } }],
            },
          },
          {
            id: 'BoneThicknessTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Knochen',
              icon: 'tool-bidirectional',
              tooltip: 'Knochendicke messen — Linie setzen, HU-Sampling',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'BoneThicknessTool' } }],
            },
          },
          {
            id: 'ImplantPlanningTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Implantat',
              icon: 'tool-ellipse',
              tooltip: 'Implantat planen [Phase 5 — noch kein 3D-Zylinder]',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'ImplantPlanningTool' } }],
            },
          },
        ],
      },
    },
  ],
};

export default DentalToolsExtension;
