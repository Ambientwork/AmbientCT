# Testing — AmbientCT

> Updated 2026-08-28 (Phase 3b-2 / plan `docs/AUTONOMOUS-EXECUTION-PLAN-2026-08-28.md`, P7.1).
> Previous version of this file only covered the smoke test; it omitted the
> Jest, pytest, and E2E suites entirely. This version documents the exact
> commands for all of them, including the isolated test stack.

## Quick smoke test (after every change)

```bash
./scripts/smoke-test.sh
```

Expected output:
```
✓ Orthanc responding on :8042
✓ Orthanc DICOMweb endpoint accessible
✓ AmbientCT responding on :3000
✓ DICOM upload via REST API succeeds
✓ Study appears in AmbientCT study list
```

## Manual test (after UI changes)
1. Open http://localhost:3000
2. Drag a .dcm file into the browser
3. Verify study appears in list
4. Open study → MPR view should load
5. Check Window/Level presets in dropdown (Bone, Soft Tissue, etc.)

## Test data

Not committed to the repo. Either:
- `./scripts/download-test-data.sh` — fetches anonymized sample DICOMs to `tests/dicom-test-data/` (gitignored), or
- generate synthetic fixtures locally with `pydicom` (no network, no real patient data), or
- export the synthetic `PHANTOM DENTAL CBCT` study already present in the running Orthanc instance via a read-only REST call.

No real patient data may be used in any test, fixture, screenshot, or report.

---

## 1. Viewer / extension unit tests (Jest)

```bash
cd extensions/dental-cpr
../../node_modules/.bin/jest --runInBand
```

Runs the full extension unit suite (viewer layout, AI mode selection,
compare-layout derivation, URL/series-state helpers, geometry compatibility
checks, bounded-poll and volume-lookup logic). `--runInBand` avoids the
sandbox flakiness that comes with Jest's default worker-process parallelism
on this environment.

## 2. AI-inference unit tests (pytest)

The Python service targets Python 3.11 and does **not** assume the host
Python version matches. The reproducible way to run these tests is the
dedicated Docker `test` stage (P2.1) — it never requires torch/nnunetv2 at
collection time and always runs in demo mode:

```bash
docker build --target test -t ambientct/ai-inference:test ai-inference/
docker run --rm ambientct/ai-inference:test
# equivalent to: pytest tests -q, with AI_INFERENCE_DEMO_MODE=true forced
```

A host virtualenv also works if you match Python 3.11 and install both
`requirements.txt`/`requirements-test.txt` yourself, but the Docker `test`
stage is the canonical, CI-equivalent command — use it when reporting a
pass/fail result.

**Note (documented, not fixed):** `ai-inference/requirements.txt`'s `numpy`
pin (needed by `nnunetv2`) currently conflicts with `pydicom-seg`'s
`numpy<2.0.0` constraint, which blocks building the **production** runtime
image on some hosts. This does not affect the `test` stage, which uses the
separate, lighter `requirements-test.txt` and never imports torch/nnunetv2
at collection time.

## 3. Compose / config validation

```bash
git diff --check
docker compose config --quiet
```

## 4. Shellcheck

```bash
shellcheck scripts/*.sh
```

Run this against every changed shell script before committing.

## 5. Docker image builds

```bash
docker compose build viewer
docker build --target test -t ambientct/ai-inference:test ai-inference/
docker build -t ambientct/ai-inference:latest ai-inference/   # production runtime stage
```

After any viewer image build, open the app in a browser and take a
PHI-free screenshot (using only synthetic/phantom data) as a verification
artifact before considering the build "done" — do not rely on a green
build alone.

## 6. Isolated integration/E2E stack

E2E tests must never run against the primary AmbientCT Docker project —
they import data and exercise MAR generation, which would pollute a real
instance. Always use the isolated `ambientct-test` project defined by
`docker-compose.test.yml`:

