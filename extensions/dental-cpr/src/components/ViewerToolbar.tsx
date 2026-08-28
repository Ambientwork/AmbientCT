// extensions/dental-cpr/src/components/ViewerToolbar.tsx
import React from 'react';
import { Colors, Font, Border } from '../utils/designTokens';

export type MarStatus = 'idle' | 'processing' | 'done' | 'error';

export interface ViewerToolbarProps {
  patientName: string;
  modality: string;
  studyDate: string;
  layoutMode?: 'cpr' | 'mpr';
  onLayoutModeChange?: (mode: 'cpr' | 'mpr') => void;
  slabMm?: number;
  onSlabChange?: (mm: number) => void;
  onClose: () => void;
  // MAR
  marStatus?: MarStatus;
  marProgress?: number;      // 0–100
  marSeriesUid?: string;
  onMarTrigger?: () => void;
  onOpenMarSeries?: () => void;
  onEnterMarCompare?: () => void;
  onSwitchToOriginalSeries?: () => void;
  onSwitchToMarSeries?: () => void;
  activeSeriesLabel?: 'original' | 'mar';
  // Synchronized compare view (plan §10 P3.4) — W/L lock across the Original/
  // MAR/Diff columns. Visible + default-on whenever compare mode is active.
  wlLocked?: boolean;
  onWlLockChange?: (locked: boolean) => void;
}

export default function ViewerToolbar({
  patientName, modality, studyDate, layoutMode = 'cpr', onLayoutModeChange,
  slabMm = 10, onSlabChange, onClose,
  marStatus = 'idle', marProgress = 0, marSeriesUid, onMarTrigger,
  onOpenMarSeries, onEnterMarCompare, onSwitchToOriginalSeries, onSwitchToMarSeries,
  activeSeriesLabel, wlLocked = true, onWlLockChange,
}: ViewerToolbarProps) {
  const label = [patientName, studyDate ? formatDate(studyDate) : ''].filter(Boolean).join(' · ');
  const inMarCompare = Boolean(onSwitchToOriginalSeries && onSwitchToMarSeries);
  const showMarActions = !inMarCompare && Boolean(marSeriesUid);
  const showMarTrigger = onMarTrigger && marStatus !== 'done' && !showMarActions;

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
      {showMarTrigger && (
        <MarButton
          status={marStatus}
          progress={marProgress}
          onClick={onMarTrigger}
        />
      )}

      {inMarCompare && (
        <>
          <CompareBadge />
          <MarCompareSwitcher
            activeSeriesLabel={activeSeriesLabel}
            onSwitchToOriginalSeries={onSwitchToOriginalSeries!}
            onSwitchToMarSeries={onSwitchToMarSeries!}
          />
        </>
      )}

      {onWlLockChange && layoutMode === 'mpr' && (
        <WlLockToggle locked={wlLocked} onChange={onWlLockChange} />
      )}

      {/* MAR fertig: direkte Aktionen statt UID-Hinweis */}
      {showMarActions && (
        <MarResultActions
          seriesUid={marSeriesUid}
          onOpenMarSeries={onOpenMarSeries}
          onEnterMarCompare={onEnterMarCompare}
        />
      )}

      {onLayoutModeChange && (
        <LayoutModeSwitcher
          layoutMode={layoutMode}
          onChange={onLayoutModeChange}
        />
      )}

      {/* Slab slider */}
      {onSlabChange && layoutMode === 'cpr' && (
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

function MarResultActions({
  seriesUid,
  onOpenMarSeries,
  onEnterMarCompare,
}: {
  seriesUid: string;
  onOpenMarSeries?: () => void;
  onEnterMarCompare?: () => void;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span
        title={`MAR-Serie UID: ${seriesUid}`}
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
        ✓ MAR bereit
      </span>
      {onOpenMarSeries && (
        <SmallActionButton title="MAR-Serie direkt im Viewer oeffnen" onClick={onOpenMarSeries}>
          MAR oeffnen
        </SmallActionButton>
      )}
      {onEnterMarCompare && (
        <SmallActionButton title="Original und MAR im Vergleichsmodus laden" onClick={onEnterMarCompare}>
          Vergleich
        </SmallActionButton>
      )}
    </div>
  );
}

function MarCompareSwitcher({
  activeSeriesLabel,
  onSwitchToOriginalSeries,
  onSwitchToMarSeries,
}: {
  activeSeriesLabel?: 'original' | 'mar';
  onSwitchToOriginalSeries: () => void;
  onSwitchToMarSeries: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          color: Colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Vergleich
      </span>
      <div style={{ display: 'inline-flex', border: Border, borderRadius: 6, overflow: 'hidden' }}>
        <SeriesToggleButton
          active={activeSeriesLabel === 'original'}
          onClick={onSwitchToOriginalSeries}
          title="Originalserie anzeigen"
        >
          Original
        </SeriesToggleButton>
        <SeriesToggleButton
          active={activeSeriesLabel === 'mar'}
          onClick={onSwitchToMarSeries}
          title="MAR-Serie anzeigen"
        >
          MAR
        </SeriesToggleButton>
      </div>
    </div>
  );
}

function WlLockToggle({
  locked,
  onChange,
}: {
  locked: boolean;
  onChange: (locked: boolean) => void;
}): React.ReactElement {
  return (
    <button
      onClick={() => onChange(!locked)}
      title={
        locked
          ? 'W/L-Lock aktiv — Fenster/Level-Änderungen gelten für alle Vergleichs-Panels'
          : 'W/L-Lock aus — jedes Panel hat ein eigenes Fenster/Level'
      }
      aria-pressed={locked}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: locked ? 'rgba(56,189,248,0.12)' : 'transparent',
        border: `1px solid ${locked ? Colors.primary : Colors.textMuted}`,
        borderRadius: 6,
        color: locked ? Colors.primary : Colors.textMuted,
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: Font.family,
        padding: '3px 8px',
      }}
    >
      {locked ? '🔒 W/L Lock' : '🔓 W/L Lock'}
    </button>
  );
}

function CompareBadge(): React.ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: '#f59e0b',
        border: '1px solid #b45309',
        borderRadius: 6,
        padding: '3px 8px',
        userSelect: 'none',
      }}
      title="Original-, MAR- und Differenzansichten sind aktiv"
    >
      Vergleich aktiv
    </span>
  );
}

function SeriesToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onClick={active ? undefined : onClick}
      title={title}
      style={{
        background: active ? Colors.primary : 'transparent',
        color: active ? '#0b0b10' : Colors.textMuted,
        border: 'none',
        cursor: active ? 'default' : 'pointer',
        fontSize: 11,
        fontFamily: Font.family,
        fontWeight: 600,
        padding: '4px 10px',
        minWidth: 74,
      }}
    >
      {children}
    </button>
  );
}

function SmallActionButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent',
        border: Border,
        borderRadius: 6,
        color: Colors.text,
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: Font.family,
        padding: '3px 8px',
      }}
    >
      {children}
    </button>
  );
}

function LayoutModeSwitcher({
  layoutMode,
  onChange,
}: {
  layoutMode: 'cpr' | 'mpr';
  onChange: (mode: 'cpr' | 'mpr') => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          color: Colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Layout
      </span>
      <div style={{ display: 'inline-flex', border: Border, borderRadius: 6, overflow: 'hidden' }}>
        <SeriesToggleButton
          active={layoutMode === 'cpr'}
          onClick={() => onChange('cpr')}
          title="Dental CPR Layout anzeigen"
        >
          CPR
        </SeriesToggleButton>
        <SeriesToggleButton
          active={layoutMode === 'mpr'}
          onClick={() => onChange('mpr')}
          title="Axial plus MPR Layout anzeigen"
        >
          MPR
        </SeriesToggleButton>
      </div>
    </div>
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
