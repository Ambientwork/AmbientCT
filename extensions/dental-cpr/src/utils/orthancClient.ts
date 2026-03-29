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
