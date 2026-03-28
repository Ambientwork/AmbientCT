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
 * Catmull-Rom spline sampler.
 * Returns `numPerSegment` interpolated 3-D points per segment between consecutive
 * control points, plus the final endpoint.  Boundary points are duplicated so
 * the curve passes exactly through the first and last control points.
 */
function sampleCatmullRom(pts: Types.Point3[], numPerSegment: number): Types.Point3[] {
  if (pts.length < 2) return [...pts];

  // Duplicate boundary points so the curve reaches the endpoints
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  const out: Types.Point3[] = [];

  for (let seg = 0; seg < pts.length - 1; seg++) {
    const [p0, p1, p2, p3] = [p[seg], p[seg + 1], p[seg + 2], p[seg + 3]];
    for (let k = 0; k < numPerSegment; k++) {
      const t  = k / numPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
        0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
        0.5 * (2*p1[2] + (-p0[2]+p2[2])*t + (2*p0[2]-5*p1[2]+4*p2[2]-p3[2])*t2 + (-p0[2]+3*p1[2]-3*p2[2]+p3[2])*t3),
      ] as Types.Point3);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
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

    // Attach Enter key in CAPTURING phase (3rd arg = true) so OHIF/Cornerstone
    // stopPropagation() calls in viewport divs cannot swallow the event before
    // we see it. Capturing fires top-down (window → target), bubbling fires
    // bottom-up (target → window), so capturing always wins.
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      console.log(`[DentalArchSpline] keydown(capture): key=${e.key} isDrawing=${this.isDrawing} uid=${this.currentAnnotationUID}`);
      if (e.key === 'Enter' && this.isDrawing) {
        e.stopPropagation(); // prevent OHIF from also handling Enter
        this._completeArch(this._lastElement ?? undefined);
      }
    }, true /* capture */);
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

      const pts = ann.data.controlPoints;
      if (pts.length < 1) continue;

      // Control point handles (always drawn on the original control points)
      const handlePoints = pts.map(p => viewport.worldToCanvas(p));
      drawHandles(
        svgDrawingHelper,
        ann.annotationUID,
        'archHandles',
        handlePoints,
        { color: '#00aaff', handleRadius: 4, lineWidth: 2 }
      );

      if (pts.length < 2) continue;

      // Smooth Catmull-Rom curve through control points (10 samples per segment).
      // Boundary points are duplicated so the curve passes through the first and last points.
      const smoothWorld = sampleCatmullRom(pts, 10);
      const smoothCanvas = smoothWorld.map(p => viewport.worldToCanvas(p));

      drawPolyline(
        svgDrawingHelper,
        ann.annotationUID,
        'archPolyline',
        smoothCanvas,
        {
          color: ann.data.isComplete ? '#00ff88' : '#ffcc00',
          lineWidth: 2,
          lineDash: ann.data.isComplete ? '' : '6,4',
        }
      );
    }

    return true;
  }
}
