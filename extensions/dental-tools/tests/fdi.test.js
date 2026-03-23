const { getToothInfo, getAllTeeth, isValidFDI } = require('../src/utils/fdi');

test('isValidFDI rejects out-of-range', () => {
  expect(isValidFDI(10)).toBe(false);
  expect(isValidFDI(49)).toBe(false);
  expect(isValidFDI(19)).toBe(false);
  expect(isValidFDI(0)).toBe(false);
});

test('isValidFDI accepts valid FDI numbers', () => {
  expect(isValidFDI(11)).toBe(true);
  expect(isValidFDI(48)).toBe(true);
  expect(isValidFDI(36)).toBe(true);
  expect(isValidFDI(28)).toBe(true);
});

test('getToothInfo returns correct data for 36', () => {
  const info = getToothInfo(36);
  expect(info.quadrant).toBe(3);
  expect(info.position).toBe(6);
  expect(info.name).toBe('Erster Molar');
  expect(info.jaw).toBe('lower');
  expect(info.side).toBe('left');
});

test('getAllTeeth returns 32 entries', () => {
  expect(getAllTeeth()).toHaveLength(32);
});

test('getAllTeeth has 8 teeth per quadrant', () => {
  const teeth = getAllTeeth();
  [1, 2, 3, 4].forEach(q => {
    expect(teeth.filter(t => t.quadrant === q)).toHaveLength(8);
  });
});
