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
