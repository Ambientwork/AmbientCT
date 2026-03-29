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
