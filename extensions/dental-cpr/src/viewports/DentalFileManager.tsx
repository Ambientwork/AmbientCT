// extensions/dental-cpr/src/viewports/DentalFileManager.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Colors, Font, Border, Radius } from '../utils/designTokens';
import {
  OrthancClient,
  addToRecentStudies,
  markAsImported,
  getRecentStudies,
  getImportedStudies,
  supportsDentalViewer,
} from '../utils/orthancClient';
import type { StudySummary } from '../utils/orthancClient';
import StudyTable from '../components/StudyTable';
import PatientTree from '../components/PatientTree';
import DicomImport, { useDragDrop } from '../components/DicomImport';
import type { DicomImportApi } from '../components/DicomImport';

type Tab = 'all' | 'recent' | 'imported';

const client = new OrthancClient('/pacs/dicom-web');

interface Props {
  onOpen: (studyInstanceUID: string, study: StudySummary) => void;
}

export default function DentalFileManager({ onOpen }: Props) {
  const importApiRef = useRef<DicomImportApi | null>(null);
  const pendingImportStudyUIDsRef = useRef<Set<string> | null>(null);
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [lastImport, setLastImport] = useState<string>('');
  const [search, setSearch] = useState('');
  const [openingStudy, setOpeningStudy] = useState<StudySummary | null>(null);

  const loadStudies = useCallback(async (): Promise<StudySummary[]> => {
    setLoading(true);
    setError(null);
    const healthy = await client.checkHealth();
    setOnline(healthy);
    if (!healthy) {
      setLoading(false);
      setError('unreachable');
      return [];
    }
    try {
      const list = await client.listStudies();
      setStudies(list);
      return list;
    } catch (e: any) {
      setError(e.message ?? 'Fehler');
      return [];
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
    setOpeningStudy(study);
    window.requestAnimationFrame(() => onOpen(uid, study));
  };

  const handleImported = (importedStudies: StudySummary[] = []) => {
    importedStudies.forEach(markAsImported);
    setLastImport(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
  };

  const finalizeImport = useCallback(async (uploadedStudyUIDs: string[] = []) => {
    const previousStudyUIDs = pendingImportStudyUIDsRef.current ?? new Set<string>();
    const refreshedStudies = await loadStudies();
    const importedStudies = refreshedStudies.filter(
      study => !previousStudyUIDs.has(study.studyInstanceUID)
    );
    const knownStudyUIDs = new Set(importedStudies.map(study => study.studyInstanceUID));
    for (const studyUID of uploadedStudyUIDs) {
      const matchingStudy = refreshedStudies.find(study => study.studyInstanceUID === studyUID);
      if (matchingStudy && !knownStudyUIDs.has(matchingStudy.studyInstanceUID)) {
        importedStudies.push(matchingStudy);
        knownStudyUIDs.add(matchingStudy.studyInstanceUID);
      }
    }
    pendingImportStudyUIDsRef.current = null;
    handleImported(importedStudies);
  }, [loadStudies]);

  const openImportPicker = () => {
    pendingImportStudyUIDsRef.current = new Set(studies.map(study => study.studyInstanceUID));
    importApiRef.current?.openPicker();
  };

  const { dragging, handlers: dragHandlers } = useDragDrop(async (files) => {
    const importApi = importApiRef.current;
    if (!importApi) return;

    pendingImportStudyUIDsRef.current = new Set(studies.map(study => study.studyInstanceUID));
    const uploadedStudyUIDs = await importApi.importFiles(files, { notifyParent: false });
    await finalizeImport(uploadedStudyUIDs);
  });

  const displayedStudies: StudySummary[] = tab === 'all' ? studies
    : tab === 'recent' ? getRecentStudies()
    : getImportedStudies();

  const searchQuery = search.trim().toLowerCase();
  const filteredStudies = displayedStudies.filter(study => {
    if (!searchQuery) return true;
    return study.patientName.toLowerCase().includes(searchQuery)
      || study.description.toLowerCase().includes(searchQuery)
      || study.studyDate.includes(searchQuery)
      || study.modality.toLowerCase().includes(searchQuery);
  });

  // Unique patients for status bar
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

      {openingStudy && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            background: 'rgba(10,10,18,0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              minWidth: 320,
              maxWidth: 520,
              margin: 16,
              padding: '20px 22px',
              background: '#11131a',
              border: Border,
              borderRadius: 14,
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 26, height: 26, border: `2px solid ${Colors.border}`, borderTopColor: Colors.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: Colors.text }}>
                  Studie wird geoeffnet...
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: Colors.textMuted }}>
                  {supportsDentalViewer(openingStudy)
                    ? 'CBCT/CT wird im AmbientCT Dental Viewer geladen.'
                    : 'Nicht-CT-Studie wird im Standard-Viewer geladen.'}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: Colors.textDim }}>
              {openingStudy.patientName} · {openingStudy.modality || '—'}
            </div>
          </div>
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
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', background: '#1a1a20', border: Border, borderRadius: 6, color: Colors.text, fontFamily: Font.family, fontSize: 11, padding: '5px 8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4 }}>
            <PatientTree studies={filteredStudies} onOpen={handleOpen} />
          </div>
          <div style={{ padding: 10, borderTop: Border }}>
            <button
              onClick={openImportPicker}
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
                <p style={{ margin: '2px 0 0', fontSize: 11, color: Colors.textMuted }}>AmbientCT von Ambientwork · Open Source</p>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button
                  onClick={openImportPicker}
                  style={{ ...actionBtnStyle, background: Colors.primary, color: '#0a0a12' }}
                >↑ Importieren</button>
                <button
                  onClick={() => window.open(`${window.location.origin}/pacs/app/explorer.html`, '_blank')}
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
              studies={filteredStudies}
              onOpen={handleOpen}
              loading={loading && tab === 'all'}
              error={error && tab === 'all' ? error : null}
              onRetry={loadStudies}
              search={search}
              onSearchChange={setSearch}
            />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: Colors.sidebar, borderTop: Border, fontSize: 10, color: Colors.textDim, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <span>{uniquePatients} Patienten · {studies.length} Studien{lastImport ? ` · Letzter Import: heute ${lastImport}` : ''}</span>
        <span>AmbientCT · Ambientwork · Open Source</span>
      </div>

      <DicomImport
        client={client}
        onImported={uploadedStudyUIDs => {
          void finalizeImport(uploadedStudyUIDs);
        }}
        registerApi={api => {
          importApiRef.current = api;
        }}
      />
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: 'none', border: Border, borderRadius: Radius.sm, color: Colors.textMuted,
  cursor: 'pointer', fontFamily: Font.family, fontSize: 11, padding: '5px 12px',
};
