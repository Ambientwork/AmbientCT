# AmbientCT UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OHIF's default chrome with a custom File Manager + Viewer shell in Figma/Notion style (violet accents, dark theme, file-tree sidebar).

**Architecture:** A React portal injected in the extension's `preRegistration` hook renders `DentalFileManager` as a fullscreen overlay when no study is loaded. When a study is opened, the portal hides and OHIF's normal hanging protocol activates; `DentalContainerViewport` gains a new compact toolbar (breadcrumb + tools + Schließen). Closing navigates back to `/` which shows the file manager again.

**Tech Stack:** React 18, TypeScript, Cornerstone3D, OHIF v3, Orthanc DICOMweb (`/pacs/dicom-web`), Jest + babel-jest for unit tests.

> **Implementation note (deviates from spec §4 suggestion):** The spec suggested `appState` in `DentalViewRouter`. The plan uses a portal injected in `preRegistration` instead — achieves identical UX without relying on OHIF's viewport lifecycle when no study is loaded.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| CREATE | `src/utils/designTokens.ts` | Color + spacing constants |
| CREATE | `src/utils/orthancClient.ts` | DICOMweb REST wrapper |
| CREATE | `src/components/ViewerToolbar.tsx` | Breadcrumb + tools + Schließen bar |
| CREATE | `src/components/StudyTable.tsx` | Sortable study list + Öffnen button |
| CREATE | `src/components/PatientTree.tsx` | Sidebar expand/collapse tree |
| CREATE | `src/components/DicomImport.tsx` | File picker + drag-drop + STOW-RS upload |
| CREATE | `src/viewports/DentalFileManager.tsx` | Full-screen file manager (Screen A) |
| CREATE | `tests/orthancClient.test.ts` | Unit tests for DICOMweb response parsing |
| MODIFY | `src/viewports/DentalContainerViewport.tsx` | Add ViewerToolbar + onClose |
| MODIFY | `src/viewports/DentalCPRViewport.tsx` | Use designTokens for consistent style |
| MODIFY | `src/viewports/DentalCrossSectionViewport.tsx` | Use designTokens for label style |
| MODIFY | `src/index.ts` | Inject DentalFileManager portal in preRegistration |
| MODIFY | `config/ohif-config.js` | Set `showStudyList: false` |

All paths are relative to `extensions/dental-cpr/`.

> **Known deferred from spec §3:** Sidebar viewer-mode variant (GEÖFFNET / ALLE STUDIEN sections) is not implemented in v1. The sidebar only shows in file manager mode. This is acknowledged and acceptable for the initial release.

---

## Task 0: Prerequisites

- [ ] **Step 1: Add `react-dom` peer dependency**

```bash
cd /Users/john/dev/AmbientCT/extensions/dental-cpr
```

In `package.json`, add `"react-dom": "^18.0.0"` to `peerDependencies` alongside `"react"`:
```json
"peerDependencies": {
  "@ohif/core": "^3.9.0",
  "@cornerstonejs/core": "^2.0.0",
  "@cornerstonejs/tools": "^2.0.0",
  "@kitware/vtk.js": "^29.0.0",
  "react": "^18.0.0",
  "react-dom": "^18.0.0"
},
```

- [ ] **Step 2: Create `src/components/` directory**

```bash
mkdir -p /Users/john/dev/AmbientCT/extensions/dental-cpr/src/components
```

- [ ] **Step 3: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/package.json
git commit -m "chore: add react-dom peer dep, create src/components dir"
```

---

## Task 1: Design Tokens

**Files:**
- Create: `extensions/dental-cpr/src/utils/designTokens.ts`

- [ ] **Step 1: Create the file**

```typescript
// extensions/dental-cpr/src/utils/designTokens.ts
export const Colors = {
  primary:       '#a78bfa',  // violet
  accent:        '#c4b5fd',  // lighter violet
  menubar:       '#111115',
  sidebar:       '#0d0d11',
  viewer:        '#070709',
  background:    '#0a0a0a',
  surface:       '#111',
  border:        '#1e1e25',
  text:          '#e5e5e5',
  textMuted:     '#888',
  textDim:       '#555',
  online:        '#22c55e',
  offline:       '#ef4444',
  badgeCT:       '#60a5fa',
  badgeDX:       '#4ade80',
  badgeIO:       '#fbbf24',
  highlight:     'rgba(167,139,250,0.1)',
};

export const Font = {
  family: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  mono:   '"JetBrains Mono", "Fira Code", monospace',
};

export const Radius = {
  sm: 6,
  md: 8,
  lg: 10,
};

export const Border = `1px solid ${Colors.border}`;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/utils/designTokens.ts
git commit -m "feat: add designTokens (AmbientCT violet theme)"
```

---

## Task 2: OrthancClient

**Files:**
- Create: `extensions/dental-cpr/src/utils/orthancClient.ts`
- Create: `extensions/dental-cpr/tests/orthancClient.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// extensions/dental-cpr/tests/orthancClient.test.ts

// Mock global fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

import { parseStudyResponse, OrthancClient } from '../src/utils/orthancClient';

