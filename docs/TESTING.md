# Testing — AmbientCT

## Smoke test (after every change)
```bash
./tests/smoke-test.sh
```

Expected output:
```
✓ Orthanc responding on :8042
✓ Orthanc DICOMweb endpoint accessible
✓ OHIF responding on :3000
✓ DICOM upload via REST API succeeds
✓ Study appears in OHIF study list
```

## Manual test (after UI changes)
1. Open http://localhost:3000
2. Drag a .dcm file into the browser
3. Verify study appears in list
4. Open study → MPR view should load
5. Check Window/Level presets in dropdown (Bone, Soft Tissue, etc.)

## Test data
Not committed to repo. Download with:
```bash
./scripts/download-test-data.sh
```
This fetches anonymized sample DICOMs to `tests/dicom-test-data/` (gitignored).
