# Conductor Task Prompts — AmbientCT

Copy-paste ready prompts for parallel Conductor sessions.
Each agent gets one disjoint scope — no merge conflicts.

---

## Session 1: Polish & Ship (3 Agents)

### AGENT 1 — Scope F: README.md

```
Mache README.md zu einem professionellen GitHub Readme.

Lies CLAUDE.md zuerst. Du arbeitest NUR an README.md (Scope F).

Anforderungen:
- Badges oben: Docker Pulls, License (MIT), GitHub Stars, GitHub Issues
- Tagline: "Dental PACS in a Box — zero license fees, zero cloud, one command."
- Feature-Liste mit Emojis (bereits vorhanden, polieren)
- Quick Start: exakt 3 Befehle (git clone, cp .env, docker compose up)
- Screenshots-Sektion mit Platzhalter-Kommentaren: <!-- TODO: Screenshot OHIF Viewer -->, <!-- TODO: Screenshot Dental Presets -->, <!-- TODO: Screenshot Study List -->
- "Dental Presets" Sektion: Tabelle der W/L Presets aus config/ohif-config.js
- "Architecture" Sektion: Mermaid Diagram (Orthanc ↔ OHIF ↔ Browser)
- "Built with AI" Sektion: Link zur Build Story, Conductor + Claude Code Erwähnung
- "By Ambientwork" Footer mit Link
- Sprachstil: Englisch, technisch aber zugänglich, kein Marketing-Slop

Lies config/ohif-config.js für die Dental Presets.
Lies docs/ARCHITECTURE.md für die Stack-Details.
```

### AGENT 2 — Scope B: Scripts

```
Verbessere alle Scripts in scripts/.

Lies CLAUDE.md zuerst. Du arbeitest NUR an Dateien in scripts/ (Scope B).

Für JEDES Script:
- Füge --help Flag hinzu das Usage, Beschreibung und Beispiele zeigt
- Füge set -euo pipefail am Anfang hinzu
- Füge farbige Ausgabe hinzu (grün=OK, rot=Fehler, gelb=Warnung)
- Prüfe Dependencies am Anfang (docker, curl, jq etc.)

setup.sh — Interaktiver Setup Wizard:
- Prüfe ob Docker installiert und läuft
- Generiere sicheres Orthanc-Passwort (openssl rand -base64 16)
- Erstelle .env aus .env.example mit generiertem Passwort
- Frage ob docker compose up gestartet werden soll
- Zeige URLs am Ende (Viewer: localhost:3000, Orthanc: localhost:8042)

smoke-test.sh — Teste alle Endpoints:
- Orthanc System API (GET /system mit Auth)
- Orthanc DICOMweb (GET /dicom-web/studies)
- OHIF Viewer (GET / auf Port 3000)
- Docker Container Health Status
- Zeige Summary: X/Y Tests passed

backup.sh — Docker Volumes sichern:
- Stoppe Container kurz für konsistenten Backup
- Backup orthanc-db Volume nach ./backups/backup-{date}.tar.gz
- Starte Container wieder
- Zeige Backup-Grösse und Pfad
- Optional: --restore Flag zum Wiederherstellen

import-dicom.sh — Bulk-Import:
- Akzeptiere Ordner-Pfad als Argument
- Finde alle .dcm Dateien rekursiv
- Upload via Orthanc REST API (POST /instances)
- Zeige Fortschritt (X/Y Dateien importiert)
- Summary am Ende: importiert, übersprungen, Fehler

Lies die bestehenden Scripts zuerst und verbessere sie — nicht von Null anfangen.
Teste mit: bash scripts/smoke-test.sh (sollte nach docker compose up funktionieren).
```

### AGENT 3 — Scope D: Documentation

```
Erstelle komplette Dokumentation in docs/.

Lies CLAUDE.md zuerst. Du arbeitest NUR an Dateien in docs/ (Scope D).

SETUP-GUIDE.md — Schritt-für-Schritt für nicht-technische Praxis-Admins:
- Voraussetzungen: Docker Desktop installieren (Mac/Windows/Linux Links)
- Installation: git clone, setup.sh ausführen
- Erster Start: docker compose up, Browser öffnen
- Erstes DICOM importieren: Drag & Drop in OHIF oder import-dicom.sh
- DICOM von Geräten empfangen: Orthanc DIMSE auf Port 4242, AE Title konfigurieren
- Dental Presets nutzen: W/L Dropdown im Viewer
- Backup einrichten: backup.sh, empfohlener Zeitplan
- Sprache: Deutsch, einfach, keine Fachbegriffe ohne Erklärung

TROUBLESHOOTING.md — Die 10 häufigsten Probleme:
1. Docker startet nicht / Container crashen
2. OHIF zeigt "No Studies Found"
3. DICOM Upload schlägt fehl
4. Viewer zeigt schwarzes Bild (falsche W/L)
5. Port 3000/8042 bereits belegt
6. Container restart loop
7. Langsame Performance bei grossen CBCT
8. DIMSE Verbindung vom Gerät geht nicht
9. Login/Auth Probleme
10. Backup/Restore funktioniert nicht
Für jedes Problem: Symptom, Ursache, Lösung mit konkreten Befehlen.
Sprache: Deutsch.

ARCHITECTURE.md — Aktualisieren (existiert bereits):
- Lies die bestehende Version zuerst
- Ergänze ein ASCII oder Mermaid Stack-Diagramm
- Ergänze Dental-Kontext: warum diese Architektur für Zahnarztpraxen
- Ergänze Datenfluss: DICOM Import → Orthanc → DICOMweb → OHIF → Browser
- Behalte bestehende Key Decisions Tabelle

Lies docs/ARCHITECTURE.md, docs/STOPP.md und docker-compose.yml für Kontext.
```