```bash
# Start the isolated stack (own ports, own named volume, demo AI mode,
# AI_INFERENCE_PERSIST_DEMO_SEG=true only here):
docker compose -p ambientct-test \
  -f docker-compose.yml -f docker-compose.test.yml \
  up -d --build

# Run the E2E specs against it:
BASE_URL=http://localhost:3100 \
SAMPLE_DICOM=/absolute/path/to/an/anonymized/fixture.dcm \
npx playwright test tests/e2e/dental-cpr-ui.spec.js

BASE_URL=http://localhost:3100 \
npx playwright test tests/e2e/ai-assist-panel.spec.js

# Or via the root package.json convenience scripts (same BASE_URL):
yarn e2e:isolated tests/e2e/dental-cpr-ui.spec.js
yarn e2e:isolated tests/e2e/ai-assist-panel.spec.js

# Tear down — ONLY ever with -p ambientct-test AND both -f files together,
# never against the primary project:
docker compose -p ambientct-test \
  -f docker-compose.yml -f docker-compose.test.yml \
  down -v
```

`SAMPLE_DICOM` defaults to a path under `dicom-import/` relative to the repo
root; tests that need it `test.skip()` with a clear message if the fixture
is missing rather than failing opaquely. `ai-assist-panel.spec.js` is
frontend/mock-only and needs no fixture.

Before tearing down, double-check the compose project name is exactly
`ambientct-test` in the command you are about to run — `down -v` against
the primary project's compose files would delete the production Orthanc
volume (`ambientct_orthanc-db`), which is never permitted.

### What is (and isn't) covered by the current E2E run

As of 2026-08-28: 6 of 8 `dental-cpr-ui.spec.js` scenarios and 4 of 4
`ai-assist-panel.spec.js` scenarios pass against the isolated stack. The 2
MAR-compare-grid-visibility scenarios did not complete within practical
timeouts in this environment (concurrent two-full-series CBCT loading) — see
`docs/DENTAL-VIEWER-FEATURE-MATRIX-AND-PLAN.md` and
`docs/AUTONOMOUS-EXECUTION-PLAN-2026-08-28.md`'s phase reports for the exact,
dated numbers and root-cause notes. Re-run on faster hardware/network to
close that gap.

## 7. AI demo pipeline / DICOM SEG roundtrip (part of the isolated stack)

With the isolated stack from step 6 running and `AI_INFERENCE_PERSIST_DEMO_SEG=true`:

```bash
# import a synthetic/phantom study into the isolated Orthanc (8142), then:
curl -sX POST http://localhost:3100/api/ai/jobs \
  -H 'Content-Type: application/json' \
  -d '{"studyInstanceUID": "<uid>"}'

curl -s http://localhost:3100/api/ai/jobs/<jobId>   # poll until review_required

# verify the persisted SEG in the isolated Orthanc, then re-download and
# validate it with pydicom (Modality=SEG, correct SOP Class UID, matching
# StudyInstanceUID/FrameOfReferenceUID, per-frame source-instance
# references resolving to real SOPInstanceUIDs in the source series).
```

Set `AI_INFERENCE_PERSIST_DEMO_SEG=false` (the default everywhere else) and
repeat to confirm nothing is written to Orthanc in that mode.

## 8. Real-model validation (Track B — separate from the above)

Not part of the standard Track A matrix. Requires model weights under
`data/ai-models/`, which are never downloaded automatically:

```bash
bash scripts/download-models.sh --help
bash scripts/download-models.sh --verify-only
bash scripts/download-models.sh --yes   # only with explicit authorization
```

Without downloaded/authorized weights, this stays `pending_external_artifact`
and does not block a Track A pass. See `ai-inference/README.md`.

## 9. Log handling during any of the above

Never read a raw log file. Export the relevant section to a file first,
then scrub it:

```bash
python3 scripts/scrub.py <exported-log-file>
```

Only read the scrubbed output.
