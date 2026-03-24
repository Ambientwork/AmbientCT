# Show HN Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AmbientCT GitHub-star-worthy for a Show HN post — visual hero, contributor docs, polished issue templates, GitHub topics.

**Architecture:** 4 independent tasks, no shared state. Each can be committed separately. No code changes — documentation and GitHub metadata only. SVG stored as a file and referenced via `<img>` so it renders on GitHub.

**Tech Stack:** SVG (hand-crafted, no emoji in `<text>` nodes — GitHub's SVG proxy does not render emoji reliably), GitHub Flavored Markdown, GitHub Issue Forms (YAML), `gh` CLI for topics.

**Spec:** `docs/superpowers/specs/2026-03-23-show-hn-ready-design.md`

---

## File Map

| File | Action | Task |
|------|--------|------|
| `docs/assets/hero.svg` | Create | Task 1 |
| `README.md` | Modify (hero + blockquote) | Task 1 |
| `CONTRIBUTING.md` | Create | Task 2 |
| `.github/ISSUE_TEMPLATE/bug.yml` | Modify | Task 3 |
| `.github/ISSUE_TEMPLATE/feature.yml` | Modify | Task 3 |
| GitHub repo topics | Set via `gh` | Task 4 |

---

## Task 1: SVG Hero + Show HN Hook in README

**Files:**
- Create: `docs/assets/hero.svg`
- Modify: `README.md`

### SVG design notes
- 700x320px, dark `#0d1117` background (GitHub dark theme)
- Font: `'Courier New', Courier, monospace` — NO emoji in `<text>` (GitHub's SVG proxy drops them)
- Status indicators: small green `<circle>` SVG elements instead of `✓` character
- Left panel (200px): patient list + preset selector
- Right panel (500px): CBCT axial scan with gray gradient ellipses, crosshair, measurement annotation
- Tab bar: Axial (active, blue underline) | Sagittal | Coronal | 3D Vol
- Bottom status bar: green circles + text labels

- [ ] **Step 1: Create `docs/assets/` directory**

```bash
mkdir -p docs/assets
```

- [ ] **Step 2: Create `docs/assets/hero.svg`**

Write the following to `docs/assets/hero.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="700" height="320" viewBox="0 0 700 320">
  <defs>
    <style>text { font-family: 'Courier New', Courier, monospace; }</style>
  </defs>

  <!-- Background -->
  <rect width="700" height="320" fill="#0d1117" rx="8"/>

  <!-- Header bar -->
  <rect width="700" height="36" fill="#161b22" rx="8"/>
  <rect y="16" width="700" height="20" fill="#161b22"/>
  <!-- Window controls -->
  <circle cx="20" cy="18" r="6" fill="#ff5f57"/>
  <circle cx="40" cy="18" r="6" fill="#febc2e"/>
  <circle cx="60" cy="18" r="6" fill="#28c840"/>
  <!-- Title -->
  <text x="350" y="23" fill="#8b949e" font-size="12" text-anchor="middle">AmbientCT  --  DICOM Viewer  --  http://localhost:3000</text>

  <!-- Left panel -->
  <rect x="0" y="36" width="200" height="268" fill="#0d1117"/>
  <rect x="0" y="36" width="200" height="28" fill="#161b22"/>
  <text x="10" y="54" fill="#e6edf3" font-size="11" font-weight="bold">PATIENTS</text>

  <!-- Active patient row -->
  <rect x="4" y="70" width="192" height="22" fill="#1f6feb" rx="4"/>
  <text x="12" y="84" fill="#ffffff" font-size="11">&gt; Mueller, A.   CBCT</text>
  <text x="12" y="106" fill="#8b949e" font-size="11">  Schmidt, B.   OPG</text>
  <text x="12" y="126" fill="#8b949e" font-size="11">  Weber, C.     CBCT</text>
  <text x="12" y="146" fill="#8b949e" font-size="11">  Fischer, D.   CT</text>

  <!-- Preset section -->
  <rect x="0" y="160" width="200" height="1" fill="#30363d"/>
  <text x="10" y="178" fill="#8b949e" font-size="10">WINDOW PRESET</text>
  <rect x="8" y="184" width="184" height="24" fill="#21262d" rx="4" stroke="#30363d" stroke-width="1"/>
  <text x="16" y="200" fill="#e6edf3" font-size="11">Bone (W:2000 / L:500)  v</text>

  <text x="10" y="228" fill="#8b949e" font-size="10">TOOLS</text>
  <rect x="8" y="234" width="56" height="22" fill="#21262d" rx="4" stroke="#30363d" stroke-width="1"/>
  <text x="14" y="249" fill="#e6edf3" font-size="10">W/L</text>
  <rect x="72" y="234" width="56" height="22" fill="#21262d" rx="4" stroke="#30363d" stroke-width="1"/>
  <text x="80" y="249" fill="#e6edf3" font-size="10">Zoom</text>
  <rect x="136" y="234" width="56" height="22" fill="#21262d" rx="4" stroke="#30363d" stroke-width="1"/>
  <text x="144" y="249" fill="#e6edf3" font-size="10">Length</text>

  <!-- Panel divider -->
  <rect x="200" y="36" width="1" height="268" fill="#30363d"/>

  <!-- Right panel -->
  <rect x="201" y="36" width="499" height="268" fill="#0d1117"/>

  <!-- Tab bar -->
  <rect x="201" y="36" width="499" height="28" fill="#161b22"/>
  <rect x="201" y="36" width="90" height="28" fill="#0d1117"/>
  <text x="246" y="54" fill="#e6edf3" font-size="11" text-anchor="middle">Axial</text>
  <text x="336" y="54" fill="#8b949e" font-size="11" text-anchor="middle">Sagittal</text>
  <text x="426" y="54" fill="#8b949e" font-size="11" text-anchor="middle">Coronal</text>
  <text x="516" y="54" fill="#8b949e" font-size="11" text-anchor="middle">3D Vol</text>
  <!-- Active tab underline -->
  <rect x="201" y="62" width="90" height="2" fill="#3b82f6"/>

  <!-- CBCT scan: skull cross-section -->
  <ellipse cx="450" cy="175" rx="165" ry="138" fill="#111827"/>
  <ellipse cx="450" cy="175" rx="145" ry="120" fill="#1e2433"/>
  <ellipse cx="450" cy="175" rx="143" ry="118" fill="none" stroke="#6b7280" stroke-width="7"/>
  <ellipse cx="450" cy="175" rx="125" ry="102" fill="#141b2e"/>

  <!-- Teeth (bright on axial view) -->
  <rect x="402" y="222" width="96" height="28" fill="#374151" rx="3"/>
  <rect x="405" y="224" width="13" height="20" fill="#6b7280" rx="2"/>
  <rect x="421" y="224" width="13" height="24" fill="#9ca3af" rx="2"/>
  <rect x="437" y="225" width="13" height="23" fill="#6b7280" rx="2"/>
  <rect x="453" y="224" width="13" height="24" fill="#9ca3af" rx="2"/>
  <rect x="469" y="224" width="13" height="20" fill="#6b7280" rx="2"/>
  <rect x="485" y="226" width="10" height="18" fill="#4b5563" rx="2"/>

  <!-- Mandibular canal (blue dashed line) -->
  <path d="M 397 248 Q 450 262 503 248" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="5,3"/>

  <!-- Crosshair -->
  <line x1="450" y1="90" x2="450" y2="265" stroke="#22c55e" stroke-width="1" opacity="0.6"/>
  <line x1="305" y1="175" x2="595" y2="175" stroke="#22c55e" stroke-width="1" opacity="0.6"/>
  <circle cx="450" cy="175" r="5" fill="none" stroke="#22c55e" stroke-width="1.5"/>

  <!-- Length measurement -->
  <line x1="388" y1="138" x2="512" y2="138" stroke="#facc15" stroke-width="1.5"/>
  <line x1="388" y1="133" x2="388" y2="143" stroke="#facc15" stroke-width="1.5"/>
  <line x1="512" y1="133" x2="512" y2="143" stroke="#facc15" stroke-width="1.5"/>
  <text x="450" y="133" fill="#facc15" font-size="10" text-anchor="middle">42.3 mm</text>

  <!-- Status bar -->
  <rect x="0" y="298" width="700" height="22" fill="#161b22"/>
  <!-- Status indicators: green circles instead of emoji -->
  <circle cx="18" cy="309" r="4" fill="#22c55e"/>
  <text x="27" y="314" fill="#22c55e" font-size="10">Orthanc PACS</text>
  <circle cx="118" cy="309" r="4" fill="#22c55e"/>
  <text x="127" y="314" fill="#22c55e" font-size="10">DICOMweb</text>
  <circle cx="200" cy="309" r="4" fill="#22c55e"/>
  <text x="209" y="314" fill="#22c55e" font-size="10">Auth</text>
  <text x="688" y="314" fill="#8b949e" font-size="10" text-anchor="end">v1.0.0</text>
</svg>
```

- [ ] **Step 3: Update README.md — replace Screenshots section**

In `README.md`, find and replace exactly:

```
## Screenshots

<!-- TODO: Add screenshots -->
| OHIF Viewer | 3D Volume Rendering | MPR View |
|:-----------:|:-------------------:|:--------:|
| *(screenshot)* | *(screenshot)* | *(screenshot)* |
```

With:

```
## Interface

<div align="center">
<img src="docs/assets/hero.svg" width="700" alt="AmbientCT DICOM Viewer — patient list, CBCT axial view, dental presets" />
</div>
```

- [ ] **Step 4: Add Show HN hook blockquote**

In `README.md`, insert between the closing `</div>` (line after `with 3D volume rendering, MPR, and measurement tools.`) and the first `---` divider:

```

> A dentist built a full PACS server with zero programming background — using AI coding tools.
> One Docker command. Zero license fees. Patient data stays on your hardware.

```

**Expected final state** of the README header section after both edits:

```markdown
<div align="center">

# 🦷 AmbientCT

**Your practice PACS in a box — zero license fees, zero cloud dependency, one command.**

[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://github.com/Ambientwork/AmbientCT)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Ambientwork/AmbientCT?style=social)](https://github.com/Ambientwork/AmbientCT/stargazers)

A free, open-source DICOM viewer for dental and medical practices.
View CBCT, CT, MRI, OPG and all DICOM formats in your browser —
with 3D volume rendering, MPR, and measurement tools.

</div>

> A dentist built a full PACS server with zero programming background — using AI coding tools.
> One Docker command. Zero license fees. Patient data stays on your hardware.

---

## Interface

<div align="center">
<img src="docs/assets/hero.svg" width="700" alt="AmbientCT DICOM Viewer — patient list, CBCT axial view, dental presets" />
</div>

---
```

- [ ] **Step 5: Commit**

```bash
git add docs/assets/hero.svg README.md
git commit -m "feat(readme): SVG hero and Show HN hook"
```

---

## Task 2: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create `CONTRIBUTING.md`**

Write the following to `CONTRIBUTING.md`:

```markdown
# Contributing to AmbientCT

Built by a dentist, for dental practices.
You don't need to be a DICOM expert to contribute — good ideas, bug reports, and documentation improvements are just as valuable as code.

---

## Ways to Contribute

- **Bug fixes** — Anything in [Issues](https://github.com/Ambientwork/AmbientCT/issues) with the `bug` label
- **Features** — Check [Issues](https://github.com/Ambientwork/AmbientCT/issues) for open feature requests first
- **Documentation** — Setup guides, troubleshooting tips, usage examples
- **Dental presets** — New Window/Level presets for specific imaging modalities (CBCT, DVT, OPG)
- **Translations** — UI strings or documentation in other languages

---

## Good First Issues

New to the project? Look for issues labeled [`good-first-issue`](https://github.com/Ambientwork/AmbientCT/issues?q=label%3Agood-first-issue).

These are scoped, well-described tasks with no hidden complexity. If you get stuck, comment on the issue — we'll help.

---

## Dev Setup

1. **Fork and clone**
   ```bash
   git clone https://github.com/<your-username>/AmbientCT.git
   cd AmbientCT
   ```

2. **Create your `.env`**
   ```bash
   cp .env.example .env
   ```

3. **Set a strong password** — edit `.env` and change `ORTHANC_PASSWORD` to something secure,
   or let the setup wizard generate one automatically:
   ```bash
   ./scripts/setup.sh
   ```

4. **Start the stack**
   ```bash
   docker compose up -d
   ```

5. **Open the viewer** at http://localhost:3000

The stack takes ~30 seconds to become healthy. Run `docker compose logs -f` to watch startup.

---

## Branch & Commit Style

**Branch naming:**
```
Ambientwork/short-description
```
Examples: `Ambientwork/fix-ohif-config`, `Ambientwork/add-mri-preset`

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | When |
|--------|------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Tooling, deps, CI |
| `refactor:` | No behavior change |

---

## Before You Submit a PR

- [ ] `./scripts/smoke-test.sh` passes locally
- [ ] No `.dcm`, `.env`, or patient data files in the diff
- [ ] No log snippets containing patient names, IDs, or dates of birth
- [ ] `docs/` updated if behavior changed

---

## Patient Data Rule (DSGVO / GDPR)

**Never include patient data in any form.**

This means: no DICOM image files, no log snippets with patient names/IDs/dates of birth, no screenshots with PHI (Protected Health Information), no filenames derived from patient names.

This is a legal requirement under DSGVO (EU) / GDPR. Any PR containing patient data will be closed immediately and the data reported for removal from git history.

If your logs contain patient data, scrub them first:
```bash
python3 scripts/scrub.py your-logfile.txt
```

---

## Code of Conduct

Be kind. This project is used in healthcare settings. Treat other contributors with the same care you'd want shown to patients.

---

<div align="center">

**By [Ambientwork](https://ambientwork.ai)** — the better OS for dental practices.

MIT License · Made with AI and coffee.

</div>
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md"
```

---

## Task 3: Issue Template Enhancements

**Files:**
- Modify: `.github/ISSUE_TEMPLATE/bug.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature.yml`

- [ ] **Step 1: Rewrite `.github/ISSUE_TEMPLATE/bug.yml`**

Replace the entire file with:

```yaml
name: Bug Report
description: Something is not working correctly
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        > **Patient Data / DSGVO:** Before submitting, ensure your logs and screenshots contain **no patient names, IDs, dates of birth, or any other PHI**. Run `python3 scripts/scrub.py <logfile>` to scrub logs automatically.

  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Start the stack with `docker compose up`
        2. Open http://localhost:3000
        3. Upload a DICOM file
        4. ...
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      placeholder: What should happen?

  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      placeholder: What happens instead?

  - type: textarea
    id: logs
    attributes:
      label: Logs (scrubbed)
      placeholder: Paste relevant logs here (scrubbed of patient data)
      render: shell

  - type: input
    id: ambientct_version
    attributes:
      label: AmbientCT Version
      placeholder: "Run: cat VERSION  — e.g. 1.0.0"

  - type: input
    id: docker_version
    attributes:
      label: Docker Version
      placeholder: "Run: docker --version"

  - type: input
    id: compose_version
    attributes:
      label: Docker Compose Version
      placeholder: "Run: docker compose version"

  - type: input
    id: browser
    attributes:
      label: Browser
      placeholder: "e.g. Chrome 123 / macOS 14.4"

  - type: input
    id: os
    attributes:
      label: Operating System
      placeholder: "macOS 15.3 / Ubuntu 24.04 / Windows 11"
```

- [ ] **Step 2: Rewrite `.github/ISSUE_TEMPLATE/feature.yml`**

Replace the entire file with:

```yaml
name: Feature Request
description: Suggest a new feature for AmbientCT
labels: ["enhancement"]
body:
  - type: textarea
    id: description
    attributes:
      label: What should be built?
      placeholder: Describe the feature clearly...
    validations:
      required: true

  - type: textarea
    id: current_workflow
    attributes:
      label: Your current workflow
      placeholder: "How do you handle this today? What workaround do you use?"

  - type: dropdown
    id: priority
    attributes:
      label: Priority
      options:
        - "High — need this week"
        - "Medium — need this month"
        - "Low — nice to have"

  - type: dropdown
    id: component
    attributes:
      label: Component
      options:
        - "OHIF Viewer (Frontend)"
        - "Orthanc (PACS Backend)"
        - "Docker / Infrastructure"
        - "Scripts / CLI"
        - "Documentation"
        - "Landing Page"

  - type: dropdown
    id: would_contribute
    attributes:
      label: Would you contribute this feature?
      options:
        - "Yes — I'll open a PR"
        - "Maybe — with guidance"
        - "No — just a suggestion"

  - type: textarea
    id: acceptance
    attributes:
      label: Done when...
      placeholder: "It is done when..."
```

- [ ] **Step 3: Commit**

```bash
git add .github/ISSUE_TEMPLATE/bug.yml .github/ISSUE_TEMPLATE/feature.yml
git commit -m "feat(github): enhance issue templates with DSGVO warning, version fields, workflow field"
```

---

## Task 4: GitHub Topics + PR

**Files:** GitHub repo metadata (no file changes in repo)

- [ ] **Step 1: Set topics via `gh` CLI**

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

Expected: command exits 0, no error output.

- [ ] **Step 2: Verify topics**

```bash
gh repo view Ambientwork/AmbientCT --json repositoryTopics -q '.repositoryTopics[].name'
```

Expected: 10 lines output (one topic per line).

- [ ] **Step 3: If `gh` fails**

Go to https://github.com/Ambientwork/AmbientCT → click the gear icon next to "About" → add the 10 topics manually. This does not block the PR.

- [ ] **Step 4: Push and create PR**

```bash
git push -u origin Ambientwork/show-hn-ready

gh pr create \
  --base main \
  --title "feat: Show HN ready — SVG hero, CONTRIBUTING, issue templates, topics" \
  --body "$(cat <<'EOF'
## Summary

- SVG hero image (700x320, dark theme) replacing screenshot placeholders in README
- Show HN hook blockquote in README header section
- CONTRIBUTING.md: dev setup, dental preset contribution, DSGVO rule, good-first-issue section
- Bug report template: DSGVO warning markdown block at top + version/browser fields
- Feature request: current-workflow + would-contribute fields
- GitHub topics: dicom, pacs, dental, ohif, medical-imaging, docker, open-source, orthanc, cbct, self-hosted

## Test plan
- [ ] `docs/assets/hero.svg` renders correctly when opened in a browser
- [ ] README renders correctly on GitHub after push (check Preview tab on GitHub)
- [ ] CONTRIBUTING.md section headers render correctly
- [ ] Bug report form shows DSGVO warning block at the top
- [ ] Feature request form shows "Would you contribute?" dropdown
- [ ] GitHub topics appear on repo homepage

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
