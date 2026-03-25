import {
  AnnotationTool,
  annotation,
  drawing,
  Enums as csToolsEnums,
} from '@cornerstonejs/tools';
import { getEnabledElement, utilities as csUtils } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import type { EventTypes, SVGDrawingHelper } from '@cornerstonejs/tools/src/types';

const { addAnnotation, getAnnotations } = annotation.state;
const { drawHandles, drawPolyline } = drawing;

/**
 * Custom event fired when the user finalises the dental arch spline.
 * Listeners (e.g. DentalCPRViewport) use this to trigger CPR reconstruction.
 */
export const ARCH_SPLINE_COMPLETED = 'DENTAL_ARCH_SPLINE_COMPLETED';

export interface DentalArchAnnotation {
  annotationUID: string;
  metadata: {
    toolName: string;
    viewPlaneNormal: Types.Point3;
    viewUp: Types.Point3;
    referencedImageId?: string;
    FrameOfReferenceUID?: string;
  };
  data: {
    controlPoints: Types.Point3[];
    /** Standard Cornerstone handles format — keeps filterAnnotationsWithinSlice happy */
    handles: { points: Types.Point3[] };
    isComplete: boolean;
  };
  highlighted: boolean;
  invalidated: boolean;
  isLocked: boolean;
  isVisible: boolean;
}

/**
 * DentalArchSplineTool
 *
 * Click to place control points along the dental arch on an axial CBCT slice.
 * Double-click (or press Enter) to finalise — fires ARCH_SPLINE_COMPLETED.
 *
 * Extends Cornerstone3D AnnotationTool so it integrates naturally with
 * OHIF tool groups, history, and viewport rendering.
 */
export default class DentalArchSplineTool extends AnnotationTool {
  static toolName = 'DentalArchSpline';

  private isDrawing = false;
  private currentAnnotationUID: string | null = null;

