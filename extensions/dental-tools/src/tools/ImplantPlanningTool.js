import { EllipticalROITool } from '@cornerstonejs/tools';

/**
 * ImplantPlanningTool — Phase 5 Scaffold
 *
 * Extends EllipticalROITool to represent an implant cross-section.
 * v1: renders as a labeled circle with diameter/length annotation.
 *
 * Phase 5+ requires:
 *   - 3D cylinder via viewport.addActor(vtkCylinderSource)
 *   - Rotation handles in all three MPR planes
 *   - Diameter/length persistence via DICOM SR
 *
 * TODO Phase 5: see vtk.js vtkCylinderSource + Cornerstone3D viewport.addActor() API
 */
class ImplantPlanningTool extends EllipticalROITool {
  static toolName = 'ImplantPlanningTool';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super({
      ...toolProps,
      configuration: {
        implantDiameter: 3.5,
        implantLength: 10.0,
        ...toolProps.configuration,
      },
    }, defaultToolProps);
  }

  getTextLines(data, targetId) {
    const { implantDiameter, implantLength } = this.configuration;
    return [
      `Impl. \u00d8${implantDiameter}mm \u00d7 ${implantLength}mm`,
      '[Phase 5 \u2014 kein 3D-Zylinder]',
    ];
  }
}

export default ImplantPlanningTool;
