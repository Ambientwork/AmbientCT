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

## Disjoint Scopes (for parallel Conductor sessions)
Each scope is independent — agents should ONLY touch files in their assigned scope.
- **Scope A**: `config/ohif-config.js` — Dental Presets, Viewer Config
- **Scope B**: `scripts/` — setup.sh, backup.sh, smoke-test.sh, import-dicom.sh
- **Scope C**: `landing/` — Landing Page for GitHub Pages
- **Scope D**: `docs/` — ARCHITECTURE.md, SETUP-GUIDE.md, TROUBLESHOOTING.md
- **Scope E**: `docker-compose.yml` + `.env.example` — Infrastructure
- **Scope F**: `README.md` — Hero-Readme with badges, screenshots, quick start
- **Scope G**: `.github/workflows/` — CI, Pages, Release, Notify

## gstack Workflow
Use gstack commands for every non-trivial task:
- `/office-hours` — Brainstorm, product diagnostic, design doc
- `/plan-eng-review` — Architecture, data flow, edge cases, tests
- `/review` — Staff engineer PR review, adversarial mode
- `/investigate` — Debug with investigation-first approach
- `/ship` — PR, tests, deploy, verify

Design Doc: `~/.gstack/projects/Ambientwork-AmbientCT/`
Search Before Building. Always.

## superpowers
When superpowers MCP is available, use it for:
- Extended thinking on complex architecture decisions
- Multi-file refactoring with full context
- Security review of Docker and auth configurations

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

## Agent Harness Optimierung

### Reasoning Sandwich
Bei komplexen Tasks: Plane ausführlich (Phase 1), implementiere effizient (Phase 2),
verifiziere gründlich (Phase 3). Investiere 40% der Tokens in Planung + Verifizierung.

### Self-Verification
Nach JEDEM Feature: Prüfe ob das Ergebnis die ursprüngliche Anforderung erfüllt.
Nicht nur "Tests grün" sondern "löst das tatsächlich das Problem?"
Checklist: 1) Tests grün? 2) Löst es das Problem? 3) Keine Regression? 4) Code clean?

### Execution Traces
Lies vorherige Logs in ~/dev/logs/agents/ bevor du ähnliche Tasks startest.
Lerne aus vergangenen Fehlern statt sie zu wiederholen.
