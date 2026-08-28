# Dental Viewer Feature Matrix & AmbientCT Plan

> Research date: 2026-05-21  
> Scope: dental DICOM / CBCT viewers, public product pages, official manuals, and product-adjacent documentation.  
> Purpose: define the common feature baseline for AmbientCT and convert it into an implementable roadmap.

AmbientCT should not compete as a generic DICOM viewer only. The dental market expectation is a workflow viewer:
CBCT review, tooth-centric navigation, panoramic reconstruction, cross-sections, implant safety, comparison,
reporting, and simple practice deployment.

This document complements [`DENTAL-FEATURES-ROADMAP.md`](DENTAL-FEATURES-ROADMAP.md), which focuses more on
OHIF / Cornerstone / CPR implementation details.

---

## 1. Reference Products

| Product | Vendor / Type | Publicly visible positioning | Useful benchmark for AmbientCT |
|---------|----------------|------------------------------|--------------------------------|
| Planmeca Romexis | Planmeca, full dental imaging suite | 2D/3D imaging, implantology, CAD/CAM, cephalometry, AI-related workflows | Broadest dental all-in-one workflow reference |
| DTX Studio Clinic | Envista / DTX Studio, practice suite | Patient workspace, imaging workflows, diagnosis and treatment planning | Workspace model and tooth-centric review |
| Sidexis 4 | Dentsply Sirona, dental imaging | Lightbox, compare mode, timeline, DS Core integration | Study comparison and clinical timeline UX |
| CS 3D Imaging / CS Imaging | Carestream Dental | CBCT visualization, implant planning, airway, model matching | Implant and airway planning baseline |
| OnDemand3D | Cybermed, modular CBCT suite | Dynamic Light Box, Dental, Report, 3D, Ceph, Guide modules | Modular viewer architecture and reporting |
| Anatomage Invivo | Anatomage, advanced 3D dental suite | 3D rendering, airway, ortho, implant and surgical workflows | Advanced 3D and surgical visualization |
| Morita i-Dixel | J. Morita, dental imaging software | Simultaneous slice and 3D volume views, canal and implant presentation | Compact dental viewing workflow |
| NewTom NNT | NewTom, CBCT software | Dental sections, TMJ, airway, measurement and planning tools | Dental specialty layouts |
| Blue Sky Plan | Blue Sky Bio, implant planning | CBCT import, implant planning, surgical guide planning | Implant planning and guide workflow |
| Vatech EzDent-i / Ez3D-i | Vatech, dental imaging | Case management, diagnosis, implant simulation, communication | Practice-friendly workflow and communication |
| AIS | ACTEON imaging software | Imaging, measurement, implant planning and integration features | Practical clinical toolset |
| CBCTHub | Web-based CBCT viewer | Browser-based CBCT viewing, cross-sections and simple sharing | Modern web UX reference |
| DentiSlice | Web-based dental CBCT viewer | Browser CBCT viewing with MPR/cross-section positioning | Lightweight web-first layout reference |

Primary sources:

- Planmeca Romexis: https://www.planmeca.com/dental-software/planmeca-romexis/
- Planmeca Romexis 3D: https://prod.promodel.planmeca.com/dental-software/planmeca-romexis/3d-imaging-software/
- DTX Studio: https://dtxstudio.com/en-us/dtx-studio-product-overview
- DTX Studio IFU: https://helpfiles.dtxstudio.com/IFU/50784413-8047-4699-82f7-d1e9a868909e/4.5/GMT94511_IFU_DTX_Studio_Clinic_4.5_en-US_v2.pdf
- Sidexis 4: https://www.dentsplysirona.com/en-us/discover/discover-by-brand/sidexis-4.html
- Carestream CS 3D Imaging: https://www.carestreamdental.com/en-us/discover/clinical-software/imaging-software/cs-3d-imaging-premium/
- Carestream CS 3D overview: https://help.carestreamdental.com/rh/web/server/CS_3D_Imaging/projects_responsive/SMA22/Overview.htm
- OnDemand3D: https://www.ondemand3d.com/en/contents.html?pageId=G1T729Y93EKDQY81877T
- Anatomage Dental: https://anatomage.co.jp/anatomage-dental/
- Morita i-Dixel: https://www.morita.com/anz/en/products/diagnostic-and-imaging-equipment/imaging-software/i-dixel/
- NewTom NNT: https://www.newtom.it/es/software-radiologia/nnt
- Blue Sky Plan manual: https://manual.blueskyplan.com/index.php/Introduction
- ACTEON AIS: https://recette.acteongroup.monkees.pro/en/products/imaging/imaging-software/ais-software
- CBCTHub: https://cbcthub.com/en
- DentiSlice: https://dentislice.com/
- CBCT reconstruction reference: https://www.dentalcare.com/en-us/ce-courses/ce531/image-acquisition-and-reconstruction

