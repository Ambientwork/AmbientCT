import { SplineROITool, annotation } from '@cornerstonejs/tools';

// Safety margin thresholds (mm)
const MARGIN_GREEN  = 2.0;
const MARGIN_ORANGE = 1.0;

/**
 * NerveCanalTool
 *
 * Marks the Nervus alveolaris inferior on axial CBCT slices.
 * Extends SplineROITool (CatmullRom, open path — not PlanarFreehandROITool
 * which draws closed polygons and computes area, not length).
 *
 * Features:
 *   - Open spline path with total length label
 *   - Color-coded dashed line to nearest ImplantPlanningTool annotation:
 *       green >=2mm, orange 1-2mm, red <1mm
 *
 * Phase 5+: 3D canal tracing across axial slices, CPR rendering
 */
class NerveCanalTool extends SplineROITool {
  static toolName = 'NerveCanalTool';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(
      {
        ...toolProps,
        configuration: {
          splineType: 'CatmullRomSpline',
          closed: false,
          ...toolProps.configuration,
        },
      },
      defaultToolProps
    );
  }

  renderAnnotation(enabledElement, svgDrawingHelper) {
    super.renderAnnotation(enabledElement, svgDrawingHelper);

    const { element, viewport } = enabledElement;

    const canalAnnotations = annotation.state.getAnnotations(
      NerveCanalTool.toolName, element
    ) || [];
    const implantAnnotations = annotation.state.getAnnotations(
      'ImplantPlanningTool', element
    ) || [];

    if (implantAnnotations.length === 0) return;

    canalAnnotations.forEach(canalAnn => {
      const canalPoints = canalAnn.data?.contour?.polyline || [];
      if (!canalPoints.length) return;

      implantAnnotations.forEach(implantAnn => {
        const implantCenter = implantAnn.data?.handles?.points?.[0];
        if (!implantCenter) return;

        // Find nearest canal point
        let minDist = Infinity;
        let nearestPt = canalPoints[0];
        canalPoints.forEach(pt => {
          const dx = pt[0] - implantCenter[0];
          const dy = pt[1] - implantCenter[1];
          const dz = pt[2] - implantCenter[2];
          const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (d < minDist) { minDist = d; nearestPt = pt; }
        });

        const color = minDist >= MARGIN_GREEN  ? 'rgb(0,220,80)'
                    : minDist >= MARGIN_ORANGE ? 'rgb(255,165,0)'
                    : 'rgb(255,40,40)';

        const from = viewport.worldToCanvas(nearestPt);
        const to   = viewport.worldToCanvas(implantCenter);
        const uid  = `nc-${canalAnn.annotationUID}-${implantAnn.annotationUID}`;

        svgDrawingHelper.drawLine('NerveCanalTool', uid, from, to, {
          color, lineWidth: 1.5, lineDash: [4, 4],
        });

        svgDrawingHelper.drawTextBox(
          'NerveCanalTool', `${uid}-lbl`,
          [(from[0] + to[0]) / 2 + 4, (from[1] + to[1]) / 2],
          [`${minDist.toFixed(1)} mm`],
          { color, fontSize: 12 }
        );
      });
    });
  }
}

export default NerveCanalTool;
