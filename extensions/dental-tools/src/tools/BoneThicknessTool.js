import { LengthTool, annotation } from '@cornerstonejs/tools';
import { cache } from '@cornerstonejs/core';
import { samplePoints, estimateBoneThickness } from '../utils/huSampling';

const NUM_SAMPLES = 20;
const BONE_HU_THRESHOLD = 400;

/**
 * BoneThicknessTool
 *
 * Extends LengthTool. User places two endpoints. After placement, samples
 * HU values along the line from the loaded CT volume and estimates bone
 * thickness as the fraction of points above HU 400.
 *
 * Label: "12.4 mm gesamt | ~7.2 mm Knochen (HU>400)"
 *
 * Only works in volume viewports (requires a loaded volume in cache).
 * Falls back to "(HU-Sampling: nur Volume-Viewport)" on stack viewports.
 *
 * Phase 5+: automatic perpendicular-to-surface measurement via HU gradient.
 */
class BoneThicknessTool extends LengthTool {
  static toolName = 'BoneThicknessTool';

  mouseUpCallback(evt) {
    super.mouseUpCallback(evt);
    this._computeBoneThickness(evt.detail.element);
  }

  _computeBoneThickness(element) {
    const annotations = annotation.state.getAnnotations(
      BoneThicknessTool.toolName, element
    ) || [];
    if (!annotations.length) return;

    const ann = annotations[annotations.length - 1];
    const points = ann.data?.handles?.points;
    if (!points || points.length < 2) return;

    const [start, end] = points;

    // volumeId is stored in annotation metadata for volume viewports
    const volumeId = ann.metadata?.volumeId;
    if (!volumeId) {
      console.info('[BoneThicknessTool] No volumeId — stack viewport, HU sampling skipped');
      ann.data._boneLabel = '(HU-Sampling: nur Volume-Viewport)';
      return;
    }

    const volume = cache.getVolume(volumeId);
    if (!volume?.imageData) {
      ann.data._boneLabel = '(Volume nicht geladen)';
      return;
    }

    const pts = samplePoints(start, end, NUM_SAMPLES);
    const huValues = pts.map(pt => {
      try { return volume.imageData.getScalarValueFromWorld(pt) ?? -1000; }
      catch { return -1000; }
    });

    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const totalLengthMm = Math.sqrt(dx*dx + dy*dy + dz*dz);

    const { boneThicknessMm } = estimateBoneThickness(huValues, totalLengthMm, BONE_HU_THRESHOLD);

    ann.data._boneLabel =
      `${totalLengthMm.toFixed(1)} mm gesamt | ~${boneThicknessMm.toFixed(1)} mm Knochen (HU>${BONE_HU_THRESHOLD})`;
  }

  // Correct two-argument signature — pass targetId to super for proper fallback
  getTextLines(data, targetId) {
    if (data?._boneLabel) return [data._boneLabel];
    return super.getTextLines(data, targetId);
  }
}

export default BoneThicknessTool;
