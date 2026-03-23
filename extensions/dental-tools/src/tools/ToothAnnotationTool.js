import { ArrowAnnotateTool, annotation, triggerAnnotationModified, eventTarget } from '@cornerstonejs/tools';

// IMPORTANT: The correct class name is ArrowAnnotateTool (no "ion").
// ArrowAnnotationTool does NOT exist in Cornerstone3D — using it would fail silently.

export const DENTAL_TOOTH_PICK_EVENT = 'DENTAL_TOOTH_PICK';

const FINDING_COLORS = {
  none:      'rgb(255,255,255)',
  caries:    'rgb(255,220,0)',
  crown:     'rgb(180,100,255)',
  implant:   'rgb(60,160,255)',
  missing:   'rgb(150,150,150)',
  rootCanal: 'rgb(255,80,80)',
};

class ToothAnnotationTool extends ArrowAnnotateTool {
  static toolName = 'ToothAnnotationTool';

  mouseUpCallback(evt) {
    super.mouseUpCallback(evt);

    const { element } = evt.detail;
    const annotations = annotation.state.getAnnotations(
      ToothAnnotationTool.toolName, element
    ) || [];
    if (!annotations.length) return;

    const latest = annotations[annotations.length - 1];

    // Dispatch event — DentalToolsPanel listens and shows the FDI picker
    eventTarget.dispatchEvent(
      new CustomEvent(DENTAL_TOOTH_PICK_EVENT, {
        bubbles: true,
        detail: {
          annotationUID: latest.annotationUID,
          canvasPos: evt.detail.currentPoints?.canvas || [0, 0],
          element,
        },
      })
    );
  }

  getLinkedTextBoxStyle(settings, ann) {
    const finding = ann.data?.finding || 'none';
    const color = FINDING_COLORS[finding] ?? FINDING_COLORS.none;
    return { ...super.getLinkedTextBoxStyle(settings, ann), color };
  }
}

export default ToothAnnotationTool;
