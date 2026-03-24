# Show HN Ready — AmbientCT
**Date:** 2026-03-23
**Branch:** Ambientwork/show-hn-ready
**Status:** Approved by user (v2 — post spec-review fixes)

---

## Goal

Make AmbientCT GitHub-star-worthy and ready for a Show HN post. The project is v1.0.0, MIT-licensed, and built by a dentist using AI tools. The goal is to communicate that story compellingly and lower the barrier for contributors.

---

## Deliverables

### 1. README.md — Hero Upgrade

#### SVG Hero (Issue 1 fix: file-based, not inline)

- Create `docs/assets/hero.svg` containing a terminal-style DICOM viewer mockup
- Reference it in README.md with: `<img src="docs/assets/hero.svg" width="700" alt="AmbientCT DICOM Viewer Interface" />`
- The `<img>` tag goes inside the `<div align="center">` block, after the description paragraph and before the closing `</div>`
- SVG specs: 700×320px viewport, dark background (#0d1117, matching GitHub dark mode), monospace font (Courier New / monospace), blue accent (#3b82f6), green status indicators (#22c55e)
- No `foreignObject` (not supported in GitHub SVG rendering)
- Content: left panel (patient list, preset selector), right viewport (CBCT scan ASCII representation, MPR labels), bottom status bar

#### Show HN Hook Paragraph (Issue 4 fix: explicit placement)

Insert after the closing `</div>` of the centered header block (after the badges/description div), before the first `---` divider:

```
> A dentist built a full PACS server with zero programming background — using AI coding tools.
> One Docker command. Zero license fees. Patient data stays on your hardware.
```

(Use a blockquote `>` so it renders with visual emphasis.)

#### Keep all existing sections unchanged.

---

### 2. CONTRIBUTING.md (new file, root level)

Sections in order:

1. **Welcome** — "Built by a dentist, for dental practices. You don't need to be a DICOM expert to contribute."
2. **Ways to Contribute** — Bug fixes, features, docs, dental Window/Level presets, translations
3. **Dev Setup** — 4 explicit steps:
   ```
   1. Fork + clone the repo
   2. cp .env.example .env
   3. Edit .env — change ORTHANC_PASSWORD to something strong (or run ./scripts/setup.sh)
   4. docker compose up -d
   5. Open http://localhost:3000
   ```
   Include the credential-edit reminder explicitly (Issue 5 fix).
4. **Branch & Commit Style** — `Ambientwork/<short-name>`, conventional commits (`feat:`, `fix:`, `docs:`)
5. **Before You PR** — `./scripts/smoke-test.sh` must pass; no `.dcm`, no patient images, no logs, no `.env`
6. **DSGVO / Patient Data Rule** — Hard rule block: "⚠️ NEVER include patient data — no DICOM files, no log snippets with patient names/IDs/DOB, no screenshots with PHI. This is a legal requirement (DSGVO/GDPR)."
7. **Good First Issues** — Explains `good-first-issue` label, links to `https://github.com/Ambientwork/AmbientCT/issues?q=label%3Agood-first-issue`
8. **Footer** — "By Ambientwork · MIT License · Made with 🤖 and ☕"

---

### 3. Issue Template Enhancements

#### `.github/ISSUE_TEMPLATE/bug.yml`

**DSGVO reminder placement (Issue 2 fix):**
- Add a `- type: markdown` block as the **first element** in the `body:` array with the DSGVO scrub warning
- Remove the `description:` sub-field from the `logs` textarea (the top-level markdown block makes it redundant)

**New fields to add after "Actual behavior" textarea:**

| Field ID | Type | Label | Placeholder | Required |
|----------|------|-------|-------------|----------|
| `ambientct_version` | input | AmbientCT Version | `cat VERSION` — e.g. `1.0.0` | false |
| `docker_version` | input | Docker Version | `docker --version` output | false |
| `compose_version` | input | Docker Compose Version | `docker compose version` output | false |
| `browser` | input | Browser | e.g. `Chrome 123 / macOS 14` | false |

All four are `required: false` — don't block reporters with mandatory fields. (Issue 6 fix.)

#### `.github/ISSUE_TEMPLATE/feature.yml`

Add after "What should be built?":

| Field ID | Type | Label | Placeholder | Required |
|----------|------|-------|-------------|----------|
| `current_workflow` | textarea | Your current workflow | "How do you handle this today?" | false |
| `would_contribute` | dropdown | Would you contribute this? | — | false |

`would_contribute` dropdown options: `Yes — I'll open a PR`, `Maybe — with guidance`, `No — just a suggestion`

---

### 4. GitHub Topics

**Command:**
```bash
gh repo edit Ambientwork/AmbientCT \
  --add-topic dicom \
  --add-topic pacs \
  --add-topic dental \
  --add-topic ohif \
  --add-topic medical-imaging \
  --add-topic docker \
  --add-topic open-source \
  --add-topic orthanc \
  --add-topic cbct \
  --add-topic self-hosted
```

**Fallback (Issue 3 fix):** If `gh repo edit` fails due to permissions, document fallback: "Go to https://github.com/Ambientwork/AmbientCT → Settings → scroll to 'Topics' → add manually." Log the failure but don't abort the PR.

---

## Files Changed

| File | Action |
|------|--------|
| `README.md` | Add SVG `<img>` reference, Show HN blockquote |
| `docs/assets/hero.svg` | Create new SVG hero image |
| `CONTRIBUTING.md` | Create new |
| `.github/ISSUE_TEMPLATE/bug.yml` | DSGVO markdown block, 4 new optional fields |
| `.github/ISSUE_TEMPLATE/feature.yml` | 2 new fields |
| GitHub repo topics | Set via `gh repo edit` (fallback: manual) |

## Non-Goals

- No actual screenshots (Docker stack not running in CI)
- No new CI workflows
- No changes to docker-compose, config, or scripts
