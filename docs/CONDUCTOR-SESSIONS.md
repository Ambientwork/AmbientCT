# Conductor Session Plan — dental-pacs-box

## Übersicht

Dieses Dokument beschreibt die geplanten Conductor Sessions
für das dental-pacs-box Projekt. Jede Session ist ein abgeschlossener
Sprint mit definiertem Output und Content-Deliverable.

---

## Session 1: "Zero to PACS" (Tag 1, ~2h)

**Ziel:** Funktionierender Docker-Stack + professionelles GitHub Repo

### Agents (maximal 3 parallel wegen 16GB RAM)

| Agent | Branch | Task | Estimated Time |
|-------|--------|------|----------------|
| A1 — Infra | `feat/docker-polish` | docker-compose.yml finalisieren, Health Checks, .env Handling, docker-compose.dev.yml für Dev-Modus | 30 min |
| A2 — Docs | `docs/readme-and-setup` | README.md (pro-level GitHub Readme mit Badges, Screenshots-Platzhalter, Quick Start), docs/SETUP-GUIDE.md | 30 min |
| A3 — QA | `feat/smoke-tests` | scripts/smoke-test.sh, scripts/import-dicom.sh, Validierung dass alles zusammenspielt | 20 min |

### Review-Reihenfolge
1. Merge A1 (Infra) zuerst — Basis für alles
2. Merge A3 (QA) — Tests gegen die Infra laufen lassen
3. Merge A2 (Docs) — Doku basierend auf funktionierendem Stack

### Validierung
```bash
docker compose down -v && docker compose up -d
./scripts/smoke-test.sh
# Alle Checks grün → Tag "v0.1.0-alpha"
```

### Content Output
- Screen Recording: Conductor Dashboard mit 3 parallelen Agents
- Screenshot: OHIF Viewer mit geladenem DICOM
- Draft: Kurzer LinkedIn/Twitter Post

---

## Session 2: "Dental Presets" (Tag 2-3, ~2h)

**Ziel:** Dental-optimiertes Viewing-Erlebnis

### Agents

| Agent | Branch | Task |
|-------|--------|------|
| A1 — Presets | `feat/dental-presets` | Window/Level Presets validieren, dental-spezifisches Default-Layout (MPR view als Standard bei Volume-Daten), Hanging Protocols |
| A2 — Branding | `feat/branding` | Custom OHIF-Einstellungen: Titel, Logo-Platzhalter, Farbschema, Startseite-Text |
| A3 — Scripts | `feat/helper-scripts` | scripts/anonymize.sh (DICOM-Anonymisierung), scripts/backup.sh (DB + Images), --help für alle Scripts |

### Validierung
- CBCT-Daten laden → MPR View öffnet automatisch
- Window/Level Presets im Dropdown sichtbar
- "Bone", "Soft Tissue", "Dental Implant" Presets liefern sinnvolle Darstellung

---

## Session 3: "Ship It" (Tag 3-4, ~2h)

**Ziel:** Release-ready auf GitHub, Landing Page, erster Giveaway

### Agents

| Agent | Branch | Task |
|-------|--------|------|
| A1 — Landing | `feat/landing-page` | Statische Landing Page (landing/index.html), Hero Screenshot, Feature-Liste, Download/Clone CTA, GitHub Pages ready |
| A2 — Release | `chore/release-v1` | CHANGELOG.md, GitHub Release mit Tag v1.0.0, Release Notes, docker-compose Validierung auf fresh clone |
| A3 — Security | `fix/security-hardening` | gstack `/review` laufen lassen, Auth-Defaults härten, .env Validierung in setup.sh, CORS prüfen |

### Validierung
- Fresh `git clone` → `./scripts/setup.sh` → `docker compose up` → Funktioniert
- Landing Page sieht professionell aus auf GitHub Pages
- gstack Security Review hat keine kritischen Findings

### Content Output
- Blog Post Draft: "How I Built a Medical Imaging Server with 3 AI Agents"
- GitHub Repo öffentlich mit v1.0.0 Release
- Landing Page live

---

## Session 4+: "Beyond Dental" (Woche 2+, optional)

### Mögliche Erweiterungen
- Nginx + SSL + Let's Encrypt für Remote-Zugriff
- DICOM-Empfang direkt vom CBCT-Gerät (C-STORE SCP)
- Benutzer-Verwaltung (Orthanc + Keycloak)
- AI-Assistierte Befundung (Cornerstone3D Custom Tool)
- Mobile-Optimierung der OHIF-UI

---

## Parallel: WP AI-Readiness Sessions

Zwischen den dental-pacs Sessions kann derselbe Conductor-Setup
für wp-ai-readiness-saas genutzt werden. Einfach Workspace wechseln.

Conductor hält die Git Worktrees isoliert — kein Risiko der
Vermischung.

---

## RAM-Management (16GB Mac Mini)

### Während Conductor Sessions
- Docker Desktop: Auf 4-6GB limitieren (Settings → Resources)
- Maximal 3 Agents gleichzeitig
- Browser: nur 1 Tab für OHIF Testing
- OBS: nur wenn aktiv aufgenommen wird, sonst beenden

### Monitoring
```bash
# RAM-Nutzung live beobachten
top -l 1 -s 0 | head -20

# Docker-spezifisch
docker stats --no-stream
```

### Wenn es eng wird
1. Docker Container stoppen: `docker compose stop`
2. Conductor Agent pausieren (nicht alle 3 gleichzeitig laufen lassen)
3. OBS beenden wenn nicht aufgenommen wird
4. Browser Tabs schliessen
