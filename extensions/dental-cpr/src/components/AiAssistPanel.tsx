// AiAssistPanel — AI Assist UI for AmbientCT.
// Research preview · Demo data · Not for diagnosis.
// Wording per docs/AI-ASSIST-ARCHITECTURE.md — no "diagnose", "detect all", "clinical-grade".

import React, { useEffect, useState, useCallback } from 'react';
import { findingsStore } from '../ai/findingsStore';
import { inferenceClient } from '../ai/inferenceClient';
import type {
  AiFinding,
  AiJob,
  AiSegmentationMask,
  FindingClass,
  AnatomyClass,
  UncertaintyLevel,
  ReviewerState,
} from '../ai/types';

// ── Label mappings ────────────────────────────────────────────────────────────

function findingLabel(cls: FindingClass): string {
  const map: Record<FindingClass, string> = {
    periodontal_bone_loss:      'Periodontal bone loss (suggested)',
    periapical_radiolucency:    'Periapical radiolucency (suggested)',
    caries_suspected:           'Caries suspected',
    sinus_opacity:              'Sinus opacity (suggested)',
    tmj_degeneration_suspected: 'TMJ degeneration (suggested)',
  };
  return map[cls] ?? cls;
}

function anatomyLabel(cls: AnatomyClass): string {
  const map: Record<AnatomyClass, string> = {
    mandible:         'Mandible',
    maxilla:          'Maxilla',
    tooth:            'Tooth',
    mandibular_canal: 'Mandibular canal',
    maxillary_sinus:  'Maxillary sinus',
  };
  return map[cls] ?? cls;
}

// ── Colour tokens ─────────────────────────────────────────────────────────────

const C = {
  bg:           '#0f172a',
  surface:      '#1e293b',
  border:       '#334155',
  text:         '#e2e8f0',
  textMuted:    '#94a3b8',
  textDim:      '#64748b',

  demoBadgeBg:  '#f59e0b',
  demoBadgeFg:  '#0f172a',

  uncLow:    '#10b981',
  uncMed:    '#f59e0b',
  uncHigh:   '#ef4444',

  stateUnreviewed: '#64748b',
  stateAccepted:   '#10b981',
  stateRejected:   '#ef4444',
  stateEdited:     '#6366f1',

  btnPrimary:  '#2563eb',
  btnDanger:   '#dc2626',
  btnNeutral:  '#334155',
} as const;

// ── Small style helpers ───────────────────────────────────────────────────────

const pill = (bg: string): React.CSSProperties => ({
  display:      'inline-block',
  padding:      '1px 6px',
  borderRadius: 99,
  fontSize:     10,
  fontWeight:   700,
  background:   bg,
  color:        '#fff',
  lineHeight:   '16px',
});

const btn = (bg: string, disabled = false): React.CSSProperties => ({
  padding:      '4px 10px',
  fontSize:     11,
  background:   disabled ? C.btnNeutral : bg,
  color:        '#fff',
  border:       'none',
  borderRadius: 4,
  cursor:       disabled ? 'default' : 'pointer',
  opacity:      disabled ? 0.5 : 1,
  transition:   'opacity 0.15s',
});

// ── Measurement helper ────────────────────────────────────────────────────────

