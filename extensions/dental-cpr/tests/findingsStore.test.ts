// Tests for FindingsStore — localStorage-backed AI findings store.

// ── localStorage mock (node environment has no DOM) ──────────────────────────
// The store module reads localStorage at import time for hydration, so the mock
// must be in place before the first import. Jest hoists jest.mock() calls, but
// since we need a stateful in-memory mock we set up global.localStorage manually
// before any imports happen (this file's top-level code runs before module load).

const localStorageStore: Record<string, string> = {};

const localStorageMock = {
  getItem: jest.fn((key: string): string | null => localStorageStore[key] ?? null),
  setItem: jest.fn((key: string, value: string): void => { localStorageStore[key] = value; }),
  removeItem: jest.fn((key: string): void => { delete localStorageStore[key]; }),
  clear: jest.fn((): void => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }),
  get length(): number { return Object.keys(localStorageStore).length; },
  key: jest.fn((index: number): string | null => Object.keys(localStorageStore)[index] ?? null),
};

// @ts-expect-error — setting global.localStorage in node environment
global.localStorage = localStorageMock;

// ── Imports (after mock is wired) ─────────────────────────────────────────────
import { FindingsStore } from '../src/ai/findingsStore';
import type { AiFinding, AiJob, AiSegmentationMask } from '../src/ai/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(studyInstanceUID = '1.2.3'): AiJob {
  return {
    jobId: 'j1',
    studyInstanceUID,
    status: 'queued',
    progress: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeFinding(
  id = 'f1',
  studyInstanceUID = '1.2.3',
): AiFinding {
  return {
    findingId: id,
    jobId: 'j1',
    studyInstanceUID,
    findingClass: 'periapical_radiolucency',
    confidence: 0.9,
    uncertainty: 'low',
    reviewerState: 'unreviewed',
    source: {
      modelId: 'test',
      modelVersion: '0.0.1',
      createdAt: '2024-01-01T00:00:00Z',
      studyInstanceUID,
    },
    isDemo: false,
  };
}

function makeSeg(studyInstanceUID = '1.2.3'): AiSegmentationMask {
  return {
    segmentationId: 'seg1',
    jobId: 'j1',
    studyInstanceUID,
    anatomyClass: 'mandible',
    confidence: 0.88,
    uncertainty: 'low',
    source: {
      modelId: 'test',
      modelVersion: '0.0.1',
      createdAt: '2024-01-01T00:00:00Z',
      studyInstanceUID,
    },
    isDemo: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FindingsStore', () => {
  let store: FindingsStore;

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    store = new FindingsStore();
  });

  // ── Job roundtrip ────────────────────────────────────────────────────────

  test('setJob + getJob roundtrip', () => {
    const job = makeJob();
    store.setJob(job);
    expect(store.getJob('1.2.3')).toEqual(job);
  });

  test('getJob returns undefined for unknown study', () => {
    expect(store.getJob('9.9.9')).toBeUndefined();
  });

  // ── Findings roundtrip ───────────────────────────────────────────────────

  test('setFindings + getFindings roundtrip', () => {
    const findings = [makeFinding('f1'), makeFinding('f2')];
    store.setFindings('1.2.3', findings);
    expect(store.getFindings('1.2.3')).toHaveLength(2);
    expect(store.getFindings('1.2.3')[0].findingId).toBe('f1');
  });

  test('getFindings returns empty array for unknown study', () => {
    expect(store.getFindings('9.9.9')).toEqual([]);
  });

  // ── updateReview ─────────────────────────────────────────────────────────

  test('updateReview changes reviewerState and returns updated finding', () => {
    store.setFindings('1.2.3', [makeFinding('f1')]);
    const updated = store.updateReview('f1', 'accepted');
    expect(updated).toBeDefined();
    expect(updated!.reviewerState).toBe('accepted');
    // Verify the store reflects the change
    expect(store.getFindings('1.2.3')[0].reviewerState).toBe('accepted');
  });

  test('updateReview returns undefined for unknown findingId', () => {
    expect(store.updateReview('no-such-id', 'rejected')).toBeUndefined();
  });

  // ── Segmentations roundtrip ──────────────────────────────────────────────

  test('setSegmentations + getSegmentations roundtrip', () => {
    const segs = [makeSeg()];
    store.setSegmentations('1.2.3', segs);
    expect(store.getSegmentations('1.2.3')).toHaveLength(1);
    expect(store.getSegmentations('1.2.3')[0].anatomyClass).toBe('mandible');
  });

  // ── Subscribe ─────────────────────────────────────────────────────────────

  test('subscribe listener is called on setJob', () => {
    const listener = jest.fn();
    store.subscribe(listener);
    store.setJob(makeJob());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('subscribe listener is NOT called on getJob', () => {
    const listener = jest.fn();
    store.subscribe(listener);
    store.getJob('1.2.3');
    expect(listener).not.toHaveBeenCalled();
  });

  test('subscribe listener is called on setFindings', () => {
    const listener = jest.fn();
    store.subscribe(listener);
    store.setFindings('1.2.3', [makeFinding()]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('unsubscribe stops notifications', () => {
    const listener = jest.fn();
    const unsub = store.subscribe(listener);
    unsub();
    store.setJob(makeJob());
    expect(listener).not.toHaveBeenCalled();
  });

  // ── localStorage persistence ──────────────────────────────────────────────

  test('data persists to localStorage and is hydrated by a new store instance', () => {
    store.setJob(makeJob('1.2.3'));
    store.setFindings('1.2.3', [makeFinding('f1')]);

    // Simulate page reload — create a fresh store instance that reads localStorage
    const store2 = new FindingsStore();
    expect(store2.getJob('1.2.3')?.jobId).toBe('j1');
    expect(store2.getFindings('1.2.3')).toHaveLength(1);
  });

  // ── Corrupt localStorage ──────────────────────────────────────────────────

  test('defective localStorage JSON is silently ignored — store starts empty', () => {
    localStorageStore['ambientct.ai.store.v1'] = '{{{not valid json';
    const corruptStore = new FindingsStore();
    expect(corruptStore.getJob('1.2.3')).toBeUndefined();
    expect(corruptStore.getFindings('1.2.3')).toEqual([]);
  });

  test('partial localStorage JSON (missing keys) falls back to empty state', () => {
    localStorageStore['ambientct.ai.store.v1'] = JSON.stringify({ foo: 'bar' });
    const corruptStore = new FindingsStore();
    expect(corruptStore.getJob('1.2.3')).toBeUndefined();
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  test('reset clears in-memory state and localStorage', () => {
    store.setJob(makeJob());
    store.setFindings('1.2.3', [makeFinding()]);
    store.reset();
    expect(store.getJob('1.2.3')).toBeUndefined();
    expect(store.getFindings('1.2.3')).toEqual([]);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('ambientct.ai.store.v1');
  });
});