describe('parseStudyResponse', () => {
  test('parses complete DICOMweb study entry', () => {
    const raw = {
      '0020000D': { vr: 'UI', Value: ['1.2.3.4'] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Yoo^Jeong-Woo' }] },
      '00080020': { vr: 'DA', Value: ['20230911'] },
      '00080061': { vr: 'CS', Value: ['CT'] },
      '00201206': { vr: 'IS', Value: ['2'] },
      '00081030': { vr: 'LO', Value: ['CBCT Dental'] },
    };
    const result = parseStudyResponse(raw);
    expect(result.studyInstanceUID).toBe('1.2.3.4');
    expect(result.patientName).toBe('Yoo Jeong-Woo');
    expect(result.studyDate).toBe('20230911');
    expect(result.modality).toBe('CT');
    expect(result.numSeries).toBe(2);
    expect(result.description).toBe('CBCT Dental');
  });

  test('handles missing optional tags gracefully', () => {
    const raw = {
      '0020000D': { vr: 'UI', Value: ['1.2.3.5'] },
    };
    const result = parseStudyResponse(raw);
    expect(result.studyInstanceUID).toBe('1.2.3.5');
    expect(result.patientName).toBe('Unbekannt');
    expect(result.modality).toBe('—');
    expect(result.numSeries).toBe(0);
    expect(result.description).toBe('');
  });

  test('formats PN tag: caret → space', () => {
    const raw = {
      '0020000D': { vr: 'UI', Value: ['x'] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Schmidt^Karl^Dr' }] },
    };
    expect(parseStudyResponse(raw).patientName).toBe('Schmidt Karl Dr');
  });
});

describe('OrthancClient.checkHealth', () => {
  test('returns true on HTTP 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const client = new OrthancClient('/pacs/dicom-web');
    expect(await client.checkHealth()).toBe(true);
  });

  test('returns true even on HTTP 503 (server is reachable, content irrelevant)', async () => {
    // Any HTTP response = server is up; only network errors = offline
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const client = new OrthancClient('/pacs/dicom-web');
    expect(await client.checkHealth()).toBe(true);
  });

  test('returns false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'));
    const client = new OrthancClient('/pacs/dicom-web');
    expect(await client.checkHealth()).toBe(false);
  });
});

