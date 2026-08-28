// extensions/dental-cpr/src/utils/geometryCompat.ts
//
// Pure geometry-compatibility gate for MAR compare diffing (plan §10 P3.5).
// A pixel-wise HU difference is only meaningful when both volumes occupy the
// same patient space. This module never touches cornerstone/vtk — it takes
// plain numeric geometry and returns a PHI-free compatibility verdict.

export interface VolumeGeometry {
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  /** 9-value row-major direction-cosine matrix, if available. */
  direction?: number[];
  frameOfReferenceUID?: string;
  rescaleSlope?: number;
  rescaleIntercept?: number;
}

export type GeometryMismatchReason =
  | 'DIMENSIONS_MISMATCH'
  | 'SPACING_MISMATCH'
  | 'ORIGIN_MISMATCH'
  | 'DIRECTION_MISMATCH'
  | 'FRAME_OF_REFERENCE_MISMATCH'
  | 'RESCALE_MISMATCH';

export interface GeometryCompatibilityResult {
  compatible: boolean;
  reasonCode?: GeometryMismatchReason;
  /** User-facing, PHI-free (no tag values, no patient data). */
  message?: string;
  /** Technical detail for console.debug only — numeric deltas, no identifiers. */
  debugDetail?: string;
}

// Tolerances chosen for CBCT-scale geometry (voxel spacing ~0.1-0.5mm).
export const SPACING_TOLERANCE_MM = 0.05;
export const ORIGIN_TOLERANCE_MM = 0.5;
export const DIRECTION_TOLERANCE = 0.01;
export const RESCALE_TOLERANCE = 1e-3;

const INCOMPATIBLE_MESSAGE = 'Seriengeometrie nicht kompatibel';

export function checkVolumeGeometryCompatibility(
  a: VolumeGeometry,
  b: VolumeGeometry
): GeometryCompatibilityResult {
  if (!dimsEqual(a.dimensions, b.dimensions)) {
    return incompatible(
      'DIMENSIONS_MISMATCH',
      `dims ${a.dimensions.join('x')} vs ${b.dimensions.join('x')}`
    );
  }

  const spacingDiff = maxAbsDiff(a.spacing, b.spacing);
  if (spacingDiff > SPACING_TOLERANCE_MM) {
    return incompatible(
      'SPACING_MISMATCH',
      `spacing diff ${spacingDiff.toFixed(3)}mm > tolerance ${SPACING_TOLERANCE_MM}mm`
    );
  }

  const originDiff = maxAbsDiff(a.origin, b.origin);
  if (originDiff > ORIGIN_TOLERANCE_MM) {
    return incompatible(
      'ORIGIN_MISMATCH',
      `origin diff ${originDiff.toFixed(3)}mm > tolerance ${ORIGIN_TOLERANCE_MM}mm`
    );
  }

  // direction comes from vtkImageData.getDirection(), which always returns a
  // 9-value matrix (identity when the source never set one explicitly) — so
  // in practice this length guard is never the reason the check is skipped;
  // it exists purely as a defensive type guard against a malformed caller.
  if (a.direction?.length === 9 && b.direction?.length === 9) {
    const dirDiff = maxAbsDiff(a.direction, b.direction);
    if (dirDiff > DIRECTION_TOLERANCE) {
      return incompatible(
        'DIRECTION_MISMATCH',
        `direction cosine diff ${dirDiff.toFixed(4)} > tolerance ${DIRECTION_TOLERANCE}`
      );
    }
  }

  // FrameOfReferenceUID is read from volume.metadata (volumeLookup.ts), which
  // cornerstone3D populates from the series' DICOM metadata at volume-creation
  // time — before pixel data streams in — so it is reliably present by the
  // time this gate runs (gated on isVolumeReady(), i.e. imageData already has
  // sampleable points). mar-processor's _make_mar_dataset() deep-copies the
  // source instance and only overrides Series/SOPInstanceUID, description,
  // number and pixel data, so a MAR series always inherits its source's
  // FrameOfReferenceUID unchanged. A missing value here therefore is not a
  // transient loading state — it means the series' DICOM metadata itself
  // lacks a FrameOfReferenceUID, which makes "same patient space" impossible
  // to verify. Per plan P3.5 that must block the diff, not silently pass it:
  // previously this check was skipped (return compatible) whenever either
  // side was missing the tag instead of treated as incompatible.
  if (!a.frameOfReferenceUID || !b.frameOfReferenceUID) {
    return incompatible(
      'FRAME_OF_REFERENCE_MISMATCH',
      'FrameOfReferenceUID missing on one or both series — cannot verify shared patient space'
    );
  }
  if (a.frameOfReferenceUID !== b.frameOfReferenceUID) {
    return incompatible('FRAME_OF_REFERENCE_MISMATCH', 'FrameOfReferenceUID differs between series');
  }

  // RescaleSlope/RescaleIntercept absence is NOT a metadata-availability gap
  // like FrameOfReferenceUID above — per DICOM PS3.3 C.11.1, an image
  // without these optional tags is defined to have slope=1/intercept=0
  // (identity rescale). Defaulting here implements that standard default,
  // it does not paper over a missing check.
  const slopeA = a.rescaleSlope ?? 1;
  const slopeB = b.rescaleSlope ?? 1;
  const interceptA = a.rescaleIntercept ?? 0;
  const interceptB = b.rescaleIntercept ?? 0;
  if (
    Math.abs(slopeA - slopeB) > RESCALE_TOLERANCE ||
    Math.abs(interceptA - interceptB) > RESCALE_TOLERANCE
  ) {
    return incompatible(
      'RESCALE_MISMATCH',
      `rescale slope/intercept differ (${slopeA}/${interceptA} vs ${slopeB}/${interceptB})`
    );
  }

  return { compatible: true };
}

function incompatible(reasonCode: GeometryMismatchReason, debugDetail: string): GeometryCompatibilityResult {
  return { compatible: false, reasonCode, message: INCOMPATIBLE_MESSAGE, debugDetail };
}

function dimsEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function maxAbsDiff(a: readonly number[], b: readonly number[]): number {
  let max = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}