---

## 2. Market Feature Matrix

Legend:

| Marker | Meaning |
|--------|---------|
| Core | Seen across almost every serious dental CBCT product |
| Common | Frequent, expected in stronger products |
| Advanced | Differentiator, often module-based or premium |
| AmbientCT status: Done | Exists and has been exercised locally |
| AmbientCT status: Partial | Exists, but needs UX hardening, persistence, tests, or runtime proof |
| AmbientCT status: Gap | Not implemented as a complete workflow |

| Feature | Market prevalence | Product examples | AmbientCT status | Priority | Notes for AmbientCT |
|---------|-------------------|------------------|------------------|----------|---------------------|
| Study list / patient browser | Core | Sidexis, Romexis, DTX, Vatech, OnDemand | Partial | P0 | Must be boringly reliable: search, open, refresh, visible loading/error states. |
| DICOM import / PACS receive | Core | Most suites | Done | P0 | Orthanc provides the foundation. UI import and error handling should be tightened. |
| Axial / sagittal / coronal MPR | Core | All CBCT viewers | Done | P0 | OHIF / Cornerstone baseline. Needs dental default hanging protocol consistency. |
| Window / level presets | Core | All CBCT viewers | Done | P0 | Add explicit dental presets: bone, implant, soft tissue, MAR compare, nerve. |
| Zoom / pan / scroll / reset | Core | All viewers | Done | P0 | Need robust E2E coverage for all viewports. |
| Measurements: distance, angle, ROI | Core | Romexis, AIS, DentiSlice, OnDemand | Done | P0 | Persist measurement state and verify DICOM SR export path. |
| Annotation / labels | Core | OnDemand, DTX, Romexis, AIS | Partial | P0 | Needed for clinical communication and screenshots. |
| Screenshot / export / print | Core | OnDemand, Sidexis, Romexis, AIS | Gap | P0 | Add one-click viewport screenshot and case snapshot export. |
| 3D volume rendering | Core | Romexis, Anatomage, Morita, OnDemand | Partial | P1 | Available through OHIF stack; needs dental layout integration and performance checks. |
| Curved panoramic reconstruction | Core for dental CBCT | Romexis, NewTom, CBCTHub, DentiSlice | Partial | P0 | AmbientCT CPR exists; harden arch editing, persistence, and image quality controls. |
| Cross-sections along dental arch | Core for dental CBCT | NewTom, CBCTHub, DentiSlice, Romexis | Partial | P0 | Already central to AmbientCT; needs scroll sync, spacing labels, and export. |
| Arch line editor | Core for CPR | Most CBCT dental workflows | Partial | P0 | Needs edit handles, undo, save/load per study, and auto-fit later. |
| Tooth chart / tooth-centric navigation | Common | DTX, Romexis, dental suites | Gap | P1 | High UX leverage: click tooth 36, jump layout and annotations to that tooth. |
| Mandibular canal tracing | Common | Romexis, Carestream, Morita | Partial | P1 | Existing tool foundation; needs persistence, safety margin, and overlay in CPR/cross-sections. |
| Implant planning / virtual implant | Common | Blue Sky Plan, Carestream, Romexis, AIS | Scaffold / Gap | P1 | Start with generic cylinders and distance-to-canal, then add library. |
| Implant library | Common in planning tools | Blue Sky Plan, Carestream, Romexis | Gap | P2 | Use open generic dimensions first; branded libraries may have licensing issues. |
| STL / intraoral scan matching | Common in modern suites | Romexis, Carestream, DTX | Gap | P2 | Important for advanced planning, not required for first stable release. |
| Before/after compare | Common | Sidexis, Romexis, Anatomage, NewTom | Partial | P0 | MAR compare grid (original/MAR/diff, synced slice+W/L state, geometry compatibility gate) is implemented and unit-tested; viewer build succeeded with live screenshot evidence of CPR/MPR rendering (2026-08-28). Entering the 3-column compare grid itself was NOT runtime-verified end-to-end — 2 of 8 E2E scenarios timed out loading two full 300-instance CBCT series concurrently in this sandboxed environment (not a logic defect: the fallback single-series path correctly exercises the new bounded-poll timeout/retry UI). Re-run on faster hardware before calling this Done. |
| Timeline / longitudinal review | Common | Sidexis, DTX, practice suites | Gap | P2 | Useful after study list is stable. |
| TMJ dual view | Common specialty layout | NewTom, Anatomage, Romexis | Gap | P2 | Add as layout preset, not first workflow. |
| Airway analysis | Advanced / common in premium | Anatomage, Carestream, Romexis, NewTom | Gap | P3 | Needs segmentation and volume measurement. |
| Cephalometry | Advanced | Romexis, OnDemand, Anatomage | Gap | P3 | Orthodontic module; separate roadmap. |
| DICOM SEG / SR output | Common for modern interoperability | OHIF ecosystem, reporting modules | Partial | P1 | SEG write path is runtime-verified (2026-08-28, Gate G4): demo segmentation written to Orthanc via STOW-RS, re-read, and all 52/52 per-frame source-instance references confirmed against the real source series (0 fabricated references); demo markers are clearly present in the SEG file itself. Real-model SEG output is code-complete but untested (`pending_external_artifact`, no weights). DICOM SR is not implemented. |
| Report builder | Common | OnDemand Report, DTX, Romexis | Gap | P1 | Start with screenshot plus measurements; later structured report. |
| Web sharing / collaboration | Advanced | DTX, Sidexis DS Core, CBCTHub | Gap | P3 | AmbientCT is local-first; sharing must preserve privacy principles. |
| AI segmentation | Advanced, rising | Romexis AI, research tools, AI modules | Partial | P2 | Corrected from "Scaffold" (2026-08-28): the full demo pipeline (job queue → mock segmentation → DICOM SEG write/roundtrip → findings API) is runtime-verified end-to-end in the isolated test stack (Gate G4), not just scaffolded code. Real DentalSegmentator inference is code-complete but unverified without downloaded weights (`pending_external_artifact`). Keep Research Preview and local-only. |
| MAR original/MAR workflow | Dental / CT differentiator | Less visible in dental suites, high value for implants | Partial | P0 | MAR service works; UI has explicit compare, result loading, and localStorage mapping (with staleness detection). 6 of 8 E2E scenarios runtime-verified (2026-08-28); the 2 scenarios covering the compare grid actually becoming visible were not verified in this environment (see "Before/after compare" row above). |

