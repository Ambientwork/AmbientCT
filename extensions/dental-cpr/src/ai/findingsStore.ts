// AmbientCT AI Assist — browser-side findings store with subscribe pattern.
// No Redux, no external dependencies.

import type { AiFinding, AiJob, AiSegmentationMask, ReviewerState } from './types';

const LS_KEY = 'ambientct.ai.store.v1';

interface StoreState {
  jobs: Record<string, AiJob>;
  findings: Record<string, AiFinding[]>;
  segmentations: Record<string, AiSegmentationMask[]>;
}

function emptyState(): StoreState {
  return { jobs: {}, findings: {}, segmentations: {} };
}

function parseStoredState(): StoreState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('jobs' in parsed) ||
      !('findings' in parsed) ||
      !('segmentations' in parsed)
    ) {
      return emptyState();
    }
    return parsed as StoreState;
  } catch {
    return emptyState();
  }
}

/**
 * Browser-side store for AI jobs, findings and segmentation metadata.
 * Persisted to localStorage under key `ambientct.ai.store.v1`.
 *
 * StudyInstanceUID is used as an opaque key — it is not a direct PHI identifier
 * in this context (it is already present in browser URLs and DICOM responses).
 */
export class FindingsStore {
  private state: StoreState;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.state = parseStoredState();
  }

  // ── Jobs ───────────────────────────────────────────────────────────────────

  getJob(studyInstanceUID: string): AiJob | undefined {
    return this.state.jobs[studyInstanceUID];
  }

  setJob(job: AiJob): void {
    this.state.jobs[job.studyInstanceUID] = job;
    this.persist();
    this.notify();
  }

  // ── Findings ───────────────────────────────────────────────────────────────

  getFindings(studyInstanceUID: string): AiFinding[] {
    return this.state.findings[studyInstanceUID] ?? [];
  }

  setFindings(studyInstanceUID: string, findings: AiFinding[]): void {
    this.state.findings[studyInstanceUID] = findings;
    this.persist();
    this.notify();
  }

  /**
   * Atomically updates the reviewerState of a single finding.
   * Returns the updated AiFinding, or undefined if the findingId is unknown.
   */
  updateReview(findingId: string, state: ReviewerState): AiFinding | undefined {
    for (const uid of Object.keys(this.state.findings)) {
      const list = this.state.findings[uid];
      const idx = list.findIndex(f => f.findingId === findingId);
      if (idx !== -1) {
        const updated: AiFinding = { ...list[idx], reviewerState: state };
        this.state.findings[uid] = [
          ...list.slice(0, idx),
          updated,
          ...list.slice(idx + 1),
        ];
        this.persist();
        this.notify();
        return updated;
      }
    }
    return undefined;
  }

  // ── Segmentations ──────────────────────────────────────────────────────────

  getSegmentations(studyInstanceUID: string): AiSegmentationMask[] {
    return this.state.segmentations[studyInstanceUID] ?? [];
  }

  setSegmentations(studyInstanceUID: string, segs: AiSegmentationMask[]): void {
    this.state.segmentations[studyInstanceUID] = segs;
    this.persist();
    this.notify();
  }

  // ── Subscribe ──────────────────────────────────────────────────────────────

  /**
   * Registers a listener called whenever the store changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  reset(): void {
    this.state = emptyState();
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // localStorage may be unavailable in some test environments — ignore
    }
    this.notify();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private persist(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    } catch {
      // Storage quota exceeded or unavailable — continue in-memory
    }
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }
}

/** Default singleton — use this throughout the application. */
export const findingsStore = new FindingsStore();
