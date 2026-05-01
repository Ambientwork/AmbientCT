// extensions/dental-cpr/src/components/ViewerToolbar.tsx
import React from 'react';
import { Colors, Font, Border } from '../utils/designTokens';

export type MarStatus = 'idle' | 'processing' | 'done' | 'error';

export interface ViewerToolbarProps {
  patientName: string;
  modality: string;
  studyDate: string;
  slabMm?: number;
  onSlabChange?: (mm: number) => void;
  onClose: () => void;
  // MAR
  marStatus?: MarStatus;
  marProgress?: number;      // 0–100
  marSeriesUid?: string;
  onMarTrigger?: () => void;
}

export default function ViewerToolbar({
  patientName, modality, studyDate, slabMm = 10, onSlabChange, onClose,
  marStatus = 'idle', marProgress = 0, marSeriesUid, onMarTrigger,
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
      position: 'relative',
      zIndex: 100,
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

      {/* ── MAR-Button ─────────────────────────────────────────────── */}
      {onMarTrigger && marStatus !== 'done' && (
        <MarButton
          status={marStatus}
          progress={marProgress}
          onClick={onMarTrigger}
        />
      )}

      {/* MAR fertig: Link zur neuen Serie */}
      {marStatus === 'done' && marSeriesUid && (
        <MarDoneHint seriesUid={marSeriesUid} />
      )}

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

// ── Sub-Komponenten ──────────────────────────────────────────────────────────

function MarButton({ status, progress, onClick }: {
  status: MarStatus;
  progress: number;
  onClick: () => void;
}): React.ReactElement {
  const isProcessing = status === 'processing';
  const isError      = status === 'error';

  const label = isError
    ? '⚠ MAR fehlgeschlagen'
    : isProcessing
      ? `MAR … ${Math.round(progress)}%`
      : '✦ MAR';

  const bgColor = isError
    ? '#5a2222'
    : isProcessing
      ? Colors.menubar
      : 'transparent';

  const borderColor = isError
    ? '#c0392b'
    : isProcessing
      ? Colors.primary
      : Colors.textMuted;

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={isProcessing ? undefined : onClick}
        disabled={isProcessing}
        title={
          isProcessing
            ? `Metallartefakt-Reduktion läuft … ${Math.round(progress)}%`
            : isError
              ? 'MAR fehlgeschlagen — erneut versuchen'
              : 'Metal Artifact Reduction starten (erstellt neue Serie in Orthanc)'
        }
        style={{
          background: bgColor,
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
          color: isError ? '#e74c3c' : isProcessing ? Colors.primary : Colors.textMuted,
          cursor: isProcessing ? 'default' : 'pointer',
          fontSize: 11,
          fontFamily: Font.family,
          padding: '3px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 90,
          transition: 'border-color 0.2s, color 0.2s',
        }}
      >
        {isProcessing && <SpinnerIcon size={10} color={Colors.primary} />}
        {label}
      </button>

      {/* Fortschrittsbalken am unteren Rand */}
      {isProcessing && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 2,
          width: `${progress}%`,
          background: Colors.primary,
          borderRadius: '0 0 6px 6px',
          transition: 'width 0.3s ease',
        }} />
      )}
    </div>
  );
}

function MarDoneHint({ seriesUid }: { seriesUid: string }): React.ReactElement {
  return (
    <span
      title={`MAR-Serie UID: ${seriesUid}\nSerie in der OHIF-Seitenliste wählen.`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: '#2ecc71',
        border: '1px solid #27ae60',
        borderRadius: 6,
        padding: '3px 8px',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      ✓ MAR bereit — Serie in Seitenliste wählen
    </span>
  );
}

function SpinnerIcon({ size, color }: { size: number; color: string }): React.ReactElement {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      style={{ animation: 'mar-spin 1s linear infinite', display: 'block' }}
    >
      <style>{`@keyframes mar-spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="2.5"
              strokeDasharray="25 10" strokeLinecap="round" />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd;
  return `${yyyymmdd.slice(6, 8)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(0, 4)}`;
}