function measurementText(f: AiFinding): string | null {
  const m = f.measurement;
  if (!m) return null;
  const parts: string[] = [];
  if (m.area_mm2   != null) parts.push(`${m.area_mm2} mm²`);
  if (m.volume_mm3 != null) parts.push(`${m.volume_mm3} mm³`);
  if (m.distance_mm != null) parts.push(`${m.distance_mm} mm`);
  if (m.canal_distance_mm != null) parts.push(`canal dist. ${m.canal_distance_mm} mm`);
  if (m.tooth_number != null) parts.push(`tooth ${m.tooth_number}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner(): JSX.Element {
  return (
    <span
      style={{
        display:      'inline-block',
        width:        14,
        height:       14,
        border:       `2px solid ${C.border}`,
        borderTopColor: C.btnPrimary,
        borderRadius: '50%',
        animation:    'spin 0.8s linear infinite',
        flexShrink:   0,
      }}
    />
  );
}

interface UncertaintyPillProps { level: UncertaintyLevel }
function UncertaintyPill({ level }: UncertaintyPillProps): JSX.Element {
  const bg =
    level === 'low'    ? C.uncLow  :
    level === 'medium' ? C.uncMed  :
                         C.uncHigh;
  return <span style={pill(bg)}>{level}</span>;
}

interface ReviewerBadgeProps { state: ReviewerState }
function ReviewerBadge({ state }: ReviewerBadgeProps): JSX.Element {
  const bg =
    state === 'accepted' ? C.stateAccepted :
    state === 'rejected' ? C.stateRejected :
    state === 'edited'   ? C.stateEdited   :
                           C.stateUnreviewed;
  return <span style={pill(bg)}>{state}</span>;
}

interface ConfidenceBarProps { confidence: number }
function ConfidenceBar({ confidence }: ConfidenceBarProps): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          flex:        1,
          height:      6,
          background:  C.border,
          borderRadius: 3,
          overflow:    'hidden',
        }}
      >
        <div
          style={{
            width:       `${Math.round(confidence * 100)}%`,
            height:      '100%',
            background:  C.btnPrimary,
            borderRadius: 3,
          }}
        />
      </div>
      <span style={{ fontSize: 10, color: C.textMuted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {confidence.toFixed(2)}
      </span>
    </div>
  );
}

interface FindingCardProps {
  finding: AiFinding;
  onReview: (findingId: string, state: ReviewerState) => void;
}

function FindingCard({ finding, onReview }: FindingCardProps): JSX.Element {
  const canReview = finding.reviewerState === 'unreviewed';
  const mText = measurementText(finding);

  return (
    <div
      style={{
        background:   C.surface,
        border:       `1px solid ${C.border}`,
        borderRadius: 6,
        padding:      '8px 10px',
        display:      'flex',
        flexDirection: 'column',
        gap:          5,
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text, flex: 1, minWidth: 0 }}>
          {findingLabel(finding.findingClass)}
        </span>
        {finding.isDemo && (
          <span
            style={{
              ...pill(C.demoBadgeBg),
              color:   C.demoBadgeFg,
              fontSize: 9,
            }}
          >
            DEMO
          </span>
        )}
      </div>

      {/* Confidence bar */}
      <ConfidenceBar confidence={finding.confidence} />

      {/* Uncertainty + reviewer state */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <UncertaintyPill level={finding.uncertainty} />
        <ReviewerBadge state={finding.reviewerState} />
      </div>

      {/* Measurement */}
      {mText && (
        <div style={{ fontSize: 11, color: C.textMuted }}>
          {mText}
        </div>
      )}

      {/* Action row */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button
          style={btn(C.stateAccepted, !canReview)}
          disabled={!canReview}
          onClick={() => canReview && onReview(finding.findingId, 'accepted')}
        >
          Accept
        </button>
        <button
          style={btn(C.stateRejected, !canReview)}
          disabled={!canReview}
          onClick={() => canReview && onReview(finding.findingId, 'rejected')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

interface SegmentationRowProps { seg: AiSegmentationMask }
function SegmentationRow({ seg }: SegmentationRowProps): JSX.Element {
  return (
    <div
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        padding:      '5px 8px',
        background:   C.surface,
        border:       `1px solid ${C.border}`,
        borderRadius: 5,
        flexWrap:     'wrap',
      }}
    >
      <span style={{ fontSize: 11, color: C.text, flex: 1, minWidth: 0 }}>
        {anatomyLabel(seg.anatomyClass)}
      </span>
      <span style={{ fontSize: 10, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
        {seg.confidence.toFixed(2)}
      </span>
      <UncertaintyPill level={seg.uncertainty} />
      {seg.isDemo && (
        <span style={{ ...pill(C.demoBadgeBg), color: C.demoBadgeFg, fontSize: 9 }}>DEMO</span>
      )}
    </div>
  );
}

// ── StudyInstanceUID detection ────────────────────────────────────────────────

/**
 * Attempt to read the active StudyInstanceUID from the OHIF viewport grid.
 * Mirrors the pattern used elsewhere in the extension: read the active
 * viewport → displaySet → StudyInstanceUID.
 *
 * Falls back to URL query param (`?StudyInstanceUIDs=...`) as a last resort.
 * Returns undefined when no study can be found; the panel shows an empty state.
 *
 * NOTE on `any`: OHIF v3 does not export public types for ServicesManager
 * across its workspaces; the `services.*` shape is treated as a runtime
 * boundary and accessed defensively via optional chaining + try/catch. A
 * thin local interface would lock us into one OHIF minor version, so we
 * accept the `any` here intentionally (project rule typescript.md allows
 * this only at type-guards / external-API boundaries).
 */
function detectStudyInstanceUID(servicesManager: any): string | undefined {
  try {
    const { viewportGridService, displaySetService } =
      servicesManager?.services ?? {};

    if (viewportGridService && displaySetService) {
      const gridState = viewportGridService.getState?.() as
        | {
            activeViewportId?: string;
            viewports?: Map<string, { displaySetInstanceUIDs?: string[] }>;
          }
        | undefined;

      const activeId = gridState?.activeViewportId;
      const viewports = gridState?.viewports;

      if (activeId && viewports) {
        const vp = viewports.get(activeId);
        const dsUID = vp?.displaySetInstanceUIDs?.[0];
        if (dsUID) {
          const ds = displaySetService.getDisplaySetByUID?.(dsUID);
          if (ds?.StudyInstanceUID) return ds.StudyInstanceUID as string;
        }
      }
    }
  } catch {
    // servicesManager not available in this context — fall through
  }

  // Fallback: URL query param (set by DentalFileManager on navigation)
  try {
    const params = new URLSearchParams(window.location.search);
    const uid = params.getAll('StudyInstanceUIDs')[0];
    if (uid) return uid;
  } catch {
    // window not available
  }

  return undefined;
}

// ── Main component ────────────────────────────────────────────────────────────

// `servicesManager: any` — see note above `detectStudyInstanceUID`.
export default function AiAssistPanel({
  servicesManager,
}: {
  servicesManager: any;
}): JSX.Element {
  const [studyInstanceUID, setStudyInstanceUID] = useState<string | undefined>(
    () => detectStudyInstanceUID(servicesManager)
  );
  const [manualUID, setManualUID] = useState('');
  const [showManual, setShowManual] = useState(false);

  const [job, setJob]         = useState<AiJob | undefined>(undefined);
  const [findings, setFindings]   = useState<AiFinding[]>([]);
  const [segs, setSegs]       = useState<AiSegmentationMask[]>([]);
  const [starting, setStarting] = useState(false);

  // ── Sync state from store ─────────────────────────────────────────────────

  const syncFromStore = useCallback(() => {
    if (!studyInstanceUID) return;
    setJob(findingsStore.getJob(studyInstanceUID));
    setFindings(findingsStore.getFindings(studyInstanceUID));
    setSegs(findingsStore.getSegmentations(studyInstanceUID));
  }, [studyInstanceUID]);

  useEffect(() => {
    syncFromStore();
    const unsubscribe = findingsStore.subscribe(syncFromStore);
    return unsubscribe;
  }, [syncFromStore]);

  // ── Listen to OHIF viewport changes ──────────────────────────────────────

  useEffect(() => {
    const { viewportGridService } = servicesManager?.services ?? {};
    if (!viewportGridService?.subscribe) return;

    // OHIF event name used by viewportGridService
    const VIEWPORT_GRID_STATE_CHANGED = 'VIEWPORT_GRID_STATE_CHANGED';
    let unsub: (() => void) | undefined;

    try {
      unsub = viewportGridService.subscribe(
        VIEWPORT_GRID_STATE_CHANGED,
        () => {
          const uid = detectStudyInstanceUID(servicesManager);
          if (uid) setStudyInstanceUID(uid);
        }
      );
    } catch {
      // Service may not support subscribe in this OHIF version — ignore
    }

    return () => {
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, [servicesManager]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    // Re-entry guard: refuse a second click while a job is in flight or
    // already present in the store. This closes the brief window between
    // `setStarting(true)` and the store-listener firing the next render.
    if (!studyInstanceUID || starting) return;
    if (findingsStore.getJob(studyInstanceUID)) return;

    setStarting(true);
    try {
      await inferenceClient.startAiAssistJob(studyInstanceUID);
      // Do NOT clear `starting` here. The job is now in the store, so
      // syncFromStore will replace this view with the queued/running
      // state and the start button vanishes. `starting` is cleared by
      // the effect below once `job` is observed.
    } catch (e) {
      console.warn('[AiAssistPanel] startAiAssistJob failed', e);
      setStarting(false); // re-enable on failure so the user can retry
    }
  }, [studyInstanceUID, starting]);

  // Once a job appears in store-derived state, drop the transitional `starting`
  // flag. Belt-and-braces against the queue→running transition arriving via
  // any code path other than `handleStart`.
  useEffect(() => {
    if (job) setStarting(false);
  }, [job]);

  const handleReview = useCallback(
    async (findingId: string, state: ReviewerState) => {
      try {
        await inferenceClient.reviewFinding(findingId, state);
      } catch (e) {
        console.warn('[AiAssistPanel] reviewFinding failed', e);
      }
    },
    []
  );

  const handleManualUID = useCallback(() => {
    const trimmed = manualUID.trim();
    if (trimmed) {
      setStudyInstanceUID(trimmed);
      setShowManual(false);
    }
  }, [manualUID]);

  // ── Render ────────────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    background:   C.bg,
    color:        C.text,
    fontFamily:   'system-ui, sans-serif',
    fontSize:     12,
    height:       '100%',
    overflowY:    'auto',
    display:      'flex',
    flexDirection: 'column',
    gap:          0,
  };

  const sectionStyle: React.CSSProperties = {
    padding:      '10px 12px',
    borderBottom: `1px solid ${C.border}`,
  };

  return (
    <div style={containerStyle}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>AI Assist</span>
        </div>

        {/* Research Preview badge — not removable per risk controls */}
        <div
          style={{
            background:   C.demoBadgeBg,
            color:        C.demoBadgeFg,
            borderRadius: 4,
            padding:      '4px 8px',
            fontSize:     10,
            fontWeight:   700,
            letterSpacing: '0.02em',
          }}
        >
          Research Preview · Demo Data · Not for Diagnosis
        </div>

        <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.4 }}>
          Suggestions require clinician confirmation.
        </div>
      </div>

      {/* ── Manual UID fallback (collapsible) ──────────────────────────── */}
      <div style={{ ...sectionStyle, paddingTop: 6, paddingBottom: 6 }}>
        {studyInstanceUID ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: C.textDim, wordBreak: 'break-all', flex: 1 }}>
              Study: <span style={{ color: C.textMuted }}>{studyInstanceUID}</span>
            </span>
            <button
              style={{ ...btn(C.btnNeutral), padding: '2px 6px', fontSize: 9 }}
              onClick={() => setShowManual(v => !v)}
            >
              change
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.textMuted }}>
            Open a study to see AI suggestions.
          </div>
        )}

        {(showManual || !studyInstanceUID) && (
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <input
              type="text"
              placeholder="StudyInstanceUID…"
              value={manualUID}
              onChange={e => setManualUID(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleManualUID(); }}
              style={{
                flex:         1,
                background:   C.surface,
                border:       `1px solid ${C.border}`,
                borderRadius: 4,
                color:        C.text,
                fontSize:     10,
                padding:      '4px 6px',
                fontFamily:   'monospace',
              }}
            />
            <button style={btn(C.btnPrimary)} onClick={handleManualUID}>
              Set
            </button>
          </div>
        )}
      </div>

      {/* ── Body: only when studyInstanceUID is set ─────────────────────── */}
      {studyInstanceUID && (
        <>
          {/* ── No job yet ──────────────────────────────────────────────── */}
          {!job && (
            <div style={{ ...sectionStyle }}>
              <button
                style={btn(C.btnPrimary, starting)}
                disabled={starting}
                onClick={handleStart}
              >
                {starting ? 'Starting…' : 'Start AI Assist (demo)'}
              </button>
            </div>
          )}

          {/* ── Queued / running ────────────────────────────────────────── */}
          {job && (job.status === 'queued' || job.status === 'running') && (
            <div style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner />
                <span style={{ color: C.textMuted, fontSize: 11 }}>
                  {job.status === 'queued' ? 'Queued…' : 'Running…'}
                </span>
              </div>
              <div
                style={{
                  height:      6,
                  background:  C.border,
                  borderRadius: 3,
                  overflow:    'hidden',
                }}
              >
                <div
                  style={{
                    width:      `${Math.round((job.progress ?? 0) * 100)}%`,
                    height:     '100%',
                    background: C.btnPrimary,
                    borderRadius: 3,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Failed ──────────────────────────────────────────────────── */}
          {job?.status === 'failed' && (
            <div style={{ ...sectionStyle }}>
              <div
                style={{
                  background:   '#450a0a',
                  border:       `1px solid ${C.uncHigh}`,
                  borderRadius: 5,
                  padding:      '8px 10px',
                  color:        '#fca5a5',
                  fontSize:     11,
                  marginBottom: 8,
                }}
              >
                AI Assist job failed.
                {job.error ? ` ${job.error}` : ''}
              </div>
              <button
                style={btn(C.btnPrimary)}
                onClick={handleStart}
              >
                Retry
              </button>
            </div>
          )}

          {/* ── review_required / completed ─────────────────────────────── */}
          {job && (job.status === 'review_required' || job.status === 'completed') && (
            <>
              {/* Findings */}
              <div style={{ padding: '8px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Suggested Findings
                </span>
                <span style={{ fontSize: 10, color: C.textDim }}>{findings.length}</span>
              </div>

              {findings.length === 0 ? (
                <div style={{ padding: '6px 12px 10px', color: C.textDim, fontSize: 11 }}>
                  No suggested findings.
                </div>
              ) : (
                <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {findings.map(f => (
                    <FindingCard key={f.findingId} finding={f} onReview={handleReview} />
                  ))}
                </div>
              )}

              {/* Segmentations */}
              {segs.length > 0 && (
                <>
                  <div style={{ padding: '8px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Anatomy Segmentations
                    </span>
                    <span style={{ fontSize: 10, color: C.textDim }}>{segs.length}</span>
                  </div>
                  <div style={{ padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {segs.map(s => (
                      <SegmentationRow key={s.segmentationId} seg={s} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
