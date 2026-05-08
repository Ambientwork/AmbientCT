// AI inference adapter — mock mode and HTTP backend.
// HTTP backend per docs/AI-ASSIST-ARCHITECTURE.md, section "Inference-Adapter-API".

import type { AiFinding, AiJob, AiSegmentationMask, ReviewerState } from './types';
import { buildDemoFindings, buildDemoSegmentations } from './fixtures';
import { findingsStore, FindingsStore } from './findingsStore';

export interface InferenceClientConfig {
  /** When set, switches to HTTP backend mode. */
  baseUrl?: string;
  /**
   * When true (default), the mock back-end seeds results from demo fixtures.
   * Set to false to start with an empty store (useful for testing).
   */
  demoMode?: boolean;
}

/**
 * Adapter for AI inference operations.
 *
 * When `baseUrl` is set: uses real fetch() calls to the FastAPI inference service.
 * Otherwise: browser-side mock backed by FindingsStore + fixtures.
 *
 * Migration path: set `baseUrl` to the local FastAPI service URL once the
 * `ai-inference` container is available (see docs/AI-ASSIST-ARCHITECTURE.md,
 * section "Inference-Adapter-API"). The HTTP endpoint shapes match the mock
 * signatures exactly, so no consumer code changes are needed.
 */
export class InferenceClient {
  private readonly config: Required<InferenceClientConfig>;
  private readonly store: FindingsStore;

  /**
   * @param config Backend mode + demo-mode toggle.
   * @param store  Optional store to use. Defaults to the shared `findingsStore`
   *               singleton. Pass a fresh `FindingsStore` instance from tests to
   *               isolate state between cases — without this, tests would all
   *               read/write the same global store and bleed state.
   */
  constructor(config: InferenceClientConfig = {}, store: FindingsStore = findingsStore) {
    // Strip trailing slash so callers can pass 'http://host:8001/' or 'http://host:8001'
    const rawBase = config.baseUrl ?? '';
    this.config = {
      baseUrl: rawBase.replace(/\/$/, ''),
      demoMode: config.demoMode ?? true,
    };
    this.store = store;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Starts an AI assist job for the given study.
   *
   * Mock: writes a `queued` job immediately, then transitions to
   * `review_required` after ~300 ms and populates findings/segmentations.
   *
   * HTTP: POST /api/ai/jobs { studyInstanceUID }
   */
  async startAiAssistJob(studyInstanceUID: string): Promise<AiJob> {
    if (this.config.baseUrl) {
      const res = await this.httpFetch('POST', '/api/ai/jobs', { studyInstanceUID });
      const job = await this.parseJob(res);
      this.store.setJob(job);
      return job;
    }

    const now = new Date().toISOString();
    const queued: AiJob = {
      jobId: `mock-job-${studyInstanceUID}`,
      studyInstanceUID,
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.store.setJob(queued);

    // Simulate async inference: status → review_required after 300 ms
    setTimeout(() => {
      const ready: AiJob = {
        ...queued,
        status: 'review_required',
        progress: 1.0,
        updatedAt: new Date().toISOString(),
      };
      this.store.setJob(ready);

      if (this.config.demoMode) {
        this.store.setFindings(studyInstanceUID, buildDemoFindings(studyInstanceUID));
        this.store.setSegmentations(studyInstanceUID, buildDemoSegmentations(studyInstanceUID));
      }
    }, 300);

    return queued;
  }

  /**
   * Returns the current job state for a study, or undefined if none exists.
   *
   * HTTP: GET /api/ai/jobs/:jobId
   * 404 → undefined (no job for this study yet — normal for first poll)
   */
  async getAiAssistJob(studyInstanceUID: string): Promise<AiJob | undefined> {
    if (this.config.baseUrl) {
      const storedJob = this.store.getJob(studyInstanceUID);
      // We need a jobId to query the server; if we have none stored, return undefined.
      if (!storedJob) return undefined;
      const res = await this.httpFetch('GET', `/api/ai/jobs/${storedJob.jobId}`, undefined, true);
      if (!res) return undefined;
      const job = await this.parseJob(res);
      this.store.setJob(job);
      return job;
    }
    return this.store.getJob(studyInstanceUID);
  }

  /**
   * Returns AI findings for a study. Pure read — no side effects.
   *
   * Demo data is only populated by `startAiAssistJob`, never by this getter.
   * This avoids the surprise of a read mutating store state.
   *
   * HTTP: GET /api/ai/findings/:studyInstanceUID
   * 404 → empty array (no findings yet — normal during job processing)
   */
  async getAiFindings(studyInstanceUID: string): Promise<AiFinding[]> {
    if (this.config.baseUrl) {
      const res = await this.httpFetch('GET', `/api/ai/findings/${studyInstanceUID}`, undefined, true);
      if (!res) return [];
      const data = await res.json() as { findings: AiFinding[] };
      return data.findings;
    }
    return this.store.getFindings(studyInstanceUID);
  }

  /**
   * Returns segmentation mask metadata for a study. Pure read — no side effects.
   * Same rationale as `getAiFindings`: seeding belongs in `startAiAssistJob`.
   *
   * HTTP: GET /api/ai/segmentations/:studyInstanceUID
   */
  async getAiSegmentations(studyInstanceUID: string): Promise<AiSegmentationMask[]> {
    if (this.config.baseUrl) {
      const res = await this.httpFetch('GET', `/api/ai/segmentations/${studyInstanceUID}`);
      const data = await res.json() as { segmentations: AiSegmentationMask[] };
      return data.segmentations;
    }
    return this.store.getSegmentations(studyInstanceUID);
  }

  /**
   * Updates the reviewer state for a single finding.
   * Returns the updated finding, or undefined if the findingId is unknown.
   *
   * HTTP: POST /api/ai/findings/:findingId/review { state }
   */
  async reviewFinding(
    findingId: string,
    state: ReviewerState,
  ): Promise<AiFinding | undefined> {
    if (this.config.baseUrl) {
      const res = await this.httpFetch('POST', `/api/ai/findings/${findingId}/review`, { state });
      // Server confirms with { findingId, reviewerState } — update the local store
      // so consumers subscribed to the store see the change without a separate fetch.
      const data = await res.json() as { findingId: string; reviewerState: ReviewerState };
      return this.store.updateReview(data.findingId, data.reviewerState);
    }
    return this.store.updateReview(findingId, state);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Executes a fetch against the configured baseUrl.
   *
   * @param allow404 When true, a 404 response returns `undefined` instead of
   *                 throwing. Use for "no such resource yet" endpoints (job
   *                 polling, findings before job completes).
   */
  private async httpFetch(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    allow404?: boolean,
  ): Promise<Response>;
  private async httpFetch(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    allow404: true,
  ): Promise<Response | undefined>;
  private async httpFetch(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    allow404 = false,
  ): Promise<Response | undefined> {
    const url = `${this.config.baseUrl}${path}`;
    const hasBody = body !== undefined;
    const init: RequestInit = {
      method,
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
      // No credentials — service is on internal Docker network behind nginx
    };
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`AI inference network error on ${method} ${path}: ${msg}`);
    }
    if (res.status === 404 && allow404) {
      return undefined;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI inference HTTP ${res.status} on ${method} ${path}: ${text.slice(0, 200)}`);
    }
    return res;
  }

  /** Parses a Response body as AiJob. */
  private async parseJob(res: Response): Promise<AiJob> {
    return res.json() as Promise<AiJob>;
  }
}

/** Default singleton — mock mode, demo fixtures enabled. */
export const inferenceClient = new InferenceClient();
