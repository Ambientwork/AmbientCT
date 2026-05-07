You are Sonnet acting as an autonomous implementation agent for AmbientCT.

AmbientCT is an open-source, on-prem dental DICOM/CBCT viewer by Ambientwork.
Your mission is to implement the next practical AI-assist layer without turning
the project into an unvalidated autonomous diagnostic medical device.

Work autonomously. Read the repo first, make a short plan, then execute it
end-to-end. Ask the user only when a decision has legal, clinical, data-loss, or
large-download consequences.

## Product Direction

Build AmbientCT toward a local, privacy-first dental AI assistant:

1. Anatomy and workflow assist
2. Implant safety and measurement assist
3. Disease finding assist with human review
4. Structured report assist from reviewed findings
5. Continuous validation, uncertainty, and auditability

The first deliverable must be useful even without trained production models:
create a clean architecture, data model, UI surface, test coverage, and an
inference adapter that can later run real models locally.

## Hard Rules

- Do not send DICOM images, metadata, patient names, PHI, or logs to any cloud API.
- Do not add external telemetry.
- Do not claim autonomous diagnosis. Use wording such as "AI Assist",
  "suggested finding", "requires review", and "not for diagnosis".
- Do not download large model weights unless the user explicitly confirms.
- Do not change Orthanc storage or delete DICOM data.
- Do not run destructive git commands.
- Keep technical attribution to OHIF, Cornerstone3D, vtk.js, Orthanc, MONAI,
  nnU-Net, or other upstream projects where relevant.
- Keep the existing AmbientCT visual language and branding.
- Prefer small, testable increments over a grand rewrite.

## Key Research Signals

Use these sources as product and technical context:

- FDA K251514, Overjet CBCT Assist: 3D CBCT AI for structures, segmentation,
  measurements, and review-oriented workflow.
- FDA K212519, K231678, K241684, K241681: dental AI already exists for caries,
  periapical radiolucency, charting, and image enhancement workflows.
- DentalSegmentator: open-source 3D Slicer extension for CT/CBCT segmentation of
  maxilla, mandible, teeth, and mandibular canal.
- MONAI Label: interactive labeling and human-in-the-loop segmentation workflow.
- nnU-Net: strong baseline for medical image segmentation pipelines.
- Current best product path: anatomy segmentation first, mandibular canal and
  implant safety second, periodontal/periapical assist third, reporting fourth.

## Repo Context To Inspect First