---

## 3. Layout Matrix

AmbientCT should ship layout presets that match how dentists actually read CBCTs. The important idea is not "many panels";
it is fast movement between clinical questions.

| Layout | Purpose | Viewports | Controls | AmbientCT priority |
|--------|---------|-----------|----------|--------------------|
| Study Browser | Open the right patient/study confidently | Patient list, study cards, thumbnail/metadata preview | Search, date filter, modality filter, refresh, import | P0 |
| CBCT Core Review | General orientation | Axial, sagittal, coronal, optional 3D | WL presets, sync cursor, reset, screenshot, measurements | P0 |
| Dental CPR | Dental arch review | Large panorama, axial arch editor, cross-section strip/grid | Arch edit, cross-section spacing, slab thickness, tooth labels | P0 |
| MAR Compare | Validate artifact reduction | Original and MAR linked viewports, diff/heat overlay, same slice/WL | Toggle original/MAR/diff, linked scroll, opacity, regenerate MAR | P0 |
| Implant Planning | Plan implant position safely | Panorama, selected cross-section, axial, 3D | Canal overlay, implant cylinder, diameter/length, safety distance | P1 |
| Tooth Focus / Endo | Review one tooth deeply | Tooth chart, local oblique slices, focused cross-sections | Tooth selector, root/canal annotations, periapical markers | P1 |
| Lightbox Compare | Compare studies/images | 2-up or 4-up synchronized studies | Sync scroll/WL, timeline selector, screenshot | P1 |
| Report Workspace | Convert review to output | Selected screenshots, measurements, notes, findings | Export PDF, DICOM SR draft, anonymized case export | P1 |
| TMJ Workspace | Joint assessment | Left/right TMJ synchronized views | Side selector, measurement presets, compare | P2 |
| Airway Workspace | Airway volume and constriction | Sagittal/coronal/3D airway mask | Threshold/segmentation, volume, minimum area | P3 |