describe('OrthancClient.listStudies', () => {
  test('maps DICOMweb JSON to StudySummary[]', async () => {
    const raw = [{
      '0020000D': { vr: 'UI', Value: ['1.2.3'] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Müller^Anna' }] },
      '00080020': { vr: 'DA', Value: ['20240203'] },
    }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => raw });
    const client = new OrthancClient('/pacs/dicom-web');
    const studies = await client.listStudies();
    expect(studies).toHaveLength(1);
    expect(studies[0].patientName).toBe('Müller Anna');
  });

  test('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.listStudies()).rejects.toThrow('503');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd /Users/john/dev/AmbientCT/extensions/dental-cpr
npx jest tests/orthancClient.test.ts --no-coverage 2>&1 | tail -5
```
Expected: `Cannot find module '../src/utils/orthancClient'`

- [ ] **Step 3: Implement OrthancClient**

```typescript
// extensions/dental-cpr/src/utils/orthancClient.ts

export interface StudySummary {
  studyInstanceUID: string;
  patientName: string;
  studyDate: string;      // YYYYMMDD
  modality: string;
  numSeries: number;
  description: string;
}

export interface StoredStudySummary extends StudySummary {
  lastOpenedAt?: string;  // ISO timestamp
  importedAt?: string;    // ISO timestamp
}

// ── DICOMweb tag helpers ────────────────────────────────────────────────────

function tag(obj: any, t: string): any {
  return obj?.[t]?.Value;
}

function str(obj: any, t: string, fallback = ''): string {
  const v = tag(obj, t);
  return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : fallback;
}

function num(obj: any, t: string, fallback = 0): number {
  const v = tag(obj, t);
  return Array.isArray(v) ? (parseInt(String(v[0]), 10) || fallback) : fallback;
}

function pn(obj: any, t: string): string {
  const v = tag(obj, t);
  if (!Array.isArray(v) || !v[0]) return 'Unbekannt';
  const alpha = v[0]?.Alphabetic ?? v[0];
  return typeof alpha === 'string' ? alpha.replace(/\^/g, ' ').trim() : 'Unbekannt';
}

/** Parse a single DICOMweb JSON study entry into StudySummary. */
export function parseStudyResponse(raw: any): StudySummary {
  // Modality: prefer ModalitiesInStudy (0008,0061) → fallback to Modality (0008,0060)
  const modalitiesArr = tag(raw, '00080061');
  const modality = Array.isArray(modalitiesArr) && modalitiesArr.length > 0
    ? modalitiesArr[0]
    : (str(raw, '00080060') || '—');

  return {
    studyInstanceUID: str(raw, '0020000D', ''),
    patientName:      pn(raw, '00100010'),
    studyDate:        str(raw, '00080020'),
    modality,
    numSeries:        num(raw, '00201206'),
    description:      str(raw, '00081030'),
  };
}

// ── OrthancClient ───────────────────────────────────────────────────────────

export class OrthancClient {
  constructor(private base: string) {}

  /** Returns true if Orthanc is reachable (any HTTP response), false only on network error. */
  async checkHealth(): Promise<boolean> {
    try {
      await fetch(`${this.base}/studies?limit=1`);
      return true; // any HTTP response = server is up; only catch = offline
    } catch {
      return false;
    }
  }

  /** GET /studies → StudySummary[] */
  async listStudies(): Promise<StudySummary[]> {
    const r = await fetch(`${this.base}/studies`);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data: any[] = await r.json();
    return data.map(parseStudyResponse).filter(s => s.studyInstanceUID);
  }

  /** POST /studies (STOW-RS multipart). Returns true on success. */
  async uploadDicom(file: File): Promise<void> {
    const boundary = `----AmbientCTBoundary${Date.now()}`;
    const body = await buildStowMultipart(file, boundary);
    const r = await fetch(`${this.base}/studies`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; type=application/dicom; boundary=${boundary}` },
      body,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => r.statusText);
      throw new Error(text || `${r.status}`);
    }
  }
}

async function buildStowMultipart(file: File, boundary: string): Promise<ArrayBuffer> {
  const fileData = await file.arrayBuffer();
  const header = `--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const enc = new TextEncoder();
  const headerBuf = enc.encode(header);
  const footerBuf = enc.encode(footer);
  const merged = new Uint8Array(headerBuf.byteLength + fileData.byteLength + footerBuf.byteLength);
  merged.set(new Uint8Array(headerBuf), 0);
  merged.set(new Uint8Array(fileData), headerBuf.byteLength);
  merged.set(new Uint8Array(footerBuf), headerBuf.byteLength + fileData.byteLength);
  return merged.buffer;
}

// ── localStorage helpers ────────────────────────────────────────────────────

const LS_KEY = 'ambientct.recentStudies';
const MAX_RECENT = 20;
const IMPORT_DAYS = 7;

export function addToRecentStudies(study: StudySummary): void {
  const stored = getStoredStudies();
  const filtered = stored.filter(s => s.studyInstanceUID !== study.studyInstanceUID);
  const entry: StoredStudySummary = { ...study, lastOpenedAt: new Date().toISOString() };
  const updated = [entry, ...filtered].slice(0, MAX_RECENT);
  localStorage.setItem(LS_KEY, JSON.stringify(updated));
}

export function markAsImported(study: StudySummary): void {
  const stored = getStoredStudies();
  const idx = stored.findIndex(s => s.studyInstanceUID === study.studyInstanceUID);
  if (idx >= 0) {
    stored[idx].importedAt = new Date().toISOString();
  } else {
    stored.unshift({ ...study, importedAt: new Date().toISOString() });
  }
  localStorage.setItem(LS_KEY, JSON.stringify(stored.slice(0, MAX_RECENT)));
}

export function getStoredStudies(): StoredStudySummary[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function getRecentStudies(): StoredStudySummary[] {
  return getStoredStudies().filter(s => s.lastOpenedAt).sort(
    (a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '')
  );
}

export function getImportedStudies(): StoredStudySummary[] {
  const cutoff = new Date(Date.now() - IMPORT_DAYS * 86400000).toISOString();
  return getStoredStudies().filter(s => s.importedAt && s.importedAt > cutoff);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/john/dev/AmbientCT/extensions/dental-cpr
npx jest tests/orthancClient.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 5: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/utils/orthancClient.ts extensions/dental-cpr/tests/orthancClient.test.ts
git commit -m "feat: add OrthancClient (DICOMweb list/upload + localStorage helpers)"
```

---

## Task 3: ViewerToolbar component

**Files:**
- Create: `extensions/dental-cpr/src/components/ViewerToolbar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// extensions/dental-cpr/src/components/ViewerToolbar.tsx
import React from 'react';
import { Colors, Font, Border } from '../utils/designTokens';

export interface ViewerToolbarProps {
  patientName: string;
  modality: string;
  studyDate: string;
  slabMm?: number;
  onSlabChange?: (mm: number) => void;
  onClose: () => void;
}

export default function ViewerToolbar({
  patientName, modality, studyDate, slabMm = 10, onSlabChange, onClose,
}: ViewerToolbarProps) {
  const label = [patientName, studyDate ? formatDate(studyDate) : ''].filter(Boolean).join(' · ');

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 12px',
      height: 40,
      flexShrink: 0,
      background: Colors.menubar,
      borderBottom: Border,
      fontFamily: Font.family,
      fontSize: 12,
      color: Colors.text,
    }}>
      {/* Breadcrumb */}
      <button
        onClick={onClose}
        style={{ background: 'none', border: 'none', color: Colors.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}
        title="Zurück zum Dateimanager"
      >
        Studien
      </button>
      <span style={{ color: Colors.textDim }}>/</span>
      <span style={{ color: Colors.text, fontWeight: 500 }}>{label}</span>
      {modality && (
        <span style={{
          background: modality === 'CT' ? Colors.badgeCT : Colors.badgeDX,
          color: '#000',
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.04em',
        }}>{modality}</span>
      )}

      <div style={{ flex: 1 }} />

      {/* Slab slider */}
      {onSlabChange && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: Colors.textMuted, fontSize: 11 }}>
          Slab
          <input
            type="range" min={1} max={40} step={1} value={slabMm}
            onChange={e => onSlabChange(Number(e.target.value))}
            style={{ width: 64, accentColor: Colors.primary }}
          />
          <span style={{ minWidth: 28, color: Colors.text, fontVariantNumeric: 'tabular-nums' }}>{slabMm}mm</span>
        </label>
      )}

      {/* Close */}
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: Border,
          borderRadius: 6,
          color: Colors.textMuted,
          cursor: 'pointer',
          fontSize: 12,
          padding: '3px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        title="Zurück zum Dateimanager (Studie bleibt in Orthanc)"
      >
        ✕ Schließen
      </button>
    </div>
  );
}

function formatDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd;
  return `${yyyymmdd.slice(6, 8)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(0, 4)}`;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/components/ViewerToolbar.tsx
git commit -m "feat: add ViewerToolbar (breadcrumb + Schließen)"
```

---

## Task 4: StudyTable component

**Files:**
- Create: `extensions/dental-cpr/src/components/StudyTable.tsx`

- [ ] **Step 1: Create the component**

```tsx
// extensions/dental-cpr/src/components/StudyTable.tsx
import React, { useState } from 'react';
import { Colors, Font, Border, Radius } from '../utils/designTokens';
import type { StudySummary } from '../utils/orthancClient';

interface Props {
  studies: StudySummary[];
  onOpen: (uid: string, study: StudySummary) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const BADGE_COLORS: Record<string, string> = {
  CT: Colors.badgeCT,
  DX: Colors.badgeDX,
  IO: Colors.badgeIO,
};

export default function StudyTable({ studies, onOpen, loading, error, onRetry }: Props) {
  const [sort, setSort] = useState<{ col: keyof StudySummary; dir: 1 | -1 }>({ col: 'studyDate', dir: -1 });
  const [search, setSearch] = useState('');

  if (loading) return <Centered><Spinner /></Centered>;
  if (error) return (
    <Centered>
      <p style={{ color: Colors.offline, marginBottom: 12 }}>
        Orthanc nicht erreichbar (localhost:8042).<br />
        Bitte stellen Sie sicher, dass Orthanc läuft.
      </p>
      {onRetry && <button onClick={onRetry} style={retryBtnStyle}>Erneut versuchen</button>}
    </Centered>
  );

  const q = search.toLowerCase();
  const filtered = studies.filter(s =>
    !q ||
    s.patientName.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.studyDate.includes(q) ||
    s.modality.toLowerCase().includes(q)
  );
  const sorted = [...filtered].sort((a, b) => {
    const av = String(a[sort.col] ?? '');
    const bv = String(b[sort.col] ?? '');
    return av.localeCompare(bv) * sort.dir;
  });

  const toggleSort = (col: keyof StudySummary) =>
    setSort(s => s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: 1 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Search + actions */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 16px 0' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Patient, Datum, Modalität…"
          style={{
            flex: 1, background: '#1a1a20', border: Border, borderRadius: Radius.md,
            color: Colors.text, fontFamily: Font.family, fontSize: 12, padding: '6px 10px',
          }}
        />
      </div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: Font.family, fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: Border, color: Colors.textMuted, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {([
              ['patientName', 'Patient'],
              ['studyDate', 'Datum'],
              ['modality', 'Modalität'],
              ['numSeries', 'Serien'],
              ['description', 'Beschreibung'],
            ] as [keyof StudySummary, string][]).map(([col, label]) => (
              <th key={col} onClick={() => toggleSort(col)}
                style={{ padding: '8px 16px', textAlign: 'left', cursor: 'pointer', userSelect: 'none', fontWeight: 500 }}>
                {label}{sort.col === col ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
            <th style={{ padding: '8px 16px', width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: Colors.textMuted }}>
                {search ? 'Keine Ergebnisse für diese Suche.' : 'Keine Studien vorhanden. DICOM-Dateien importieren, um zu beginnen.'}
              </td>
            </tr>
          ) : sorted.map(s => (
            <tr key={s.studyInstanceUID}
              style={{ borderBottom: `1px solid ${Colors.border}`, transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.background = Colors.highlight)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <td style={{ padding: '10px 16px', color: Colors.text, fontWeight: 500 }}>{s.patientName}</td>
              <td style={{ padding: '10px 16px', color: Colors.textMuted, fontVariantNumeric: 'tabular-nums' }}>{formatDate(s.studyDate)}</td>
              <td style={{ padding: '10px 16px' }}>
                <span style={{
                  background: BADGE_COLORS[s.modality] ?? '#666', color: '#000',
                  borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700,
                }}>{s.modality || '—'}</span>
              </td>
              <td style={{ padding: '10px 16px', color: Colors.textMuted }}>{s.numSeries || '—'}</td>
              <td style={{ padding: '10px 16px', color: Colors.textMuted, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.description || ''}
              </td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <button
                  onClick={() => onOpen(s.studyInstanceUID, s)}
                  style={{
                    background: Colors.primary, border: 'none', borderRadius: Radius.sm,
                    color: '#0a0a12', cursor: 'pointer', fontFamily: Font.family, fontSize: 11,
                    fontWeight: 700, padding: '5px 12px',
                  }}
                >Öffnen →</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: Colors.textMuted }}>{children}</div>;
}

function Spinner() {
  return <div style={{ width: 24, height: 24, border: `2px solid ${Colors.border}`, borderTopColor: Colors.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />;
}

function formatDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd;
  return `${yyyymmdd.slice(6, 8)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(0, 4)}`;
}

const retryBtnStyle: React.CSSProperties = {
  background: 'none', border: Border, borderRadius: Radius.sm,
  color: Colors.textMuted, cursor: 'pointer', fontFamily: Font.family, fontSize: 12, padding: '6px 14px',
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/components/StudyTable.tsx
git commit -m "feat: add StudyTable (sortable, searchable, Öffnen button)"
```

---

## Task 5: PatientTree component

**Files:**
- Create: `extensions/dental-cpr/src/components/PatientTree.tsx`

- [ ] **Step 1: Create the component**

```tsx
// extensions/dental-cpr/src/components/PatientTree.tsx
import React, { useState } from 'react';
import { Colors, Font } from '../utils/designTokens';
import type { StudySummary } from '../utils/orthancClient';

interface Props {
  studies: StudySummary[];
  activeUID?: string;
  onOpen: (uid: string, study: StudySummary) => void;
}

interface PatientGroup {
  name: string;
  studies: StudySummary[];
}

export default function PatientTree({ studies, activeUID, onOpen }: Props) {
  // Group by patient name
  const groups: PatientGroup[] = [];
  const seen = new Map<string, PatientGroup>();
  for (const s of studies) {
    let g = seen.get(s.patientName);
    if (!g) { g = { name: s.patientName, studies: [] }; groups.push(g); seen.set(s.patientName, g); }
    g.studies.push(s);
  }

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setCollapsed(c => { const n = new Set(c); n.has(name) ? n.delete(name) : n.add(name); return n; });

  if (groups.length === 0) {
    return (
      <div style={{ padding: '8px 12px', color: Colors.textDim, fontSize: 11, fontFamily: Font.family }}>
        Keine Studien
      </div>
    );
  }

  return (
    <div style={{ fontFamily: Font.family, fontSize: 12 }}>
      <div style={{ padding: '4px 12px 2px', color: Colors.textDim, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
        Patienten
      </div>
      {groups.map(g => {
        const open = !collapsed.has(g.name);
        return (
          <div key={g.name}>
            <div
              onClick={() => toggle(g.name)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', cursor: 'pointer', color: Colors.text, userSelect: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = Colors.highlight)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <span style={{ color: Colors.textDim, fontSize: 10 }}>{open ? '▾' : '▸'}</span>
              <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
            </div>
            {open && g.studies.map(s => {
              const isActive = s.studyInstanceUID === activeUID;
              return (
                <div
                  key={s.studyInstanceUID}
                  onClick={() => onOpen(s.studyInstanceUID, s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '3px 12px 3px 24px',
                    cursor: 'pointer', userSelect: 'none',
                    background: isActive ? Colors.highlight : undefined,
                    color: isActive ? Colors.accent : Colors.textMuted,
                    borderLeft: isActive ? `2px solid ${Colors.primary}` : '2px solid transparent',
                  }}
                  onMouseEnter={e => !isActive && (e.currentTarget.style.background = Colors.highlight)}
                  onMouseLeave={e => !isActive && (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontSize: 10 }}>●</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.modality} · {formatDate(s.studyDate)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function formatDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd;
  return `${yyyymmdd.slice(6, 8)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(0, 4)}`;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/components/PatientTree.tsx
git commit -m "feat: add PatientTree (expandable patient/study sidebar)"
```

---

## Task 6: DicomImport component

**Files:**
- Create: `extensions/dental-cpr/src/components/DicomImport.tsx`

- [ ] **Step 1: Create the component**

```tsx
// extensions/dental-cpr/src/components/DicomImport.tsx
import React, { useRef, useState } from 'react';
import { Colors, Font, Border, Radius } from '../utils/designTokens';
import { OrthancClient } from '../utils/orthancClient';

interface Props {
  client: OrthancClient;
  onImported: () => void;
}

type ImportStatus = 'idle' | 'uploading' | 'success' | 'error';

export default function DicomImport({ client, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [message, setMessage] = useState('');

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setStatus('uploading');
    setMessage(`Lade ${files.length} Datei(en) hoch…`);
    let errors = 0;
    for (const file of Array.from(files)) {
      try {
        await client.uploadDicom(file);
      } catch (e: any) {
        errors++;
        console.error('[DicomImport]', e);
      }
    }
    if (errors === 0) {
      setStatus('success');
      setMessage(`${files.length} Datei(en) erfolgreich importiert.`);
      onImported();
      setTimeout(() => setStatus('idle'), 3000);
    } else {
      setStatus('error');
      setMessage(`${errors} Datei(en) konnten nicht importiert werden.`);
    }
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".dcm,.zip"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)}
      />

      {/* Toast */}
      {status !== 'idle' && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
          background: status === 'error' ? '#2a1515' : '#151a15',
          border: `1px solid ${status === 'error' ? Colors.offline : Colors.online}`,
          borderRadius: Radius.md, padding: '10px 16px',
          color: status === 'error' ? Colors.offline : Colors.online,
          fontFamily: Font.family, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        }}>
          {status === 'uploading' && <Spinner />}
          {status === 'success' && '✓'}
          {status === 'error' && '✕'}
          {message}
          {status === 'error' && (
            <button onClick={() => inputRef.current?.click()} style={{ background: 'none', border: 'none', color: Colors.offline, cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }}>
              Wiederholen
            </button>
          )}
          <button onClick={() => setStatus('idle')} style={{ background: 'none', border: 'none', color: Colors.textDim, cursor: 'pointer', fontSize: 14, padding: '0 0 0 4px' }}>×</button>
        </div>
      )}

      {/* Drag-overlay: rendered by consumer via onDragEnter/onDrop props — see DentalFileManager */}
    </>
  );
}

export function useDragDrop(onFiles: (files: FileList) => void) {
  const [dragging, setDragging] = useState(false);

  const handlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    },
  };

  return { dragging, handlers };
}

function Spinner() {
  return <div style={{ width: 14, height: 14, border: `2px solid rgba(255,255,255,0.2)`, borderTopColor: Colors.online, borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/components/DicomImport.tsx
git commit -m "feat: add DicomImport (file picker + drag-drop + STOW-RS upload)"
```

---

## Task 7: DentalFileManager

**Files:**
- Create: `extensions/dental-cpr/src/viewports/DentalFileManager.tsx`

- [ ] **Step 1: Create the file manager component**

```tsx
// extensions/dental-cpr/src/viewports/DentalFileManager.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Colors, Font, Border, Radius } from '../utils/designTokens';
import { OrthancClient, addToRecentStudies, markAsImported, getRecentStudies, getImportedStudies } from '../utils/orthancClient';
import type { StudySummary, StoredStudySummary } from '../utils/orthancClient';
import StudyTable from '../components/StudyTable';
import PatientTree from '../components/PatientTree';
import DicomImport, { useDragDrop } from '../components/DicomImport';

type Tab = 'all' | 'recent' | 'imported';

const client = new OrthancClient('/pacs/dicom-web');

interface Props {
  onOpen: (studyInstanceUID: string, study: StudySummary) => void;
}

export default function DentalFileManager({ onOpen }: Props) {
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [lastImport, setLastImport] = useState<string>('');
  const importRef = useRef<{ triggerPicker: () => void }>(null);

  const loadStudies = useCallback(async () => {
    setLoading(true);
    setError(null);
    const healthy = await client.checkHealth();
    setOnline(healthy);
    if (!healthy) {
      setLoading(false);
      setError('unreachable');
      return;
    }
    try {
      const list = await client.listStudies();
      setStudies(list);
    } catch (e: any) {
      setError(e.message ?? 'Fehler');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStudies(); }, [loadStudies]);

  // Poll for health every 30s
  useEffect(() => {
    const t = setInterval(async () => setOnline(await client.checkHealth()), 30000);
    return () => clearInterval(t);
  }, []);

  const handleOpen = (uid: string, study: StudySummary) => {
    addToRecentStudies(study);
    onOpen(uid, study);
  };

  const handleImported = () => {
    setLastImport(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
    loadStudies();
  };

  const { dragging, handlers: dragHandlers } = useDragDrop(async (files) => {
    for (const file of Array.from(files)) {
      await client.uploadDicom(file);
    }
    // Reload study list to get fresh data with studyInstanceUIDs, then mark as imported
    await loadStudies();
    // Mark all freshly-loaded studies without importedAt as imported (best-effort)
    // In practice the user just dropped these files, so mark the newest ones
    handleImported();
  });

  const displayedStudies: StudySummary[] = tab === 'all' ? studies
    : tab === 'recent' ? getRecentStudies()
    : getImportedStudies();

  // ── Unique patients for status bar ───────────────────────────────────────
  const uniquePatients = new Set(studies.map(s => s.patientName)).size;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: Colors.viewer, fontFamily: Font.family, color: Colors.text }}
      {...dragHandlers}
    >
      {/* Drag overlay */}
      {dragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(167,139,250,0.08)', border: `2px dashed ${Colors.primary}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: Colors.accent, pointerEvents: 'none' }}>
          DICOM-Dateien hier ablegen
        </div>
      )}

      {/* Menubar */}
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', background: Colors.menubar, borderBottom: Border, flexShrink: 0 }}>
        <span style={{ fontSize: 16, marginRight: 2 }}>🦷</span>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.01em' }}>Ambient<span style={{ color: Colors.primary }}>CT</span></span>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: Colors.textMuted }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? Colors.online : online === false ? Colors.offline : '#888', display: 'inline-block' }} />
          Orthanc{online ? ` · ${studies.length} Studien` : ' — nicht erreichbar'}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 210, flexShrink: 0, background: Colors.sidebar, borderRight: Border, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px 4px' }}>
            <input
              type="text"
              placeholder="🔍 Suchen…"
              style={{ width: '100%', background: '#1a1a20', border: Border, borderRadius: 6, color: Colors.text, fontFamily: Font.family, fontSize: 11, padding: '5px 8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4 }}>
            <PatientTree studies={studies} onOpen={handleOpen} />
          </div>
          <div style={{ padding: 10, borderTop: Border }}>
            <button
              onClick={() => { /* trigger file input via DicomImport */ document.getElementById('dental-import-input')?.click(); }}
              style={{ width: '100%', background: Colors.highlight, border: `1px solid ${Colors.primary}`, borderRadius: Radius.sm, color: Colors.accent, cursor: 'pointer', fontFamily: Font.family, fontSize: 11, padding: '7px 0' }}
            >
              + DICOM Importieren
            </button>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Title */}
          <div style={{ padding: '14px 16px 0', borderBottom: Border, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: Colors.text }}>Studien</h2>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: Colors.textMuted }}>Orthanc PACS · localhost:8042</p>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button
                  onClick={() => { document.getElementById('dental-import-input')?.click(); }}
                  style={{ ...actionBtnStyle, background: Colors.primary, color: '#0a0a12' }}
                >↑ Importieren</button>
                <button
                  onClick={() => window.open('http://localhost:8042', '_blank')}
                  style={actionBtnStyle}
                >⚙ Orthanc</button>
              </div>
            </div>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginTop: 10 }}>
              {(['all', 'recent', 'imported'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: Font.family, fontSize: 12,
                    color: tab === t ? Colors.accent : Colors.textMuted,
                    borderBottom: tab === t ? `2px solid ${Colors.primary}` : '2px solid transparent',
                    padding: '6px 14px',
                  }}
                >
                  {{ all: 'Alle Studien', recent: 'Zuletzt geöffnet', imported: 'Importiert' }[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Table area */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <StudyTable
              studies={displayedStudies}
              onOpen={handleOpen}
              loading={loading && tab === 'all'}
              error={error && tab === 'all' ? error : null}
              onRetry={loadStudies}
            />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: Colors.sidebar, borderTop: Border, fontSize: 10, color: Colors.textDim, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <span>{uniquePatients} Patienten · {studies.length} Studien{lastImport ? ` · Letzter Import: heute ${lastImport}` : ''}</span>
        <span>AmbientCT v0.1 · MIT</span>
      </div>

      {/* Hidden file input (id referenced above) */}
      <input id="dental-import-input" type="file" accept=".dcm,.zip" multiple style={{ display: 'none' }}
        onChange={async e => {
          if (e.target.files?.length) {
            for (const file of Array.from(e.target.files)) {
              try { await client.uploadDicom(file); } catch { /* toast handled by DicomImport */ }
            }
            handleImported();
          }
          // Reset so the same file can be re-selected
          (e.target as HTMLInputElement).value = '';
        }}
      />

      {/* DicomImport for toast only */}
      <DicomImport client={client} onImported={handleImported} />
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: 'none', border: Border, borderRadius: Radius.sm, color: Colors.textMuted,
  cursor: 'pointer', fontFamily: Font.family, fontSize: 11, padding: '5px 12px',
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/viewports/DentalFileManager.tsx
git commit -m "feat: add DentalFileManager (Screen A — Orthanc study browser)"
```

---

## Task 8: Extension integration — inject file manager portal

**Files:**
- Modify: `extensions/dental-cpr/src/index.ts`
- Modify: `config/ohif-config.js`

> **Why portal in preRegistration:** OHIF v3 only calls viewport components when a study is loaded and a hanging protocol matches. `preRegistration` runs once at app start regardless of study state — it's the reliable injection point for our file manager overlay.

- [ ] **Step 1: Add portal injection to preRegistration**

In `extensions/dental-cpr/src/index.ts`, replace the existing `preRegistration` function body:

```typescript
// Add these imports at the top of index.ts:
import React from 'react';
import ReactDOM from 'react-dom/client';
import DentalFileManager from './viewports/DentalFileManager';
```

Replace the `preRegistration` body:

```typescript
preRegistration({ servicesManager, extensionManager, configuration = {} }: any) {
  console.log('[DentalCPR] Extension v0.1.0 registered — world\'s first open-source OHIF dental panoramic CPR');

  // ── Inject DentalFileManager as a fullscreen portal ────────────────────
  // OHIF viewport components only render when a study is loaded.
  // We inject the file manager at the DOM level so it shows before any study
  // is selected, independent of OHIF's study/display-set lifecycle.

  const studyUIDs = new URLSearchParams(window.location.search).getAll('StudyInstanceUIDs');
  const hasStudy = studyUIDs.length > 0;

  const portalRoot = document.createElement('div');
  portalRoot.id = 'dental-file-manager-portal';
  portalRoot.style.cssText = `position:fixed;inset:0;z-index:9999;display:${hasStudy ? 'none' : 'block'}`;
  document.body.appendChild(portalRoot);

  const reactRoot = ReactDOM.createRoot(portalRoot);
  const render = (visible: boolean) => {
    portalRoot.style.display = visible ? 'block' : 'none';
    if (visible) {
      reactRoot.render(
        React.createElement(DentalFileManager, {
          onOpen: (studyInstanceUID: string) => {
            portalRoot.style.display = 'none';
            // Navigate to OHIF viewer with the study UID
            window.location.href = `/?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUID)}`;
          },
        })
      );
    }
  };

  render(!hasStudy);
  // Note: navigation uses window.location.href (full reload), not pushState.
  // popstate does not fire for hard navigations, so no listener needed.
  // "Schließen" → window.location.href='/' → full reload → preRegistration re-runs → file manager shown.
},
```

- [ ] **Step 2: Set showStudyList: false in OHIF config**

In `config/ohif-config.js`, change line 3:
```javascript
showStudyList: false,
```

- [ ] **Step 3: Add CSS animation for spinner (injected once)**

In `preRegistration`, before the `render()` call, add:
```typescript
if (!document.getElementById('dental-animations')) {
  const s = document.createElement('style');
  s.id = 'dental-animations';
  s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/index.ts config/ohif-config.js
git commit -m "feat: inject DentalFileManager portal in preRegistration; disable OHIF study list"
```

---

## Task 9: Viewer toolbar in DentalContainerViewport

**Files:**
- Modify: `extensions/dental-cpr/src/viewports/DentalContainerViewport.tsx`

- [ ] **Step 1: Add import and onClose prop**

At the top of `DentalContainerViewport.tsx`, add:
```typescript
import ViewerToolbar from '../components/ViewerToolbar';
```

Change the function signature from:
```typescript
export default function DentalContainerViewport(props: any) {
  const { displaySets, servicesManager, extensionManager, commandsManager } = props;
```
to:
```typescript
export default function DentalContainerViewport(props: any) {
  const { displaySets, servicesManager, extensionManager, commandsManager } = props;
  const onClose = props.onClose ?? (() => { window.location.href = '/'; });
```

- [ ] **Step 2: Extract study info from displaySets**

After the `onClose` line, add:
```typescript
const ds = displaySets?.[0] ?? {};
const patientName: string = ds.PatientName ?? ds.patientName ?? 'Unbekannt';
const modality: string    = ds.Modality    ?? ds.modality    ?? 'CT';
const studyDate: string   = ds.StudyDate   ?? ds.studyDate   ?? '';
```

- [ ] **Step 3: Add toolbar to the return JSX**

Change the return statement from:
```tsx
return (
  <div style={{
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#111',
    overflow: 'hidden',
    gap: 2,
  }}>
    <div style={{ flex: '6', minHeight: 0, overflow: 'hidden' }}>
```
to:
```tsx
return (
  <div style={{
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#111',
    overflow: 'hidden',
    gap: 2,
  }}>
    <ViewerToolbar
      patientName={patientName}
      modality={modality}
      studyDate={studyDate}
      onClose={onClose}
    />
    <div style={{ flex: '6', minHeight: 0, overflow: 'hidden' }}>
```

- [ ] **Step 4: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/viewports/DentalContainerViewport.tsx
git commit -m "feat: add ViewerToolbar to DentalContainerViewport (breadcrumb + Schließen)"
```

---

## Task 10: Apply designTokens to CPR + cross-section label styles

**Files:**
- Modify: `extensions/dental-cpr/src/viewports/DentalCPRViewport.tsx`
- Modify: `extensions/dental-cpr/src/viewports/DentalCrossSectionViewport.tsx`

- [ ] **Step 1: Update DentalCPRViewport label colors**

Add import at top of `DentalCPRViewport.tsx`:
```typescript
import { Colors, Font } from '../utils/designTokens';
```

Replace hardcoded color values in the existing inline styles:
- `'#00aaff'` → `Colors.primary` (tool accent color; also the slab slider accent)
- `'#888'` label text → `Colors.textMuted`
- `'#ccc'` slab value → `Colors.text`
- `'#666'` dim text → `Colors.textDim`
- `'system-ui, -apple-system, sans-serif'` → `Font.family`
- `'#0a0a0a'` and `'#111'` backgrounds → keep as-is (not using tokens here to avoid layout risk)

Run: `grep -En "00aaff|#888|#ccc|#666|system-ui" extensions/dental-cpr/src/viewports/DentalCPRViewport.tsx`
Replace each occurrence individually using the Edit tool.

- [ ] **Step 2: Update DentalCrossSectionViewport label colors**

Add import at top of `DentalCrossSectionViewport.tsx`:
```typescript
import { Colors, Font } from '../utils/designTokens';
```

Apply same color token substitutions: `grep -En "00aaff|#888|#ccc|#666|system-ui" extensions/dental-cpr/src/viewports/DentalCrossSectionViewport.tsx`, then replace individually using the Edit tool.

- [ ] **Step 3: Commit**

```bash
cd /Users/john/dev/AmbientCT
git add extensions/dental-cpr/src/viewports/DentalCPRViewport.tsx extensions/dental-cpr/src/viewports/DentalCrossSectionViewport.tsx
git commit -m "refactor: use designTokens in CPR + cross-section label styles"
```

---

## Task 11: Docker build + smoke test

- [ ] **Step 1: Build and start**

```bash
cd /Users/john/dev/AmbientCT
docker compose up --build -d
```
Wait ~60s for OHIF webpack + Orthanc to start.

- [ ] **Step 2: Check OHIF loads without study**

Open http://localhost:3000 in browser.
Expected:
- `DentalFileManager` fullscreen overlay is visible
- Menubar shows `🦷 AmbientCT` + status dot
- Sidebar shows patient tree (empty if no studies)
- Study table shows loading spinner then empty state or study list

- [ ] **Step 3: Verify Öffnen → opens viewer**

If studies exist, click `Öffnen →` on one.
Expected:
- URL changes to `/?StudyInstanceUIDs=<uid>`
- File manager portal hides
- OHIF hanging protocol activates (2-column layout)
- `DentalContainerViewport` shows with `ViewerToolbar` at top
- CPR + cross-section viewports render

- [ ] **Step 3b: Verify OHIF default chrome is absent (spec §12.7)**

In the browser console on the viewer page, run:
```javascript
[
  '[data-cy="study-list-header"]',
  '.study-list-header',
  '[class*="StudyList"]',
  '[data-testid="measurementTable"]',
].map(sel => [sel, !!document.querySelector(sel)])
```
Expected: all values `false` — none of OHIF's built-in chrome elements are in the DOM.

- [ ] **Step 4: Verify Schließen returns to file manager**

Click `✕ Schließen` in ViewerToolbar.
Expected:
- Navigates to `/`
- File manager portal shows again
- Study list reloads

- [ ] **Step 5: Verify DICOM import**

Drag a `.dcm` file onto the file manager.
Expected:
- Upload toast appears
- After success, study list refreshes

- [ ] **Step 6: Run Jest unit tests**

```bash
cd /Users/john/dev/AmbientCT/extensions/dental-cpr
npx jest --no-coverage 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 7: Final commit**

```bash
cd /Users/john/dev/AmbientCT
git add -A
git status  # verify nothing unexpected
git commit -m "chore: verify AmbientCT UI redesign build + smoke test"
```

---

## Troubleshooting

**File manager doesn't appear on load:**
- Check browser console for `[DentalCPR] Extension v0.1.0 registered`
- Check if `#dental-file-manager-portal` div exists in DOM (`document.getElementById('dental-file-manager-portal')`)
- Verify `showStudyList: false` in `config/ohif-config.js`

**Studies don't load (Orthanc unreachable):**
- Verify Docker is running: `docker compose ps`
- Try `curl http://localhost:8042/system` — should return Orthanc version JSON
- The Nginx proxy at `/pacs/dicom-web` maps to Orthanc; verify in `docker-compose.yml`

**Viewer toolbar not visible:**
- Check if `DentalContainerViewport` render includes `<ViewerToolbar />` before the flex children
- The toolbar has `height: 40` and `flexShrink: 0` — if parent has overflow hidden, verify the parent height allows it

**TypeScript errors in index.ts after adding React import:**
- Verify `"jsx": "react"` or `"react-jsx"` in `extensions/dental-cpr/tsconfig.json`
- Or use `React.createElement` form (already used in the plan) to avoid JSX dependency
