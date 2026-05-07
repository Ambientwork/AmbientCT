// AI inference adapter — currently a browser-side mock.
// HTTP backend planned per docs/AI-ASSIST-ARCHITECTURE.md.

import type { AiFinding, AiJob, AiSegmentationMask, ReviewerState } from './types';
import { buildDemoFindings, buildDemoSegmentations } from './fixtures';
import { findingsStore, FindingsStore } from './findingsStore';

export interface InferenceClientConfig {
  /** When set, switches to HTTP backend mode. Currently a stub — throws NotImplemented. */
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
 * Current implementation: browser-side mock backed by FindingsStore + fixtures.
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
    this.config = {
      baseUrl: config.baseUrl ?? '',
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
   * HTTP (future): POST /api/ai/jobs { studyInstanceUID }
   */
  async startAiAssistJob(studyInstanceUID: string): Promise<AiJob> {
    if (this.config.baseUrl) {
      throw new Error('HTTP backend not implemented yet');
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
   * HTTP (future): GET /api/ai/jobs/:jobId
   */
  async getAiAssistJob(studyInstanceUID: string): Promise<AiJob | undefined> {
    if (this.config.baseUrl) {
      throw new Error('HTTP backend not implemented yet');
    }
    return this.store.getJob(studyInstanceUID);
  }

  /**
   * Returns AI findings for a study. Pure read — no side effects.
   *
   * Demo data is only populated by `startAiAssistJob`, never by this getter.
   * This avoids the surprise of a read mutating store state.
   *
   * HTTP (future): GET /api/ai/findings/:studyInstanceUID
   */
  async getAiFindings(studyInstanceUID: string): Promise<AiFinding[]> {
    if (this.config.baseUrl) {
      throw new Error('HTTP backend not implemented yet');
    }
    return this.store.getFindings(studyInstanceUID);
  }

  /**
   * Returns segmentation mask metadata for a study. Pure read — no side effects.
   * Same rationale as `getAiFindings`: seeding belongs in `startAiAssistJob`.
   *
   * HTTP (future): GET /api/ai/segmentations/:studyInstanceUID
   */
  async getAiSegmentations(studyInstanceUID: string): Promise<AiSegmentationMask[]> {
    if (this.config.baseUrl) {
      throw new Error('HTTP backend not implemented yet');
    }
    return this.store.getSegmentations(studyInstanceUID);
  }

  /**
   * Updates the reviewer state for a single finding.
   * Returns the updated finding, or undefined if the findingId is unknown.
   *
   * HTTP (future): POST /api/ai/findings/:findingId/review { state }
   */
  async reviewFinding(
    findingId: string,
    state: ReviewerState,
  ): Promise<AiFinding | undefined> {
    if (this.config.baseUrl) {
      throw new Error('HTTP backend not implemented yet');
    }
    return this.store.updateReview(findingId, state);
  }
}

/** Default singleton — mock mode, demo fixtures enabled. */
export const inferenceClient = new InferenceClient();