Recommended default layout progression:

```text
Study Browser
  -> CBCT Core Review
  -> Dental CPR
  -> MAR Compare when MAR exists or is generated
  -> Implant Planning / Tooth Focus / Report Workspace as task-specific modes
```

---

## 4. AmbientCT Implementation Plan

### P0: Stabilize the dental viewer core

Goal: AmbientCT should open studies, display CBCT, run MAR, and let a dentist compare original vs MAR without guesswork.

| Work item | User outcome | Acceptance criteria | Likely code areas |
|-----------|--------------|---------------------|-------------------|
| Study open reliability | Clicking a patient/study always opens the expected viewer or shows a useful error | E2E opens at least 3 studies; invalid URL has recovery path; loading has timeout state | `extensions/*`, OHIF routing, `tests/e2e` |
| CPR runtime hardening | Dental panorama and cross-sections load predictably | CPR viewport renders nonblank; cross-section count and slice labels are correct; no long silent loading | `extensions/dental-cpr/src/viewports` |
| MAR compare workflow | User can see original, MAR, and difference | Generate MAR, load resulting series, linked scroll, W/L lock, diff overlay | `mar-processor`, `DentalContainerViewport`, viewer state |
| Window/level presets | Dental windows are one click away | Bone, implant, soft tissue, MAR compare presets visible in toolbar | OHIF config, dental toolbar |
| Screenshot export | Dentist can capture current view | PNG export includes study UID, series label, W/L, slice index, timestamp | viewer tools, report service |
| E2E harness | We stop guessing about UI behavior | Playwright covers study list, open viewer, CPR, MAR, compare, screenshot | `tests/e2e` |

### P1: Build the expected dental workflow layer

Goal: Make AmbientCT feel like a dental CBCT tool, not a repainted medical viewer.

| Work item | User outcome | Acceptance criteria | Likely code areas |
|-----------|--------------|---------------------|-------------------|
| Layout preset switcher | Dentist can switch between Core, CPR, Compare, Implant, Report | Layout state persists per session; switching keeps same study/slice context | mode config, layout service |
| Arch editor persistence | Dental arch survives reloads and study reopen | Arch points saved per study/series in Orthanc metadata or local store | CPR tools, Orthanc attachment API |
| Tooth chart navigation | Clicking a tooth focuses the review | FDI chart selects tooth; crosshair/CPR jumps to saved tooth region | dental tools, state store |
| Mandibular canal workflow | Canal tracing is visible where it matters | Canal line shown in MPR, CPR, cross-sections; 2 mm safety margin toggle | `NerveCanalTool`, overlays |
| Basic report builder | Dentist can produce a simple case output | Selected screenshots and measurements export to PDF/HTML; disclaimer included | report module |
| DICOM SR / SEG persistence design | Measurements and masks are not trapped in browser state | Structured persistence path documented and first SR/SEG write prototype works | Orthanc write helpers |

### P2: Planning and interoperability

Goal: Support higher-value planning without becoming unsafe or legally sloppy.

| Work item | User outcome | Acceptance criteria | Notes |
|-----------|--------------|---------------------|-------|
| Generic implant overlay | Place implant-sized cylinder in 2D/3D | Diameter/length editable; distance to canal shown; collision warning is visual only | Avoid vendor trademark/library claims initially |
| Implant case snapshot | Planning state can be reopened | Implant positions, canal, arch and measurements saved with study | Use explicit "research/planning aid" language |
| STL / intraoral scan import | CBCT can be aligned with surface scan | STL loads; manual alignment works; transform persists | Needs mesh pipeline and UI affordances |
| Timeline compare | Follow-up studies can be compared | Two studies linked by patient ID/date; scroll and W/L sync | Needs patient matching rules |
| AI anatomy segmentation preview | Model output becomes useful overlay | DICOM SEG stored, overlay visible, "Research Preview" label enforced | Local-only, no diagnosis claims |

### P3: Specialty modules

Goal: Expand when the foundation is stable and tested.

