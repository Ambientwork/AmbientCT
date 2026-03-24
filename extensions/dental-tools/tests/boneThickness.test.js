const { samplePoints, estimateBoneThickness } = require('../src/utils/huSampling');

test('samplePoints produces N equidistant points', () => {
  const pts = samplePoints([0,0,0], [10,0,0], 11);
  expect(pts).toHaveLength(11);
  expect(pts[0]).toEqual([0,0,0]);
  expect(pts[5][0]).toBeCloseTo(5);
  expect(pts[10]).toEqual([10,0,0]);
});

test('estimateBoneThickness counts points above threshold', () => {
  const huValues = [200, 500, 300, 600, 100, 450, 150, 700, 250, 800];
  const result = estimateBoneThickness(huValues, 20, 400);
  expect(result.boneThicknessMm).toBeCloseTo(10.0, 1);
  expect(result.totalLengthMm).toBe(20);
  expect(result.bonePercent).toBeCloseTo(50, 0);
});

test('estimateBoneThickness returns 0 when all below threshold', () => {
  const result = estimateBoneThickness([100, 200, 300], 15, 400);
  expect(result.boneThicknessMm).toBe(0);
});

test('estimateBoneThickness returns 0 for all above threshold', () => {
  const result = estimateBoneThickness([500, 600, 700], 15, 400);
  expect(result.boneThicknessMm).toBeCloseTo(15, 1);
  expect(result.bonePercent).toBeCloseTo(100, 0);
});

test('estimateBoneThickness returns 0 for empty array (no NaN)', () => {
  const result = estimateBoneThickness([], 10, 400);
  expect(result.boneThicknessMm).toBe(0);
  expect(result.bonePercent).toBe(0);
  expect(result.totalLengthMm).toBe(10);
});
