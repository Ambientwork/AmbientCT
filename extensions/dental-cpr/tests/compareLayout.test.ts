import { deriveCompareLayout } from '../src/utils/compareLayout';

// ── first render (CPR) ──────────────────────────────────────────────────────

test('first render in CPR mode: compareSplitReady is false even when both display sets are already resolved', () => {
  const result = deriveCompareLayout({
    layoutMode: 'cpr',
    sourceDisplaySet: { SeriesInstanceUID: 'source-1' },
    resultDisplaySet: { SeriesInstanceUID: 'result-1' },
  });
  expect(result.compareSplitReady).toBe(false);
});

test('first render in CPR mode: compareSplitReady is false with no display sets resolved yet', () => {
  const result = deriveCompareLayout({
    layoutMode: 'cpr',
    sourceDisplaySet: undefined,
    resultDisplaySet: undefined,
  });
  expect(result.compareSplitReady).toBe(false);
});

// ── CPR -> MPR switch ────────────────────────────────────────────────────────

test('CPR -> MPR switch: compareSplitReady becomes true once both display sets have resolved', () => {
  const sourceDisplaySet = { SeriesInstanceUID: 'source-1' };
  const resultDisplaySet = { SeriesInstanceUID: 'result-1' };

  const beforeSwitch = deriveCompareLayout({ layoutMode: 'cpr', sourceDisplaySet, resultDisplaySet });
  expect(beforeSwitch.compareSplitReady).toBe(false);

  const afterSwitch = deriveCompareLayout({ layoutMode: 'mpr', sourceDisplaySet, resultDisplaySet });
  expect(afterSwitch.compareSplitReady).toBe(true);
});

test('CPR -> MPR switch: stays false in MPR mode while only the source display set has resolved', () => {
  const result = deriveCompareLayout({
    layoutMode: 'mpr',
    sourceDisplaySet: { SeriesInstanceUID: 'source-1' },
    resultDisplaySet: undefined,
  });
  expect(result.compareSplitReady).toBe(false);
});

test('CPR -> MPR switch: stays false in MPR mode while only the result display set has resolved', () => {
  const result = deriveCompareLayout({
    layoutMode: 'mpr',
    sourceDisplaySet: undefined,
    resultDisplaySet: { SeriesInstanceUID: 'result-1' },
  });
  expect(result.compareSplitReady).toBe(false);
});

test('CPR -> MPR switch: stays false in MPR mode when neither display set has resolved', () => {
  const result = deriveCompareLayout({
    layoutMode: 'mpr',
    sourceDisplaySet: undefined,
    resultDisplaySet: undefined,
  });
  expect(result.compareSplitReady).toBe(false);
});