| Work item | User outcome | Acceptance criteria |
|-----------|--------------|---------------------|
| TMJ workspace | Left/right TMJ review is fast and symmetric | Dual layout, linked controls, side labels, measurements |
| Airway analysis | Airway volume and minimum area can be estimated | Segmentation/thresholding workflow, volume report, visible uncertainty |
| Cephalometry | Orthodontic landmark workflow exists | Landmark placement, angles/distances, exportable report |
| Cloud/share option | Optional collaboration without violating local-first trust | Explicit opt-in, anonymization path, no default upload |

---

## 5. Suggested Release Plan

| Release | Theme | Must ship | Should ship | Exit criteria |
|---------|-------|-----------|-------------|---------------|
| `v0.3` | Stable Dental Core | Study open reliability, CPR hardening, MAR compare, W/L presets, E2E smoke suite | Screenshot export | Dentist can open a CBCT, inspect CPR, run MAR, and compare results end-to-end. |
| `v0.4` | Dental Navigation | Layout switcher, arch persistence, tooth chart, canal overlay | Basic report builder | Dentist can return to a case and continue from saved dental context. |
| `v0.5` | Planning Preview | Generic implant overlay, distance-to-canal, planning snapshot | DICOM SR/SEG prototype | Implant planning aid is useful but clearly non-certified. |
| `v0.6` | Reporting & Interop | Report workspace, measurement persistence, DICOM export path | Timeline compare | Case output is shareable inside the practice without screenshots-only workflow. |
| `v1.0` | Practice-Ready OSS | Installer docs, backup/restore, full E2E suite, PHI-safe logging, stable Docker images | AI segmentation preview behind flag | A small dental practice can run AmbientCT locally with predictable behavior. |

---

## 6. Immediate Build Backlog

This is the most practical next chunk after the current MAR fix.

| Order | Task | Why it matters | Done when |
|-------|------|----------------|-----------|
| 1 | Add `MAR Compare` layout | Validates a feature AmbientCT already has technically | Original/MAR/diff are visible with linked slice/WL controls |
| 2 | Add E2E test for MAR generation and compare | Prevents regression of the bug just fixed | Test starts MAR, waits for completion, opens new series, asserts visible difference UI |
| 3 | Harden CPR loading states | Removes "long loading, nothing happens" failure mode | Viewer shows progress, timeout, retry, and exact failed series/study IDs |
| 4 | Persist generated MAR series reference | User should not regenerate blindly | Study metadata remembers latest MAR series UID |
| 5 | Add screenshot/export button | Needed for feedback, bug reports and clinical discussion | PNG contains viewport plus metadata strip |
| 6 | Add layout preset switcher | Makes the viewer feel intentional | Core / CPR / MAR Compare / Report visible as first-class modes |
| 7 | Draft report workspace | Converts viewer use into output | Select screenshots + measurements -> local PDF/HTML |

---

## 7. Design Principles for AmbientCT

| Principle | Practical rule |
|-----------|----------------|
| Dental first, not generic radiology first | Default to CBCT dental layouts and dental W/L presets when a CBCT is opened. |
| Local-first trust | No cloud upload, no telemetry, no model download without explicit admin action. |
| Visible state beats hidden magic | Long-running actions like MAR and AI must show job state, source series, output series, and retry path. |
| Every generated artifact must be traceable | MAR, reports, measurements and segmentations need source study/series UID and timestamp. |
| Research features must look like research features | AI and planning aids need clear labels and clinician confirmation. |
| E2E is part of the product | Every release milestone needs visible browser tests, screenshots, and fixture data. |

---

## 8. Compliance And Licensing Notes

AmbientCT can implement workflows inspired by common market behavior: MPR, CPR, cross-sections, measurement,
comparison, reporting, and planning layouts are generic software patterns. Avoid copying product-specific icons,
screen layouts pixel-for-pixel, branded implant libraries, proprietary terminology, screenshots, or manuals.

Implant libraries need special care. Generic cylinder planning is safe as an OSS starting point. Manufacturer-specific
catalogs should only be added when licensing and trademark usage are clear.

Clinical claims need discipline. Until certified, AmbientCT should use wording such as "planning aid", "research preview",
"not for diagnosis", and "clinician review required" for MAR, AI, implant safety and automated segmentation features.

