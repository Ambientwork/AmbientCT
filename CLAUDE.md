# CLAUDE.md — AmbientCT

## What is this?
Open-source DICOM viewer for dental/medical practices. Orthanc + OHIF in Docker.
GitHub: Ambientwork/AmbientCT. MIT License.

## Read these first (in order)
1. `docs/ARCHITECTURE.md` — Stack, decisions, constraints
2. `docs/CONVENTIONS.md` — Branch naming, commit style, PR format
3. `docs/STOPP.md` — What you must NEVER do (patient data, auth, security)
4. `docs/TESTING.md` — How to validate changes
5. `docs/HOOKS.md` — Session automation, DSGVO scrubbing, compact rules

## Critical: DSGVO Log Scrubbing
Before reading ANY log file, run: `python3 scripts/scrub.py <logfile>`
The session_start hook does this automatically for `logs/`.
See `docs/HOOKS.md` for details.

## Project structure
Run `find . -type f -name '*.md' | head -20` or `ls -la` to orient yourself.
Key directories: `config/`, `scripts/`, `docs/`, `tests/`, `landing/`.

## Model routing
- **Haiku**: File search, grep, simple config edits, formatting
- **Sonnet**: Multi-file changes, Docker config, script writing, tests
- **Opus**: Architecture decisions, security review, complex debugging

## Workflow
1. Read the relevant doc from the list above BEFORE coding
2. Create a plan. Say "Here is my plan:" and WAIT for approval
3. Implement only after plan is approved
4. Run `./tests/smoke-test.sh` before marking done
5. If unsure, ASK — don't guess

## Reference implementations
- OHIF official Docker recipe: `platform/app/.recipes/Nginx-Orthanc/`
- Orthanc config examples: https://orthanc.uclouvain.be/book/users/configuration.html
- Cornerstone3D examples: https://www.cornerstonejs.org/docs/examples

## Context management
- Run `/compact` after completing each major task
- This file is your re-entry point after compaction
