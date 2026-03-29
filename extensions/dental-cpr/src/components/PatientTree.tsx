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
