// extensions/dental-cpr/src/viewports/DentalFileManager.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Colors, Font, Border, Radius } from '../utils/designTokens';
import { OrthancClient, addToRecentStudies, markAsImported, getRecentStudies, getImportedStudies } from '../utils/orthancClient';
import type { StudySummary } from '../utils/orthancClient';
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
              onClick={() => document.getElementById('dental-import-input')?.click()}
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
                  onClick={() => document.getElementById('dental-import-input')?.click()}
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

      {/* Hidden file input */}
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

      {/* DicomImport for toast notifications */}
      <DicomImport client={client} onImported={handleImported} />
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: 'none', border: Border, borderRadius: Radius.sm, color: Colors.textMuted,
  cursor: 'pointer', fontFamily: Font.family, fontSize: 11, padding: '5px 12px',
};
