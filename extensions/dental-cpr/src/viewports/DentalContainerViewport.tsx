import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  OrthancClient,
  saveStoredMarSeriesResult,
} from '../utils/orthancClient';

// MAR-Processor URL — separater Docker-Container (Port 8000).
// Kann via window.__MAR_URL__ in ohif-config.js überschrieben werden.
const MAR_URL: string = (window as any).__MAR_URL__ ?? 'http://localhost:8000';
const MAR_POLL_INTERVAL_MS = 1500;

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

  // ── MAR-State ────────────────────────────────────────────────────────────────
  const [layoutMode, setLayoutMode] = useState<'cpr' | 'mpr'>(initialLayoutMode);
  const [marStatus, setMarStatus]     = useState<MarStatus>('idle');
  const [marProgress, setMarProgress] = useState(0);
  const [marSeriesUid, setMarSeriesUid] = useState<string | undefined>();
  const marPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { compareSplitReady } = deriveCompareLayout({ layoutMode, sourceDisplaySet, resultDisplaySet });

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

    const orthancBase = (window as any).config?.dataSources?.[0]?.configuration?.qidoRoot
      ?? '/dicom-web';
    // OrthancClient-Instanz für MAR-Trigger
    const client = new OrthancClient(orthancBase.replace('/dicom-web', ''));

    try {
      const jobId = await client.triggerMar(seriesUID, MAR_URL);

      // Fortschritt pollen
      marPollRef.current = setInterval(async () => {
        try {
          const status = await client.getMarJobStatus(jobId, MAR_URL);
          setMarProgress(Math.round(status.progress * 100));

          if (status.status === 'completed' && status.mar_series_uid) {
            clearInterval(marPollRef.current!);
            setMarStatus('done');
            setMarProgress(100);
            setMarSeriesUid(status.mar_series_uid);
            if (studyUID && seriesUID) {
              saveStoredMarSeriesResult({
                studyInstanceUID: studyUID,
                sourceSeriesInstanceUID: seriesUID,
                marSeriesInstanceUID: status.mar_series_uid,
              });
            }
          } else if (status.status === 'error') {
            clearInterval(marPollRef.current!);
            setMarStatus('error');
            console.error('[MAR] Verarbeitung fehlgeschlagen:', status.error);
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

  const handleOpenMarSeries = useCallback(() => {
    const sourceSeriesUID = compareSourceSeriesUID ?? activeSeriesUID;
    const resultSeriesUID = compareResultSeriesUID ?? marSeriesUid;
    if (!sourceSeriesUID || !resultSeriesUID) return;
    navigateToSeries([resultSeriesUID], resultSeriesUID);
  }, [activeSeriesUID, compareResultSeriesUID, compareSourceSeriesUID, marSeriesUid, navigateToSeries]);

  const handleEnterMarCompare = useCallback(() => {
    const sourceSeriesUID = compareSourceSeriesUID ?? activeSeriesUID;
    const resultSeriesUID = compareResultSeriesUID ?? marSeriesUid;
    if (!sourceSeriesUID || !resultSeriesUID) return;
    navigateToSeries([sourceSeriesUID, resultSeriesUID], resultSeriesUID);
  }, [activeSeriesUID, compareResultSeriesUID, compareSourceSeriesUID, marSeriesUid, navigateToSeries]);

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
      />
      {layoutMode === 'mpr' ? (
        compareSplitReady ? (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2, overflow: 'hidden' }}>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-coronal-original"
                orientation="coronal"
                labelOverride="Original · Coronal"
                accentColor="#38bdf8"
                displaySets={[sourceDisplaySet]}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-coronal-mar"
                orientation="coronal"
                labelOverride="MAR · Coronal"
                accentColor="#34d399"
                displaySets={[resultDisplaySet]}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRDiffViewport
                viewportId="mpr-coronal-diff"
                orientation="coronal"
                labelOverride="Diff · Coronal"
                primaryDisplaySets={[sourceDisplaySet]}
                secondaryDisplaySets={[resultDisplaySet]}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-sagittal-original"
                orientation="sagittal"
                labelOverride="Original · Sagittal"
                accentColor="#38bdf8"
                displaySets={[sourceDisplaySet]}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRViewport
                viewportId="mpr-sagittal-mar"
                orientation="sagittal"
                labelOverride="MAR · Sagittal"
                accentColor="#34d399"
                displaySets={[resultDisplaySet]}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
                commandsManager={commandsManager}
              />
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <DentalMPRDiffViewport
                viewportId="mpr-sagittal-diff"
                orientation="sagittal"
                labelOverride="Diff · Sagittal"
                primaryDisplaySets={[sourceDisplaySet]}
                secondaryDisplaySets={[resultDisplaySet]}
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
