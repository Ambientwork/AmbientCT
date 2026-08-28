export type LayoutMode = 'cpr' | 'mpr';

export interface CompareLayoutInput {
  layoutMode: LayoutMode;
  sourceDisplaySet: unknown;
  resultDisplaySet: unknown;
}

export interface CompareLayoutResult {
  compareSplitReady: boolean;
}

/**
 * Pure derivation of MAR-compare split-view readiness.
 *
 * Kept outside the component (and outside any hook) so it is testable
 * without React, and so the `layoutMode` value it depends on is always read
 * from already-initialized `useState` state rather than computed ahead of
 * the state declaration that owns it.
 */
export function deriveCompareLayout({
  layoutMode,
  sourceDisplaySet,
  resultDisplaySet,
}: CompareLayoutInput): CompareLayoutResult {
  return {
    compareSplitReady: layoutMode === 'mpr' && Boolean(sourceDisplaySet && resultDisplaySet),
  };
}
