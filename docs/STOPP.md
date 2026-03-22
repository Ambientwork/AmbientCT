# STOPP — Things You Must NEVER Do

These rules are non-negotiable. Violating any of them is a blocking issue.

## Patient Data
- NEVER commit DICOM files or any PHI/PII to the repo
- NEVER include real patient names in screenshots, tests, or docs
- NEVER paste raw Orthanc/Docker logs into Claude without scrubbing first
  → Run `python3 scripts/scrub.py <logfile>` BEFORE sharing any log
  → The session_start hook does this automatically for logs/ directory
  → Risk: Orthanc logs contain PatientName, PatientID from DICOM headers
- ALWAYS use anonymized or synthetic test data

## Security
- NEVER expose Orthanc without authentication
- NEVER use `network_mode: host` in Docker
- NEVER hardcode credentials — all secrets via `.env` (gitignored)
- NEVER add external analytics, tracking, or telemetry

## Architecture
- NEVER add cloud dependencies — stack must work fully offline after `docker pull`
- NEVER commit files > 1MB (DICOM test data is downloaded, not committed)
- NEVER modify docker-compose.yml without running smoke tests

## Process
- ALWAYS create a plan before coding. Wait for approval.
- ALWAYS run `./tests/smoke-test.sh` before marking a task complete
- ALWAYS document decisions in `docs/ARCHITECTURE.md`
