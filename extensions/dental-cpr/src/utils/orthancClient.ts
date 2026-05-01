// extensions/dental-cpr/src/utils/orthancClient.ts

export interface MarJobStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  progress: number;        // 0.0 – 1.0
  message?: string;
  mar_series_uid?: string;
  error?: string;
}

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

export interface UploadResult {
  studyInstanceUID: string | null;
}

export function getStudyModalities(modality: string): string[] {
  return String(modality || '')
    .split('\\')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
}

export function supportsDentalViewer(study: Pick<StudySummary, 'modality'>): boolean {
  return getStudyModalities(study.modality).includes('CT');
}

export function getStudyViewerPath(
  study: Pick<StudySummary, 'studyInstanceUID' | 'modality'>
): string {
  const route = supportsDentalViewer(study) ? '/dentalCPR' : '/viewer';
  return `${route}?StudyInstanceUIDs=${encodeURIComponent(study.studyInstanceUID)}`;
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
    ? modalitiesArr.join('\\')
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

  // ── MAR (Metal Artifact Reduction) ─────────────────────────────────────────

  /**
   * Startet einen asynchronen MAR-Job für eine DICOM-Serie.
   * Der MAR-Processor läuft auf MAR_URL (default: http://localhost:8000).
   * Gibt die job_id zurück — Status via pollMarJob() abfragen.
   */
  async triggerMar(seriesInstanceUID: string, marUrl: string): Promise<string> {
    const r = await fetch(`${marUrl}/api/process-mar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ series_instance_uid: seriesInstanceUID }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => r.statusText);
      throw new Error(`MAR-Start fehlgeschlagen: ${text || r.status}`);
    }
    const { job_id } = await r.json();
    return job_id as string;
  }

  /**
   * Fragt den Status eines laufenden MAR-Jobs ab.
   */
  async getMarJobStatus(jobId: string, marUrl: string): Promise<MarJobStatus> {
    const r = await fetch(`${marUrl}/api/job/${jobId}`);
    if (!r.ok) throw new Error(`Job-Status-Abfrage fehlgeschlagen: ${r.status}`);
    return r.json() as Promise<MarJobStatus>;
  }

  /**
   * Upload a DICOM payload.
   * `.dcm` files use STOW-RS, `.zip` archives use Orthanc's REST import.
   */
  async uploadDicom(file: File): Promise<UploadResult> {
    const zipUpload = isZipFile(file);
    const r = zipUpload
      ? await fetch(`${getOrthancRestBase(this.base)}/instances`, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/zip' },
          body: await file.arrayBuffer(),
        })
      : await uploadDicomViaStow(this.base, file);

    if (!r.ok) {
      const text = await r.text().catch(() => r.statusText);
      throw new Error(text || `${r.status}`);
    }

    const payload = await r.json().catch(() => null);
    const studyInstanceUID = zipUpload
      ? await resolveStudyInstanceUIDFromOrthancUpload(this.base, payload)
      : getStudyInstanceUIDFromStowResponse(payload);

    return { studyInstanceUID };
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

async function uploadDicomViaStow(base: string, file: File): Promise<Response> {
  const boundary = `----AmbientCTBoundary${Date.now()}`;
  const body = await buildStowMultipart(file, boundary);

  return fetch(`${base}/studies`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; type=application/dicom; boundary=${boundary}`,
    },
    body,
  });
}

export function isZipFile(file: Pick<File, 'name' | 'type'>): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.zip') || file.type === 'application/zip';
}

export function getOrthancRestBase(base: string): string {
  return base.replace(/\/dicom-web\/?$/, '');
}

export function getStudyInstanceUIDFromStowResponse(payload: any): string | null {
  const studyUrl = payload?.['00081190']?.Value?.[0];
  if (typeof studyUrl !== 'string') {
    return null;
  }

  const match = studyUrl.match(/\/studies\/([^/]+)/);
  return match?.[1] ?? null;
}

async function resolveStudyInstanceUIDFromOrthancUpload(base: string, payload: any): Promise<string | null> {
  const orthancStudyId = payload?.ParentStudy;
  if (typeof orthancStudyId !== 'string' || !orthancStudyId) {
    return null;
  }

  const response = await fetch(`${getOrthancRestBase(base)}/studies/${orthancStudyId}`);
  if (!response.ok) {
    return null;
  }

  const study = await response.json().catch(() => null);
  return study?.MainDicomTags?.StudyInstanceUID ?? null;
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
