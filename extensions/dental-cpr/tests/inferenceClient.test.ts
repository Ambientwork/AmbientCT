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

});

// ── InferenceClient (HTTP mode) ───────────────────────────────────────────────

describe('InferenceClient (HTTP mode)', () => {
  const BASE_URL = 'http://localhost:8001';

  // Shared fixture data
  const mockJob = {
    jobId: 'j1',
    studyInstanceUID: '1.2.3',
    status: 'queued',
    progress: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockFinding = {
    findingId: 'f1',
    jobId: 'j1',
    studyInstanceUID: '1.2.3',
    findingClass: 'periapical_radiolucency',
    confidence: 0.85,
    uncertainty: 'low',
    reviewerState: 'unreviewed',
    source: {
      modelId: 'dental-seg-v1',
      modelVersion: '1.0.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      studyInstanceUID: '1.2.3',
    },
    isDemo: false,
  };

  const mockSegmentation = {
    segmentationId: 's1',
    jobId: 'j1',
    studyInstanceUID: '1.2.3',
    anatomyClass: 'mandible',
    confidence: 0.92,
    uncertainty: 'low',
    source: {
      modelId: 'dental-seg-v1',
      modelVersion: '1.0.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      studyInstanceUID: '1.2.3',
    },
    isDemo: false,
  };

  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  // ── 1. startAiAssistJob ───────────────────────────────────────────────────

  test('startAiAssistJob POSTs to correct URL with studyInstanceUID body and returns parsed AiJob', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockJob,
    });

    const store = new FindingsStore();
    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const job = await client.startAiAssistJob('1.2.3');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8001/api/ai/jobs');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ studyInstanceUID: '1.2.3' });

    expect(job.jobId).toBe('j1');
    expect(job.status).toBe('queued');
    expect(job.studyInstanceUID).toBe('1.2.3');

    // Job must also be written to the store
    expect(store.getJob('1.2.3')).toEqual(mockJob);
  });

  // ── 2. getAiAssistJob — 200 ───────────────────────────────────────────────

  test('getAiAssistJob GETs /api/ai/jobs/:jobId and returns AiJob on 200', async () => {
    // Seed store with a job so we have a jobId to look up
    const store = new FindingsStore();
    store.setJob(mockJob);

    const updatedJob = { ...mockJob, status: 'running', progress: 0.4 };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => updatedJob,
    });

    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const job = await client.getAiAssistJob('1.2.3');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8001/api/ai/jobs/j1');
    expect(init.method).toBe('GET');

    expect(job).toBeDefined();
    expect(job!.status).toBe('running');
    expect(job!.progress).toBe(0.4);
  });

  // ── 3. getAiAssistJob — 404 ───────────────────────────────────────────────

  test('getAiAssistJob returns undefined on 404', async () => {
    const store = new FindingsStore();
    store.setJob(mockJob);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const job = await client.getAiAssistJob('1.2.3');
    expect(job).toBeUndefined();
  });

  // ── 3b. getAiAssistJob — no stored job ────────────────────────────────────

  test('getAiAssistJob returns undefined when no job is stored (no fetch call made)', async () => {
    const store = new FindingsStore();
    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const job = await client.getAiAssistJob('1.2.3');
    expect(job).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── 4. getAiFindings — 200 ────────────────────────────────────────────────

  test('getAiFindings GETs /api/ai/findings/:studyInstanceUID and returns findings array', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ findings: [mockFinding] }),
    });

    const store = new FindingsStore();
    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const findings = await client.getAiFindings('1.2.3');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8001/api/ai/findings/1.2.3');
    expect(init.method).toBe('GET');

    expect(findings).toHaveLength(1);
    expect(findings[0].findingId).toBe('f1');
    expect(findings[0].findingClass).toBe('periapical_radiolucency');
  });

  // ── 5. getAiFindings — 404 ────────────────────────────────────────────────

  test('getAiFindings returns empty array on 404', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const store = new FindingsStore();
    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const findings = await client.getAiFindings('1.2.3');
    expect(findings).toEqual([]);
  });

  // ── 6. getAiSegmentations ─────────────────────────────────────────────────

  test('getAiSegmentations GETs /api/ai/segmentations/:studyInstanceUID and returns segmentations array', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ segmentations: [mockSegmentation] }),
    });

    const store = new FindingsStore();
    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const segs = await client.getAiSegmentations('1.2.3');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8001/api/ai/segmentations/1.2.3');
    expect(init.method).toBe('GET');

    expect(segs).toHaveLength(1);
    expect(segs[0].segmentationId).toBe('s1');
    expect(segs[0].anatomyClass).toBe('mandible');
  });

  // ── 7. reviewFinding ──────────────────────────────────────────────────────

  test('reviewFinding POSTs state to /api/ai/findings/:findingId/review and updates store', async () => {
    // Pre-populate store so updateReview can find the finding
    const store = new FindingsStore();
    store.setFindings('1.2.3', [mockFinding as ReturnType<typeof store.getFindings>[number]]);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ findingId: 'f1', reviewerState: 'accepted' }),
    });

    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    const updated = await client.reviewFinding('f1', 'accepted');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8001/api/ai/findings/f1/review');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ state: 'accepted' });

    expect(updated).toBeDefined();
    expect(updated!.reviewerState).toBe('accepted');

    // Store must also reflect the change
    const stored = store.getFindings('1.2.3').find(f => f.findingId === 'f1');
    expect(stored?.reviewerState).toBe('accepted');
  });

  // ── 8. Network error → descriptive throw ─────────────────────────────────

  test('network error throws with descriptive message including method and path', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'));

    const store = new FindingsStore();
    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    await expect(client.getAiFindings('1.2.3')).rejects.toThrow(
      'AI inference network error on GET /api/ai/findings/1.2.3: net::ERR_CONNECTION_REFUSED',
    );
  });

  // ── 9. Trailing-slash normalization ──────────────────────────────────────

  test('baseUrl with trailing slash produces no double slash in request URL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ findings: [] }),
    });

    const store = new FindingsStore();
    // Pass URL with trailing slash — should be stripped in constructor
    const client = new InferenceClient({ baseUrl: 'http://localhost:8001/' }, store);
    await client.getAiFindings('1.2.3');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8001/api/ai/findings/1.2.3');
    // No double slash
    expect(url).not.toContain('//api');
  });

  // ── 10. HTTP 500 → error thrown ───────────────────────────────────────────

  test('HTTP 500 throws with status code, method and path in message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const store = new FindingsStore();
    const client = new InferenceClient({ baseUrl: BASE_URL }, store);
    await expect(client.startAiAssistJob('1.2.3')).rejects.toThrow(
      'AI inference HTTP 500 on POST /api/ai/jobs',
    );
  });
});