---

## Session 2: Landing Page + CI (2 Agents)

### AGENT 1 — Scope C: Landing Page

```
Erstelle eine professionelle Landing Page in landing/.

Lies CLAUDE.md zuerst. Du arbeitest NUR an Dateien in landing/ (Scope C).

Anforderungen:
- Single-page HTML, self-contained (inline CSS, kein CDN)
- Mobile-responsive
- Zielgruppe: Zahnärzte die nach PACS-Alternativen suchen + Developers
- Sprache: Englisch

Sektionen:
1. Hero: "Dental PACS in a Box" + Tagline + "Get Started" Button → GitHub Repo
2. Problem: "Your imaging software shouldn't cost more than your X-ray machine"
3. Features: 6 Features mit Icons (Unicode Emojis OK), kurze Beschreibung
4. How it works: 3 Steps (Clone → Configure → View)
5. Dental Presets: Visuell ansprechende Tabelle der W/L Presets
6. Screenshot Platzhalter: <!-- Screenshots kommen nach Sprint 1 -->
7. Open Source: MIT License, GitHub Link, Star Button
8. Built with AI: "Built by a dentist using Claude Code + Conductor"
9. Footer: Ambientwork Logo/Link, GitHub Link

Design:
- Clean, modern, medical/dental Ästhetik
- Farben: Weiss Hintergrund, Dunkelblau (#1a365d) Akzent, Teal (#2c7a7b) Buttons
- Schrift: System fonts (keine externen Fonts)
- Kein JavaScript nötig (pure HTML/CSS)
- Optimiert für GitHub Pages deployment

Lies config/ohif-config.js für die Dental Presets Werte.
Lies README.md für die Feature-Beschreibungen.
```

### AGENT 2 — Scope G: GitHub Actions

```
Erstelle GitHub Actions Workflows in .github/workflows/.

Lies CLAUDE.md zuerst. Du arbeitest NUR an Dateien in .github/workflows/ (Scope G).

Verbessere die bestehenden Workflows oder erstelle sie neu:

ci.yml — Continuous Integration:
- Trigger: push to main, pull_request
- Jobs: lint (shellcheck auf scripts/), docker-build (docker compose build), smoke-test
- Smoke test: docker compose up -d, warte auf health, scripts/smoke-test.sh, docker compose down

pages.yml — GitHub Pages Deployment:
- Trigger: push to main (nur wenn landing/ sich ändert)
- Deploy landing/index.html nach GitHub Pages
- Nutze actions/deploy-pages@v4

release.yml — Release Workflow:
- Trigger: tag push (v*)
- Erstelle GitHub Release mit Changelog
- Attache docker-compose.yml und .env.example als Assets

notify.yml — Notification:
- Trigger: nach successful ci.yml
- Optional: Telegram Notification via Bot API (URL aus Secret)
- Zeige: commit message, author, status

Lies die bestehenden Workflow-Dateien zuerst und verbessere sie.
Nutze neueste GitHub Actions Versionen (actions/checkout@v4 etc.).
```

---

## Session 3: Dental Features (2 Agents) — nach Sprint 0 Spike

### AGENT 1 — Scope A: OHIF Config

```
Optimiere config/ohif-config.js für den Dental Workflow.

Lies CLAUDE.md zuerst. Du arbeitest NUR an config/ohif-config.js (Scope A).

Lies das Design Doc: ~/.gstack/projects/Ambientwork-AmbientCT/john-main-design-*.md

Aufgaben:
- Custom Hanging Protocols für Dental: CBCT→MPR Layout, OPG→Single 2D, Intraoral→Grid
- Erweitere W/L Presets falls sinnvoll
- Dental Hotkeys: sinnvolle Keyboard Shortcuts für häufige Dental-Aktionen
- Toolbar Customization: Dental-relevante Tools prominent
- Validiere dass die Config mit OHIF v3.9.2 kompatibel ist

WICHTIG: Teste Änderungen mit docker compose restart viewer.
```

### AGENT 2 — Scope E: Infrastructure

```
Optimiere docker-compose.yml und .env.example.

Lies CLAUDE.md zuerst. Du arbeitest NUR an docker-compose.yml und .env.example (Scope E).

Aufgaben:
- .env.example: alle konfigurierbaren Werte dokumentiert mit Kommentaren
- docker-compose.yml: Credentials aus .env statt hardcoded
- Health Check für Viewer Container hinzufügen (curl localhost:80)
- Logging: JSON Format, begrenzte Grösse
- Optional: Nginx Service für Production (auskommentiert als Template)
- Optional: Volume für OHIF Config Mount (config/ohif-config.js → Container)

WICHTIG: Teste mit docker compose down && docker compose up -d.
```
