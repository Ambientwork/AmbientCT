/**
 * Pure HU sampling utilities — no Cornerstone3D dependencies.
 * Used by BoneThicknessTool and testable in Jest.
 */

function samplePoints(start, end, n) {
  if (n < 2) return [start.slice()];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [
      start[0] + t * (end[0] - start[0]),
      start[1] + t * (end[1] - start[1]),
      start[2] + t * (end[2] - start[2]),
    ];
  });
}

function estimateBoneThickness(huValues, totalLengthMm, threshold = 400) {
  const boneCount = huValues.filter(hu => hu > threshold).length;
  const bonePercent = (boneCount / huValues.length) * 100;
  const boneThicknessMm = (bonePercent / 100) * totalLengthMm;
  return { boneThicknessMm, totalLengthMm, bonePercent };
}

module.exports = { samplePoints, estimateBoneThickness };
