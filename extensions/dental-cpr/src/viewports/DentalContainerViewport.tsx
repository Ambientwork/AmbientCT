import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRenderingEngines } from '@cornerstonejs/core';
import DentalCPRViewport from './DentalCPRViewport';
import DentalCrossSectionViewport, {
  ARCH_CROSS_SECTION_POSITION,
  CROSS_SECTION_STEP,
} from './DentalCrossSectionViewport';
import DentalMPRViewport from './DentalMPRViewport';
import DentalMPRDiffViewport from './DentalMPRDiffViewport';
import type { CrossSectionEventDetail } from './DentalCrossSectionViewport';
import { getSharedFrames } from '../utils/dentalState';
import { deriveCompareLayout } from '../utils/compareLayout';
import ViewerToolbar, { type MarStatus } from '../components/ViewerToolbar';
import {
  findStoredMarSeriesResult,
  getSeriesViewerPath,
  invalidateStoredMarSeriesResult,
  OrthancClient,
  saveStoredMarSeriesResult,
} from '../utils/orthancClient';

// MAR-Processor URL — proxied same-origin via nginx (/mar-api/ →
// mar-processor:8000 over the internal pacs-net, see
// config/nginx/ohif.conf.template), so every stack always talks to its OWN
// mar-processor. A hardcoded absolute http://localhost:8000 default here
// previously matched production's host port by coincidence but silently hit
// PRODUCTION's mar-processor/Orthanc from the isolated test stack (whose
// mar-processor is published on host port 8100) — the isolated stack's
// phantom series shares production's SeriesInstanceUID, so the misdirected
// call "succeeded" there instead of failing loudly. Never hardcode an
// absolute origin+port for this again. window.__MAR_URL__ remains a valid
// override for a non-standard deployment.
const MAR_URL: string = (window as any).__MAR_URL__ ?? '/mar-api';
const MAR_POLL_INTERVAL_MS = 1500;
// MAR processing on CPU can legitimately take minutes; this bounds the poll
// so a stuck/dead job store entry cannot leave the UI spinning forever
// (plan §10 addendum 18.2 — the previous setInterval had no cap at all).
const MAR_POLL_TIMEOUT_MS = 15 * 60 * 1000;

const DEFAULT_COMPARE_WINDOW = 2000;
const DEFAULT_COMPARE_LEVEL = 400;
const DEFAULT_COMPARE_DIFF_WINDOW_HU = 1500;

const AXIAL_OVERLAY_ID = 'dental-axial-xsect-overlay';
// Half-length of cross-section indicator lines on axial view (mm).
// Matches SLICE_SIZE_MM / 2 = 80 / 2 in DentalCrossSectionViewport.
const LINE_HALF_MM = 40;

function findAxialViewport() {
  for (const engine of getRenderingEngines()) {
    const vp = (engine as any).getViewport?.('cbctAxial');
    if (vp) return vp;
  }
  return null;
}

// Inject CSS to widen the dental container panel relative to the axial panel.
// OHIF's ViewportGrid uses absolute positioning with inline styles; !important
// overrides those inline values without touching OHIF's React state.
const DENTAL_GRID_STYLE_ID = 'dental-grid-col-override';

