import { checkVolumeGeometryCompatibility, type VolumeGeometry } from '../src/utils/geometryCompat';

function baseGeometry(overrides: Partial<VolumeGeometry> = {}): VolumeGeometry {
  return {
    dimensions: [256, 256, 200],
    spacing: [0.3, 0.3, 0.3],
    origin: [-50, -50, -30],
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    frameOfReferenceUID: '1.2.840.forUid.1',
    rescaleSlope: 1,
    rescaleIntercept: 0,
    ...overrides,
  };
}

describe('checkVolumeGeometryCompatibility', () => {
  test('identical geometry is compatible', () => {
    const result = checkVolumeGeometryCompatibility(baseGeometry(), baseGeometry());
    expect(result.compatible).toBe(true);
    expect(result.reasonCode).toBeUndefined();
  });

  test('sub-tolerance spacing/origin noise is still compatible (MAR reconstruction jitter)', () => {
    const a = baseGeometry();
    const b = baseGeometry({ spacing: [0.301, 0.299, 0.3], origin: [-50.1, -49.95, -30] });
    expect(checkVolumeGeometryCompatibility(a, b).compatible).toBe(true);
  });

  test('dimension mismatch is incompatible with a PHI-free message', () => {
    const a = baseGeometry();
    const b = baseGeometry({ dimensions: [256, 256, 199] });
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('DIMENSIONS_MISMATCH');
    expect(result.message).toBe('Seriengeometrie nicht kompatibel');
    expect(result.debugDetail).not.toMatch(/[a-zA-Z]{2,}\.[a-zA-Z]{2,}/); // no name-like tokens
  });

  test('spacing beyond tolerance is incompatible', () => {
    const a = baseGeometry();
    const b = baseGeometry({ spacing: [0.5, 0.3, 0.3] });
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('SPACING_MISMATCH');
  });

  test('origin beyond tolerance is incompatible', () => {
    const a = baseGeometry();
    const b = baseGeometry({ origin: [-55, -50, -30] });
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('ORIGIN_MISMATCH');
  });

  test('direction cosine mismatch (e.g. flipped axis) is incompatible', () => {
    const a = baseGeometry();
    const b = baseGeometry({ direction: [1, 0, 0, 0, -1, 0, 0, 0, 1] });
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('DIRECTION_MISMATCH');
  });

  test('missing direction on either side skips the direction check instead of failing', () => {
    const a = baseGeometry({ direction: undefined });
    const b = baseGeometry();
    expect(checkVolumeGeometryCompatibility(a, b).compatible).toBe(true);
  });

  test('differing FrameOfReferenceUID is incompatible when both are present', () => {
    const a = baseGeometry({ frameOfReferenceUID: '1.2.3' });
    const b = baseGeometry({ frameOfReferenceUID: '1.2.4' });
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('FRAME_OF_REFERENCE_MISMATCH');
  });

  test('FrameOfReferenceUID missing on both sides is incompatible (cannot verify shared patient space)', () => {
    const a = baseGeometry({ frameOfReferenceUID: undefined });
    const b = baseGeometry({ frameOfReferenceUID: undefined });
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('FRAME_OF_REFERENCE_MISMATCH');
  });

  test('FrameOfReferenceUID missing on only one side is incompatible', () => {
    const a = baseGeometry({ frameOfReferenceUID: undefined });
    const b = baseGeometry();
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('FRAME_OF_REFERENCE_MISMATCH');
  });

  test('rescale slope/intercept mismatch is incompatible', () => {
    const a = baseGeometry({ rescaleSlope: 1, rescaleIntercept: 0 });
    const b = baseGeometry({ rescaleSlope: 1, rescaleIntercept: -1024 });
    const result = checkVolumeGeometryCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reasonCode).toBe('RESCALE_MISMATCH');
  });

  test('missing rescale values default to identity (slope 1 / intercept 0)', () => {
    const a = baseGeometry({ rescaleSlope: undefined, rescaleIntercept: undefined });
    const b = baseGeometry({ rescaleSlope: 1, rescaleIntercept: 0 });
    expect(checkVolumeGeometryCompatibility(a, b).compatible).toBe(true);
  });

  test('first failing check wins (dimensions checked before spacing)', () => {
    const a = baseGeometry();
    const b = baseGeometry({ dimensions: [1, 1, 1], spacing: [9, 9, 9] });
    expect(checkVolumeGeometryCompatibility(a, b).reasonCode).toBe('DIMENSIONS_MISMATCH');
  });
});
