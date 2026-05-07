// Tests for InferenceClient — mock inference adapter.

// ── localStorage mock (must be set before any module imports) ─────────────────
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

// ── Imports ───────────────────────────────────────────────────────────────────
import { InferenceClient } from '../src/ai/inferenceClient';
import { FindingsStore } from '../src/ai/findingsStore';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InferenceClient (mock mode)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── startAiAssistJob ──────────────────────────────────────────────────────

  test('startAiAssistJob returns a queued job immediately', async () => {
    const client = new InferenceClient({ demoMode: false });
    const job = await client.startAiAssistJob('1.2.3');
    expect(job.status).toBe('queued');
    expect(job.studyInstanceUID).toBe('1.2.3');
    expect(job.progress).toBe(0);
  });

  test('after 500 ms, job status transitions to review_required', async () => {
    const client = new InferenceClient({ demoMode: false });
    await client.startAiAssistJob('1.2.3');

    jest.advanceTimersByTime(500);

    const updated = await client.getAiAssistJob('1.2.3');
    expect(updated?.status).toBe('review_required');
    expect(updated?.progress).toBe(1.0);
  });

  test('after timer tick with demoMode=true, findings and segmentations are populated', async () => {
    const client = new InferenceClient({ demoMode: true });
    await client.startAiAssistJob('1.2.3');

    jest.advanceTimersByTime(500);

    const findings = await client.getAiFindings('1.2.3');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(f => f.isDemo)).toBe(true);

    const segs = await client.getAiSegmentations('1.2.3');
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every(s => s.isDemo)).toBe(true);
  });

  // ── getAiFindings ─────────────────────────────────────────────────────────

  test('getAiFindings is a pure read — returns empty array before a job is started', async () => {
    // Use an injected fresh store so the singleton's state cannot leak in.
    const store = new FindingsStore();
    const client = new InferenceClient({ demoMode: true }, store);
    const findings = await client.getAiFindings('9.8.7');
    expect(findings).toEqual([]);
  });

  test('getAiFindings returns empty array when demoMode=false and no job started', async () => {
    const store = new FindingsStore();
    const client = new InferenceClient({ demoMode: false }, store);
    const findings = await client.getAiFindings('5.5.5');
    expect(findings).toEqual([]);
  });

  test('getAiFindings returns demo fixtures only after startAiAssistJob with demoMode=true', async () => {
    const store = new FindingsStore();
    const client = new InferenceClient({ demoMode: true }, store);

    expect(await client.getAiFindings('1.2.3')).toEqual([]);
    await client.startAiAssistJob('1.2.3');
    jest.advanceTimersByTime(500);

    const findings = await client.getAiFindings('1.2.3');
    expect(findings.length).toBeGreaterThanOrEqual(3);
    expect(findings.every(f => f.isDemo)).toBe(true);
    expect(findings.every(f => f.reviewerState === 'unreviewed')).toBe(true);
  });

  // ── reviewFinding ─────────────────────────────────────────────────────────

  test('reviewFinding mutates reviewerState on a known finding', async () => {
    const store = new FindingsStore();
    const client = new InferenceClient({ demoMode: true }, store);
    await client.startAiAssistJob('1.2.3');
    jest.advanceTimersByTime(500);

    const findings = await client.getAiFindings('1.2.3');
    const targetId = findings[0].findingId;

    const updated = await client.reviewFinding(targetId, 'accepted');
    expect(updated).toBeDefined();
    expect(updated!.reviewerState).toBe('accepted');
    expect(updated!.findingId).toBe(targetId);

    // Verify the store also reflects the change
    const refetched = await client.getAiFindings('1.2.3');
    const found = refetched.find(f => f.findingId === targetId);
    expect(found?.reviewerState).toBe('accepted');
  });

  test('reviewFinding returns undefined for unknown findingId', async () => {
    const store = new FindingsStore();
    const client = new InferenceClient({ demoMode: true }, store);
    const result = await client.reviewFinding('no-such-finding', 'rejected');
    expect(result).toBeUndefined();
  });

  // ── Store injection isolation ─────────────────────────────────────────────

  test('two clients with distinct stores do not bleed state into each other', async () => {
    const storeA = new FindingsStore();
    const storeB = new FindingsStore();
    const clientA = new InferenceClient({ demoMode: true }, storeA);
    const clientB = new InferenceClient({ demoMode: true }, storeB);

    await clientA.startAiAssistJob('study-A');
    jest.advanceTimersByTime(500);

    expect((await clientA.getAiFindings('study-A')).length).toBeGreaterThan(0);
    // clientB sees nothing for study-A: its store has never been written to.
    expect(await clientB.getAiFindings('study-A')).toEqual([]);
    expect(await clientB.getAiAssistJob('study-A')).toBeUndefined();
  });

  // ── getAiAssistJob ────────────────────────────────────────────────────────

  test('getAiAssistJob returns undefined before any job is started', async () => {
    const client = new InferenceClient({ demoMode: false });
    const job = await client.getAiAssistJob('0.0.0');
    expect(job).toBeUndefined();
  });

  // ── HTTP mode ─────────────────────────────────────────────────────────────

  test('startAiAssistJob throws "HTTP backend not implemented yet" when baseUrl is set', async () => {
    const client = new InferenceClient({ baseUrl: 'http://localhost:8001' });
    await expect(client.startAiAssistJob('1.2.3')).rejects.toThrow(
      'HTTP backend not implemented yet',
    );
  });

  test('getAiAssistJob throws when baseUrl is set', async () => {
    const client = new InferenceClient({ baseUrl: 'http://localhost:8001' });
    await expect(client.getAiAssistJob('1.2.3')).rejects.toThrow(
      'HTTP backend not implemented yet',
    );
  });

  test('getAiFindings throws when baseUrl is set', async () => {
    const client = new InferenceClient({ baseUrl: 'http://localhost:8001' });
    await expect(client.getAiFindings('1.2.3')).rejects.toThrow(
      'HTTP backend not implemented yet',
    );
  });

  test('reviewFinding throws when baseUrl is set', async () => {
    const client = new InferenceClient({ baseUrl: 'http://localhost:8001' });
    await expect(client.reviewFinding('f1', 'accepted')).rejects.toThrow(
      'HTTP backend not implemented yet',
    );
  });
});