export default function DentalContainerViewport(props: any) {
  const { displaySets, servicesManager, extensionManager, commandsManager } = props;
  const allDisplaySets = Array.isArray(displaySets) ? displaySets : [];

  const urlParams = new URLSearchParams(window.location.search);
  const initialSeriesUID = urlParams.get('initialSeriesInstanceUID') ?? undefined;
  const marSourceSeriesUID = urlParams.get('marSourceSeriesInstanceUID') ?? undefined;
  const marResultSeriesUID = urlParams.get('marResultSeriesInstanceUID') ?? undefined;
  const initialLayoutMode: 'cpr' | 'mpr' = urlParams.get('layoutMode') === 'mpr' ? 'mpr' : 'cpr';

  const selectedDisplaySet =
    allDisplaySets.find(ds => {
      const uid = ds?.SeriesInstanceUID ?? ds?.seriesInstanceUID ?? ds?.series?.SeriesInstanceUID;
      return uid && uid === initialSeriesUID;
    }) ??
    allDisplaySets[0] ??
    {};

  const sharedProps = {
    displaySets: selectedDisplaySet ? [selectedDisplaySet] : [],
    servicesManager,
    extensionManager,
    commandsManager,
  };

  const onClose = props.onClose ?? (() => { window.location.href = '/'; });
  const ds = selectedDisplaySet;
  const patientName: string = ds.PatientName ?? ds.patientName ?? 'Unbekannt';
  const modality: string    = ds.Modality    ?? ds.modality    ?? 'CT';
  const studyDate: string   = ds.StudyDate   ?? ds.studyDate   ?? '';
  const studyUID: string    = ds.StudyInstanceUID ?? ds.studyInstanceUID ?? '';
  const activeSeriesUID: string | undefined =
    ds.SeriesInstanceUID ?? ds.seriesInstanceUID ?? ds.series?.SeriesInstanceUID;
  const storedMarResult = activeSeriesUID ? findStoredMarSeriesResult(activeSeriesUID) : undefined;
  const compareSourceSeriesUID = marSourceSeriesUID ?? storedMarResult?.sourceSeriesInstanceUID;
  const compareResultSeriesUID = marResultSeriesUID ?? storedMarResult?.marSeriesInstanceUID;
  const isInMarCompareMode = Boolean(marSourceSeriesUID && marResultSeriesUID);
  const activeSeriesLabel =
    activeSeriesUID && compareResultSeriesUID && activeSeriesUID === compareResultSeriesUID
      ? 'mar'
      : activeSeriesUID && compareSourceSeriesUID && activeSeriesUID === compareSourceSeriesUID
        ? 'original'
        : undefined;
  const sourceDisplaySet =
    compareSourceSeriesUID
      ? allDisplaySets.find(ds => {
          const uid = ds?.SeriesInstanceUID ?? ds?.seriesInstanceUID ?? ds?.series?.SeriesInstanceUID;
          return uid && uid === compareSourceSeriesUID;
        })
      : undefined;
  const resultDisplaySet =
    compareResultSeriesUID
      ? allDisplaySets.find(ds => {
          const uid = ds?.SeriesInstanceUID ?? ds?.seriesInstanceUID ?? ds?.series?.SeriesInstanceUID;
          return uid && uid === compareResultSeriesUID;
        })
      : undefined;

  // Stable array identity across re-renders (P3.4 lifts slice/W/L state to
  // this component, so every slider drag now re-renders it — a fresh
  // `[sourceDisplaySet]` literal each time would otherwise restart the
  // bounded volume-load poll in every compare viewport on every tick).
  const sourceDisplaySets = useMemo(() => (sourceDisplaySet ? [sourceDisplaySet] : []), [sourceDisplaySet]);
  const resultDisplaySets = useMemo(() => (resultDisplaySet ? [resultDisplaySet] : []), [resultDisplaySet]);

  // ── MAR-State ────────────────────────────────────────────────────────────────
  const [layoutMode, setLayoutMode] = useState<'cpr' | 'mpr'>(initialLayoutMode);
  const [marStatus, setMarStatus]     = useState<MarStatus>('idle');
  const [marProgress, setMarProgress] = useState(0);
  const [marSeriesUid, setMarSeriesUid] = useState<string | undefined>();
  const [marMappingNotice, setMarMappingNotice] = useState<string | undefined>();
  const marPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const marPollStartedAtRef = useRef<number>(0);

  const { compareSplitReady } = deriveCompareLayout({ layoutMode, sourceDisplaySet, resultDisplaySet });

  // ── Synchronized compare state (plan §10 P3.4) ──────────────────────────────
  // Shared across all three columns (Original/MAR/Diff) of a given
  // orientation — one slider move updates all three; coronal and sagittal
  // each own a single shared axis value.
  const [compareCoronalY, setCompareCoronalY]   = useState<number | null>(null);
  const [compareSagittalX, setCompareSagittalX] = useState<number | null>(null);
  const [compareWindow, setCompareWindow] = useState(DEFAULT_COMPARE_WINDOW);
  const [compareLevel, setCompareLevel]   = useState(DEFAULT_COMPARE_LEVEL);
  const [wlLocked, setWlLocked] = useState(true); // visible, default ON per P3.4
  const [compareDiffWindowHU, setCompareDiffWindowHU] = useState(DEFAULT_COMPARE_DIFF_WINDOW_HU);

  // New compare session (different source/result pair) → reset the shared
  // slice coordinates so a stale mm value from a previous pair of series
  // never gets applied to a volume with different bounds. W/L and the diff
  // scale are display preferences, not per-series state, so they persist.
  useEffect(() => {
    setCompareCoronalY(null);
    setCompareSagittalX(null);
  }, [compareSourceSeriesUID, compareResultSeriesUID]);

  const handleWindowLevelChange = useCallback((nextWindow: number, nextLevel: number) => {
    if (!wlLocked) return; // unlocked: each panel keeps its own local W/L
    setCompareWindow(nextWindow);
    setCompareLevel(nextLevel);
  }, [wlLocked]);

  const handleMarTrigger = useCallback(async () => {
    // Extrahiere SeriesInstanceUID aus dem ersten DisplaySet
    const seriesUID: string | undefined =
      ds.SeriesInstanceUID ?? ds.seriesInstanceUID ?? ds.series?.SeriesInstanceUID;

    if (!seriesUID) {
      console.error('[MAR] Keine SeriesInstanceUID im DisplaySet gefunden.');
      setMarStatus('error');
      return;
    }

    setMarStatus('processing');
    setMarProgress(0);
    setMarMappingNotice(undefined);

    const orthancBase = (window as any).config?.dataSources?.[0]?.configuration?.qidoRoot
      ?? '/dicom-web';
    // OrthancClient-Instanz für MAR-Trigger
    const client = new OrthancClient(orthancBase.replace('/dicom-web', ''));

    try {
      const jobId = await client.triggerMar(seriesUID, MAR_URL);
      marPollStartedAtRef.current = Date.now();

      // Fortschritt pollen — bounded by MAR_POLL_TIMEOUT_MS (plan §10
      // addendum 18.2: this loop previously had no cap and could spin
      // forever against a job the store never resolves).
      marPollRef.current = setInterval(async () => {
        if (Date.now() - marPollStartedAtRef.current > MAR_POLL_TIMEOUT_MS) {
          clearInterval(marPollRef.current!);
          setMarStatus('error');
          console.warn('[MAR] Zeitüberschreitung beim Polling nach', MAR_POLL_TIMEOUT_MS, 'ms');
          return;
        }
        try {
          const status = await client.getMarJobStatus(jobId, MAR_URL);
          setMarProgress(Math.round(status.progress * 100));

          if (status.status === 'completed' && status.mar_series_uid) {
            clearInterval(marPollRef.current!);
            const marSeriesUidValue = status.mar_series_uid;

            // Orthanc's DICOMweb/QIDO index can briefly lag behind the
            // STOW-RS write mar-processor just completed. Wait for the new
            // series to actually be queryable before exposing "MAR öffnen"/
            // "Vergleich" — otherwise the very next navigation can outrace
            // that indexing and land on a series the viewer's hanging
            // protocol can't find yet (P3.6 scenario 2/3/4).
            const qidoClient = new OrthancClient(orthancBase);
            await qidoClient.waitForSeriesQueryable(marSeriesUidValue);

            setMarStatus('done');
            setMarProgress(100);
            setMarSeriesUid(marSeriesUidValue);
            if (studyUID && seriesUID) {
              saveStoredMarSeriesResult({
                studyInstanceUID: studyUID,
                sourceSeriesInstanceUID: seriesUID,
                marSeriesInstanceUID: marSeriesUidValue,
              });
            }
          } else if (status.status === 'error') {
            clearInterval(marPollRef.current!);
            setMarStatus('error');
            // PHI-safe: never log status.error verbatim — mar-processor sets
            // it to str(exc), which can embed file paths, DICOM tag values,
            // or other exception detail. jobId is a non-PHI correlation id
            // an operator can grep mar-processor's job store/logs with.
            console.error('[MAR] Verarbeitung fehlgeschlagen. Job-ID:', jobId);
          }
        } catch (e) {
          console.warn('[MAR] Polling-Fehler:', e);
        }
      }, MAR_POLL_INTERVAL_MS);

    } catch (e) {
      console.error('[MAR] Job-Start fehlgeschlagen:', e);
      setMarStatus('error');
    }
  }, [ds, studyUID]);

  const navigateToSeries = useCallback((seriesUIDs: string[], initialSeriesUID: string) => {
    if (!studyUID) return;

    const sourceSeriesUID = compareSourceSeriesUID ?? activeSeriesUID;
    const resultSeriesUID = compareResultSeriesUID ?? marSeriesUid ?? initialSeriesUID;
    const nextLayoutMode =
      seriesUIDs.length > 1 && sourceSeriesUID && resultSeriesUID ? 'mpr' : layoutMode;

    window.location.href = getSeriesViewerPath(
      { studyInstanceUID: studyUID, modality },
      seriesUIDs,
      initialSeriesUID,
      {
        layoutMode: nextLayoutMode,
        marSourceSeriesInstanceUID: sourceSeriesUID,
        marResultSeriesInstanceUID: resultSeriesUID,
      }
    );
  }, [activeSeriesUID, compareResultSeriesUID, compareSourceSeriesUID, layoutMode, marSeriesUid, modality, studyUID]);

  // MAR-mapping staleness check (plan §10 P3.2): a mapping loaded from
  // localStorage (as opposed to a MAR result just produced in this session)
  // may reference a series that no longer exists in Orthanc — data reset,
  // isolated-stack teardown, manual cleanup. Verifying before navigating
  // turns that into an actionable "regenerate" prompt instead of letting the
  // user click into a compare view that hangs forever waiting for a volume
  // that will never arrive.
  const verifyMarMappingBeforeNavigate = useCallback(
    async (resultSeriesUID: string, sourceSeriesUID: string): Promise<boolean> => {
      if (marSeriesUid && marSeriesUid === resultSeriesUID) return true; // fresh from this session

      const orthancBase = (window as any).config?.dataSources?.[0]?.configuration?.qidoRoot ?? '/dicom-web';
      const client = new OrthancClient(orthancBase);
      const exists = await client.checkSeriesExists(resultSeriesUID);
      if (!exists) {
        invalidateStoredMarSeriesResult(sourceSeriesUID);
        setMarSeriesUid(undefined);
        setMarStatus('idle');
        setMarProgress(0);
        setMarMappingNotice('MAR-Ergebnis nicht mehr in Orthanc vorhanden — bitte MAR erneut ausführen.');
        return false;
      }
      return true;
    },
    [marSeriesUid]
  );

  const handleOpenMarSeries = useCallback(async () => {
    const sourceSeriesUID = compareSourceSeriesUID ?? activeSeriesUID;
    const resultSeriesUID = compareResultSeriesUID ?? marSeriesUid;
    if (!sourceSeriesUID || !resultSeriesUID) return;
    if (!(await verifyMarMappingBeforeNavigate(resultSeriesUID, sourceSeriesUID))) return;
    navigateToSeries([resultSeriesUID], resultSeriesUID);
  }, [activeSeriesUID, compareResultSeriesUID, compareSourceSeriesUID, marSeriesUid, navigateToSeries, verifyMarMappingBeforeNavigate]);

  const handleEnterMarCompare = useCallback(async () => {
    const sourceSeriesUID = compareSourceSeriesUID ?? activeSeriesUID;
    const resultSeriesUID = compareResultSeriesUID ?? marSeriesUid;
    if (!sourceSeriesUID || !resultSeriesUID) return;
    if (!(await verifyMarMappingBeforeNavigate(resultSeriesUID, sourceSeriesUID))) return;
    navigateToSeries([sourceSeriesUID, resultSeriesUID], resultSeriesUID);
  }, [activeSeriesUID, compareResultSeriesUID, compareSourceSeriesUID, marSeriesUid, navigateToSeries, verifyMarMappingBeforeNavigate]);

  const handleSwitchToOriginalSeries = useCallback(() => {
    if (!compareSourceSeriesUID || !compareResultSeriesUID) return;
    navigateToSeries([compareSourceSeriesUID, compareResultSeriesUID], compareSourceSeriesUID);
  }, [compareResultSeriesUID, compareSourceSeriesUID, navigateToSeries]);

  const handleSwitchToMarSeries = useCallback(() => {
    if (!compareSourceSeriesUID || !compareResultSeriesUID) return;
    navigateToSeries([compareSourceSeriesUID, compareResultSeriesUID], compareResultSeriesUID);
  }, [compareResultSeriesUID, compareSourceSeriesUID, navigateToSeries]);

  const showMarTrigger = !isInMarCompareMode || activeSeriesLabel !== 'mar';

  const updateLayoutMode = useCallback((nextMode: 'cpr' | 'mpr') => {
    setLayoutMode(nextMode);
    const params = new URLSearchParams(window.location.search);
    params.set('layoutMode', nextMode);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  // Cleanup bei Unmount
  useEffect(() => {
    return () => {
      if (marPollRef.current) clearInterval(marPollRef.current);
    };
  }, []);

  // ── Axial cross-section overlay ─────────────────────────────────────────────
  useEffect(() => {
    const drawOverlay = (evt: Event) => {
      const { splineIndex, numSamples } = (evt as CustomEvent<CrossSectionEventDetail>).detail;
      const vp = findAxialViewport();
      if (!vp) return;

      const el = vp.element as HTMLElement;

      // Create overlay canvas once, re-use on subsequent events
      let canvas = el.querySelector<HTMLCanvasElement>(`#${AXIAL_OVERLAY_ID}`);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = AXIAL_OVERLAY_ID;
        canvas.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10';
        if (getComputedStyle(el).position === 'static') {
          el.style.position = 'relative';
        }
        el.appendChild(canvas);
      }

      const rect = el.getBoundingClientRect();
      canvas.width  = rect.width;
      canvas.height = rect.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const frames = getSharedFrames();
      if (!frames.length) return;

      const centerIdx = Math.max(0, Math.min(numSamples - 1, splineIndex));
      if (!frames[centerIdx]) return;

      // Draw thin perpendicular lines at each cross-section position.
      // Each line uses its OWN frame's normal (buccal-lingual direction) so
      // lines are truly perpendicular to the arch at that specific point.
      // This matches exactly what the cross-section viewport samples.
      const slots = [
        { offset: -CROSS_SECTION_STEP, color: '#00aaff', dash: [5, 4] as number[], lw: 1   },
        { offset: 0,                   color: '#00ff88', dash: [] as number[],      lw: 1.5 },
        { offset:  CROSS_SECTION_STEP, color: '#00aaff', dash: [5, 4] as number[], lw: 1   },
      ];

      for (const { offset, color, dash, lw } of slots) {
        const idx = Math.max(0, Math.min(numSamples - 1, splineIndex + offset));
        const frame = frames[idx];
        if (!frame) continue;

        const [px, py, pz] = frame.point;
        const [Nx, Ny, Nz] = frame.normal; // buccal-lingual at THIS point

        // Line endpoints: ±LINE_HALF_MM along N from frame.point
        const p1 = vp.worldToCanvas([
          px + Nx * LINE_HALF_MM, py + Ny * LINE_HALF_MM, pz + Nz * LINE_HALF_MM
        ] as any);
        const p2 = vp.worldToCanvas([
          px - Nx * LINE_HALF_MM, py - Ny * LINE_HALF_MM, pz - Nz * LINE_HALF_MM
        ] as any);

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = lw;
        ctx.setLineDash(dash);
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
        ctx.restore();
      }
    };

    window.addEventListener(ARCH_CROSS_SECTION_POSITION, drawOverlay);
    return () => {
      window.removeEventListener(ARCH_CROSS_SECTION_POSITION, drawOverlay);
      // Remove overlay canvas on unmount
      const vp = findAxialViewport();
      vp?.element?.querySelector?.(`#${AXIAL_OVERLAY_ID}`)?.remove();
    };
  }, []);

  // ── OHIF grid CSS ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById(DENTAL_GRID_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = DENTAL_GRID_STYLE_ID;
    // Target OHIF pane children: first pane = axial (33%), second = dental container (67%)
    style.textContent = `
      .group\\/pane:nth-child(1) { width: 33% !important; }
      .group\\/pane:nth-child(2) { left: calc(33% + 4px) !important; width: calc(67% - 6px) !important; }
      [class*="group-hover/pane"] { pointer-events: none !important; }
      [class*="group-hover/pane"] > * { pointer-events: auto; }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById(DENTAL_GRID_STYLE_ID)?.remove();
    };
  }, []);

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
        layoutMode={layoutMode}
        onLayoutModeChange={updateLayoutMode}
        onClose={onClose}
        marStatus={marStatus}
        marProgress={marProgress}
        marSeriesUid={marSeriesUid ?? compareResultSeriesUID}
        onMarTrigger={showMarTrigger ? handleMarTrigger : undefined}
        onOpenMarSeries={(marSeriesUid ?? compareResultSeriesUID) ? handleOpenMarSeries : undefined}
        onEnterMarCompare={(marSeriesUid ?? compareResultSeriesUID) ? handleEnterMarCompare : undefined}
        onSwitchToOriginalSeries={isInMarCompareMode && !compareSplitReady ? handleSwitchToOriginalSeries : undefined}
        onSwitchToMarSeries={isInMarCompareMode && !compareSplitReady ? handleSwitchToMarSeries : undefined}
        activeSeriesLabel={activeSeriesLabel as 'original' | 'mar' | undefined}
        wlLocked={wlLocked}
        onWlLockChange={compareSplitReady ? setWlLocked : undefined}
      />
      {marMappingNotice && (
        <div
          style={{
            flexShrink: 0,
            padding: '6px 12px',
            background: '#3a2a12',
            borderBottom: '1px solid #b45309',
            color: '#fbbf24',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>⚠ {marMappingNotice}</span>
          <button
            onClick={() => setMarMappingNotice(undefined)}
            style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      )}
      {layoutMode === 'mpr' ? (
        compareSplitReady ? (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2, overflow: 'hidden' }}>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-coronal-original"
                orientation="coronal"
                labelOverride="Original · Coronal"
                accentColor="#38bdf8"
                displaySets={sourceDisplaySets}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
                sliceWorldCoordinate={compareCoronalY}
                onSliceWorldCoordinateChange={setCompareCoronalY}
                windowWidth={compareWindow}
                windowCenter={compareLevel}
                onWindowLevelChange={handleWindowLevelChange}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-coronal-mar"
                orientation="coronal"
                labelOverride="MAR · Coronal"
                accentColor="#34d399"
                displaySets={resultDisplaySets}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
                sliceWorldCoordinate={compareCoronalY}
                onSliceWorldCoordinateChange={setCompareCoronalY}
                windowWidth={compareWindow}
                windowCenter={compareLevel}
                onWindowLevelChange={handleWindowLevelChange}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRDiffViewport
                viewportId="mpr-coronal-diff"
                orientation="coronal"
                labelOverride="Diff · Coronal"
                primaryDisplaySets={sourceDisplaySets}
                secondaryDisplaySets={resultDisplaySets}
                sliceWorldCoordinate={compareCoronalY}
                diffWindowHU={compareDiffWindowHU}
                onDiffWindowChange={setCompareDiffWindowHU}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-sagittal-original"
                orientation="sagittal"
                labelOverride="Original · Sagittal"
                accentColor="#38bdf8"
                displaySets={sourceDisplaySets}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
                sliceWorldCoordinate={compareSagittalX}
                onSliceWorldCoordinateChange={setCompareSagittalX}
                windowWidth={compareWindow}
                windowCenter={compareLevel}
                onWindowLevelChange={handleWindowLevelChange}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-sagittal-mar"
                orientation="sagittal"
                labelOverride="MAR · Sagittal"
                accentColor="#34d399"
                displaySets={resultDisplaySets}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
                sliceWorldCoordinate={compareSagittalX}
                onSliceWorldCoordinateChange={setCompareSagittalX}
                windowWidth={compareWindow}
                windowCenter={compareLevel}
                onWindowLevelChange={handleWindowLevelChange}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRDiffViewport
                viewportId="mpr-sagittal-diff"
                orientation="sagittal"
                labelOverride="Diff · Sagittal"
                primaryDisplaySets={sourceDisplaySets}
                secondaryDisplaySets={resultDisplaySets}
                sliceWorldCoordinate={compareSagittalX}
                diffWindowHU={compareDiffWindowHU}
                onDiffWindowChange={setCompareDiffWindowHU}
              />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 2, overflow: 'hidden' }}>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <DentalMPRViewport viewportId="mpr-coronal" orientation="coronal" {...sharedProps} />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <DentalMPRViewport viewportId="mpr-sagittal" orientation="sagittal" {...sharedProps} />
            </div>
          </div>
        )
      ) : (
        <>
          <div style={{ flex: '6', minHeight: 0, overflow: 'hidden' }}>
            <DentalCPRViewport viewportId="dentalCPR" {...sharedProps} />
          </div>
          <div style={{ flex: '4', minHeight: 0, display: 'flex', gap: 2, overflow: 'hidden' }}>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <DentalCrossSectionViewport viewportId="xsect-L" position={-1} {...sharedProps} />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <DentalCrossSectionViewport viewportId="xsect-C" position={0} {...sharedProps} />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <DentalCrossSectionViewport viewportId="xsect-R" position={1} {...sharedProps} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