  // Stored so we can remove on deactivation
  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _lastElement: HTMLElement | null = null;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        preventHandleOutsideImage: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);

    // CRITICAL: BaseTool sets `this.doubleClickCallback` as an instance property
    // (arrow function) in its constructor, which shadows our prototype method.
    // We must re-assign it HERE (after super()) to override the base implementation.
    this.doubleClickCallback = (evt: EventTypes.InteractionEventType) => {
      console.log('[DentalArchSpline] doubleClickCallback fired');
      this._completeArch(evt.detail.element);
    };

    // Attach Enter key in constructor — reliable regardless of onSetToolActive lifecycle.
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      console.log(`[DentalArchSpline] keydown: key=${e.key} isDrawing=${this.isDrawing} uid=${this.currentAnnotationUID}`);
      if (e.key === 'Enter' && this.isDrawing) {
        this._completeArch(this._lastElement ?? undefined);
      }
    });
  }

  /** Reset state when tool is deactivated. */
  onSetToolPassive() {
    this.isDrawing = false;
    this.currentAnnotationUID = null;
    this._lastElement = null;
  }

  /** Shared completion logic — called by double-click or Enter key. */
  private _completeArch(element?: HTMLElement | null) {
    console.log(`[DentalArchSpline] _completeArch called: isDrawing=${this.isDrawing} uid=${this.currentAnnotationUID} element=${!!element}`);
    if (!this.isDrawing || !this.currentAnnotationUID || !element) {
      console.warn(`[DentalArchSpline] _completeArch guard failed: isDrawing=${this.isDrawing} uid=${this.currentAnnotationUID} element=${!!element}`);
      return;
    }

    const annotations = getAnnotations(DentalArchSplineTool.toolName, element as HTMLDivElement);
    const current = annotations.find(
      a => a.annotationUID === this.currentAnnotationUID
    ) as unknown as DentalArchAnnotation | undefined;

    console.log(`[DentalArchSpline] found annotation=${!!current} points=${current?.data.controlPoints.length ?? 0}`);
    if (!current) return;
    if (current.data.controlPoints.length < 3) {
      const msg = `[DentalArchSpline] Need at least 3 control points (have ${current.data.controlPoints.length}). Keep clicking to add more, then press Enter.`;
      console.warn(msg);
      // Show visible browser alert so the user knows what's happening
      window.alert(msg);
      return;
    }

    current.data.isComplete = true;
    current.invalidated = true;
    this.isDrawing = false;
    this.currentAnnotationUID = null;

    window.dispatchEvent(new CustomEvent(ARCH_SPLINE_COMPLETED, {
      detail: { controlPoints: current.data.controlPoints },
    }));

    if (typeof annotation.state.triggerAnnotationCompleted === 'function') {
      annotation.state.triggerAnnotationCompleted(current as any);
    }
  }

  /** Stub: prevents Cornerstone3D crash when user clicks an existing annotation handle. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handleSelectedCallback() {}

  /** Called on primary click when no existing annotation is hit. */
  addNewAnnotation(evt: EventTypes.InteractionEventType) {
    console.log(`[DentalArchSpline] addNewAnnotation called: isDrawing=${this.isDrawing} uid=${this.currentAnnotationUID}`);
    const { currentPoints, element } = evt.detail;
    const worldPos = currentPoints.world as Types.Point3;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement?.viewport) return;

    const { viewport } = enabledElement;
    const camera = viewport.getCamera();

    if (this.isDrawing && this.currentAnnotationUID) {
      // Append point to the in-progress annotation
      const annotations = getAnnotations(DentalArchSplineTool.toolName, element);
      const current = annotations.find(
        a => a.annotationUID === this.currentAnnotationUID
      ) as unknown as DentalArchAnnotation | undefined;
      if (current) {
        current.data.controlPoints.push([...worldPos] as Types.Point3);
        current.data.handles.points.push([...worldPos] as Types.Point3);
        current.invalidated = true;
        if (typeof annotation.state.triggerAnnotationModified === 'function') {
          annotation.state.triggerAnnotationModified(current as any, element);
        }
      }
      return current as any;
    }

    // Start a new annotation
    const newAnnotation: DentalArchAnnotation = {
      annotationUID: csUtils.uuidv4(),
      metadata: {
        toolName: DentalArchSplineTool.toolName,
        viewPlaneNormal: [...camera.viewPlaneNormal] as Types.Point3,
        viewUp: [...camera.viewUp] as Types.Point3,
        // Required by filterAnnotationsWithinSlice — prevents crash on annotation render
        FrameOfReferenceUID: (viewport as any).getFrameOfReferenceUID?.() ?? '',
        referencedImageId: (viewport as any).getCurrentImageId?.() ?? '',
      },
      data: {
        controlPoints: [[...worldPos] as Types.Point3],
        // Standard Cornerstone handles — required by filterAnnotationsWithinSlice
        handles: { points: [[...worldPos] as Types.Point3] },
        isComplete: false,
      },
      highlighted: true,
      invalidated: true,
      isLocked: false,
      isVisible: true,
    };

    addAnnotation(newAnnotation as any, element);
    this.isDrawing = true;
    this.currentAnnotationUID = newAnnotation.annotationUID;
    this._lastElement = element as HTMLElement;
    return newAnnotation as any;
  }

  isPointNearTool(
    element: HTMLDivElement,
    ann: any,
    canvasCoords: Types.Point2,
    proximity: number
  ): boolean {
    const { data } = ann as DentalArchAnnotation;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement?.viewport) return false;

    const { viewport } = enabledElement;
    for (const worldPt of data.controlPoints) {
      const canvasPt = viewport.worldToCanvas(worldPt);
      const dist = Math.hypot(canvasPt[0] - canvasCoords[0], canvasPt[1] - canvasCoords[1]);
      if (dist < proximity) return true;
    }
    return false;
  }

  renderAnnotation(
    enabledElement: Types.IEnabledElement,
    svgDrawingHelper: SVGDrawingHelper
  ): boolean {
    const { viewport } = enabledElement;
    const annotations = getAnnotations(
      DentalArchSplineTool.toolName,
      viewport.element
    ) as unknown as DentalArchAnnotation[];

    if (!annotations?.length) return false;

    for (const ann of annotations) {
      if (!ann.isVisible) continue;

      const canvasPoints = ann.data.controlPoints.map(p => viewport.worldToCanvas(p));
      if (canvasPoints.length < 1) continue;

      // Polyline connecting control points
      if (canvasPoints.length > 1) {
        drawPolyline(
          svgDrawingHelper,
          ann.annotationUID,
          'archPolyline',
          canvasPoints,
          {
            color: ann.data.isComplete ? '#00ff88' : '#ffcc00',
            lineWidth: 2,
            lineDash: ann.data.isComplete ? '' : '6,4',
          }
        );
      }

      // Control point handles
      drawHandles(
        svgDrawingHelper,
        ann.annotationUID,
        'archHandles',
        canvasPoints,
        { color: '#00aaff', handleRadius: 4, lineWidth: 2 }
      );
    }

    return true;
  }
}