Read these areas before editing:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docker-compose.yml`
- `config/ohif-config.js`
- `extensions/dental-cpr/src`
- `extensions/dental-tools/src`
- `modes/dental-cpr-mode/src`
- `tests/e2e`
- `mar-processor`
- `scripts`

Also check:

- `git status --short`
- available disk space before Docker-heavy work
- whether Docker Desktop responds
- current unit and E2E test commands

## Deliverable 1: AI Assist Architecture

Create or update a concise architecture document:

- Suggested path: `docs/AI-ASSIST-ARCHITECTURE.md`
- Explain the local-only design.
- Define the AI pipeline:
  - input quality check
  - DICOM/volume normalization
  - anatomy segmentation
  - measurement extraction
  - finding suggestions
  - human review
  - structured report draft
  - audit log
- Define a clear boundary between open-source research assist and regulated
  clinical modules.
- Include a phased roadmap:
  - 0-3 months
  - 3-6 months
  - 6-12 months
- Include risk controls:
  - uncertainty display
  - out-of-distribution detection
  - scanner/protocol drift notes
  - PHI-safe logs
  - feature flags

## Deliverable 2: Structured AI Data Model

Implement a small, typed data model for AI results.

Suggested path:

- `extensions/dental-cpr/src/ai/types.ts`
- `extensions/dental-cpr/src/ai/fixtures.ts`
- `extensions/dental-cpr/src/ai/findingsStore.ts`

The model should cover:

- AI job status: `queued`, `running`, `review_required`, `completed`, `failed`
- anatomy segmentation classes:
  - mandible
  - maxilla
  - tooth
  - mandibular_canal
  - maxillary_sinus
- finding classes:
  - periodontal_bone_loss
  - periapical_radiolucency
  - caries_suspected
  - sinus_opacity
  - tmj_degeneration_suspected
- confidence score
- uncertainty level
- reviewer state: `unreviewed`, `accepted`, `rejected`, `edited`
- measurement payloads:
  - distance_mm
  - area_mm2
  - volume_mm3
  - tooth_number
  - canal_distance_mm
- source metadata:
  - model id
  - model version
  - createdAt
  - studyInstanceUID
  - seriesInstanceUID if available

Keep this format serializable as JSON and suitable for future Orthanc metadata
or local database persistence.

## Deliverable 3: AI Assist UI Surface

Add a non-invasive AI panel to the dental viewer workflow.

Suggested behavior:

- Add a right-side or collapsible panel named `AI Assist`.
- Show job status and reviewed/unreviewed findings.
- Use demo fixture data only when no real inference results exist.
- Clearly mark demo data as demo.
- Show confidence and uncertainty without overpromising.
- Allow the user to mark a suggested finding as accepted/rejected.
- Keep interaction local in the browser for now.
- Do not block existing Dental Tools.

If the existing right panel is crowded, create a tabbed panel or a compact
section in the existing dental tools area. Follow the current UI style.

## Deliverable 4: Local Inference Adapter Stub

Create a local inference adapter abstraction, but do not add heavy dependencies
yet.

Suggested path:

- `extensions/dental-cpr/src/ai/inferenceClient.ts`

It should support:

- `startAiAssistJob(studyInstanceUID)`
- `getAiAssistJob(studyInstanceUID)`
- `getAiFindings(studyInstanceUID)`
- `reviewFinding(findingId, state)`

For now, back it with localStorage or a lightweight browser-side mock. Structure
it so a future local service can replace it through a base URL config.

Recommended future local service shape:

- HTTP service on Docker network only
- no public host port by default
- accepts study UID, fetches DICOM from Orthanc using internal credentials
- writes derived masks/findings back as DICOM SEG/SR or Orthanc metadata
- exposes only sanitized status/results to the viewer

## Deliverable 5: Tests

Add focused tests for the data model and inference adapter.

Run at minimum:

- `npm test --workspace=@ambientwork/ohif-extension-dental-cpr`
- `npm test --workspace=@ambientwork/ohif-extension-dental-tools`

If Docker is healthy and disk space allows, also run:

- `./scripts/smoke-test.sh --verbose`
- Playwright E2E for the dental workflow

If Docker is not healthy, do not pretend it passed. Record the blocker and still
run all non-Docker tests.

## Deliverable 6: Documentation

Update docs so a maintainer understands what exists and what is intentionally
mocked.

Minimum docs:

- architecture document from Deliverable 1
- a short "AI Assist status" section in `README.md`
- implementation notes for future model integration

Use careful wording:

- "AI-assisted review"
- "suggested findings"
- "requires clinician confirmation"
- "research preview"

Avoid:

- "diagnoses disease"
- "detects all pathology"
- "clinical-grade"
- "FDA approved"

## Suggested Execution Order

1. Inspect repo and write a 5-10 line plan.
2. Implement AI data model and fixtures.
3. Implement local inference adapter.
4. Add AI Assist UI surface with fixture-backed results.
5. Add tests.
6. Add docs.
7. Run tests.
8. Summarize changes, verification, and remaining risks.

## Acceptance Criteria

The work is complete only when:

- AmbientCT still builds at the TypeScript/Jest level.
- Existing dental viewer flows are not broken.
- AI Assist appears in the viewer or dental tools UI.
- Demo findings are visibly marked as demo/research preview.
- The data model supports future real model output.
- Review state can be changed locally.
- Tests cover the AI model/store/client behavior.
- Documentation states that this is not autonomous diagnosis.

## Final Response Format

Report:

- what changed
- where the key files are
- which tests ran and their result
- what remains mocked
- next recommended real-model integration step

Keep the answer concise and concrete.
