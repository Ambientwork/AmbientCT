# AmbientCT — autonomer Umsetzungsplan zur Konsolidierung

> Status: ausführungsbereit, noch nicht begonnen  
> Erstellt: 2026-08-28  
> Repository: `/Users/john/dev/AmbientCT`  
> Zielbranch bei Planerstellung: `Ambientwork/ai-inference-3b-1-orthanc-fetch`  
> Zielzustand: stabiler MAR-/MPR-Viewer plus belastbare AI-Inference-Phase 3b-2  
> Sicherheitsgrenze: Research Preview, nicht für Diagnose oder klinische Freigabe

## 1. Zweck dieses Dokuments

Dieser Plan ist ein Arbeitsauftrag für einen autonomen Coding-Agenten. Er soll den
vorhandenen, uncommitteten Zwischenstand konsolidieren, bekannte Fehler beheben,
Tests reproduzierbar machen und die neuen Viewer- und AI-Funktionen bis zu einem
prüfbaren Integrationsstand bringen.

Der Agent soll die Schritte in der angegebenen Reihenfolge ausführen. Er darf
innerhalb des definierten Scopes selbständig analysieren, implementieren, testen,
lokale Container neu bauen und lokale Commits anlegen. Er darf keine Releases
veröffentlichen, keine Änderungen pushen und keine produktiven oder bestehenden
Orthanc-Daten löschen.

Der Plan besteht aus zwei Tracks:

- **Track A — autonome Konsolidierung:** vollständig ohne echte Modellgewichte
  ausführbar. Er umfasst Quellcodefehler, Demo-Modus, DICOM-SEG-Schreibpfad,
  Viewer, isolierte Tests, Dokumentation und lokale Commits.
- **Track B — echte Modellvalidierung:** beginnt erst nach erfolgreichem Track A
  und nur, wenn Modellgewichte bereits vorhanden sind oder der Download
  ausdrücklich autorisiert wurde.

Track A darf nicht auf Track B warten.

## 2. Ausgangslage

### 2.1 Git- und Laufzeitstand

- Aktiver Branch entspricht seinem Remote-Branch am Commit `0b8ea29`.
- Der Commit enthält Phase 3b-1: echte Orthanc-Abholung und Volumenrekonstruktion.
- Darüber liegen 20 veränderte und 8 neue, noch nicht committete Dateien.
- Der aktuelle Branch wurde laut lokalen Referenzen bereits in
  `origin/feature/ui-redesign` gemergt. Die neuen Änderungen liegen dennoch auf
  diesem alten Feature-Branch.
- Vier Docker-Dienste laufen gesund: Orthanc, Viewer, MAR-Processor und
  AI-Inference.
- Die laufenden Images sind älter als der Arbeitsbaum. AI-Inference meldet zurzeit
  Version `0.2.0`, Phase `3b-1`, `model_loaded=false`.
- `data/ai-models/` enthält keine Modellgewichte.

### 2.2 Bereits grüner Nachweis

- `docker compose config --quiet` ist erfolgreich.
- Die Extension-Unit-Tests bestehen: 5 Suites, 70 Tests.
- Playwright findet 8 E2E-Tests, sie wurden auf dem neuen Quellstand noch nicht
  ausgeführt.

### 2.3 Bekannte Blocker

1. `DentalContainerViewport.tsx` verwendet `layoutMode`, bevor der React-State
   deklariert wird. Das kann beim Rendern einen Temporal-Dead-Zone-Fehler auslösen.
2. `main.py` klassifiziert einen fehlenden Modellpfad als Demo, übergibt diesen
   Zustand aber nicht an `run_segmentation()`. Der Job kann deshalb trotz
   angeblichem Demo-Modus mit `ModelLoadError` abbrechen.
3. `AI_MODEL_PATH` zeigt auf eine ZIP-Datei; `_load_real_predictor()` erwartet
   einen entpackten nnU-Net-Modellordner.
4. Der Code dokumentiert `--disable_tta` und `step_size=0.9`, initialisiert den
   Predictor aber mit `use_mirroring=True` und `tile_step_size=0.5`.
5. Der Parameter `AI_INFERENCE_PATCH_SIZE` wird geloggt, steuert die tatsächliche
   nnU-Net-Inferenz aber nicht.
6. Die reale Inferenz übergibt eine feste Spacing-Angabe `[1, 1, 1]` statt der
   Geometrie des geladenen Volumens.
7. Das Abbrechen eines `asyncio.to_thread()`-Tasks beendet den darunter laufenden
   Inferenz-Thread nicht zuverlässig. Der aktuelle Memory-Watchdog ist deshalb
   kein harter Prozessschutz.
8. Die Python-Tests sind lokal nicht reproduzierbar eingerichtet; der Host nutzt
   Python 3.14 und wichtige Laufzeitpakete fehlen.
9. Die E2E-Tests arbeiten gegen die bestehende Orthanc-Instanz und erzeugen oder
   importieren Daten. Sie brauchen eine isolierte Testumgebung.
10. Dokumentation und Versionen widersprechen dem Quellcode.

## 3. Verbindliche technische Entscheidungen

Diese Entscheidungen gelten für die autonome Umsetzung. Sie dürfen nur geändert
werden, wenn ein nachweisbarer technischer Blocker vorliegt und die Abweichung im
Abschlussbericht dokumentiert wird.

### 3.1 AI-Betriebsmodi

Es gibt genau drei explizite Zustände:

| Modus | Bedingung | Verhalten |
|---|---|---|
| `demo` | `AI_INFERENCE_DEMO_MODE=true` | synthetischer Predictor, klar als Demo markiert |
| `real` | Demo aus und gültiger, entpackter Modellordner vorhanden | echte nnU-Net-Inferenz |
| `unavailable` | Demo aus und Modell fehlt/ist ungültig | Health bleibt als Liveness erreichbar, Jobs scheitern früh mit klarer Meldung |

Ein fehlendes, aber ausdrücklich konfiguriertes Modell darf nicht stillschweigend
synthetische klinisch aussehende Ergebnisse erzeugen.

### 3.2 Demo-Persistenz

- Demo-Findings bleiben eindeutig `isDemo=true` beziehungsweise mit
  `model_id=ambientct-mock-v0` markiert.
- Synthetische DICOM-SEG-Dateien werden standardmäßig **nicht** in eine normale
  Orthanc-Instanz geschrieben.
- Eine Demo-Persistenz darf nur über eine explizite Variable wie
  `AI_INFERENCE_PERSIST_DEMO_SEG=true` aktiviert werden und wird ausschließlich in
  der isolierten Testinstanz verwendet.

### 3.3 Hardware und Docker

- Der produktionsnahe Docker-Pfad verwendet `cpu` als belastbaren Standard.
- MPS darf nicht als Beschleunigung innerhalb des Linux-/amd64-Containers
  versprochen werden.
- Ein optionaler nativer macOS-Entwicklungspfad darf MPS später unterstützen,
  gehört aber nicht zum Exit-Kriterium dieses Plans.
- Der Docker-`mem_limit` bleibt der harte Schutz. Ein softwareseitiger Watchdog
  darf nicht behaupten, einen unkontrollierbaren Thread sicher beendet zu haben.

### 3.4 Modellartefakt

- `AI_MODEL_PATH` bezeichnet einen **entpackten nnU-Net-Modellordner** mit
  `dataset.json`, `plans.json` und `fold_*`-Unterordnern.
- Der Download darf zunächst eine ZIP-Datei ablegen, muss sie aber in einen
  deterministischen Zielordner entpacken und die erwartete Struktur validieren.
- Ein Download ohne gepinnten SHA256-Wert ist kein bestandener Produktions-Gate.

### 3.5 Viewer und MAR-Differenz

- Original, MAR und Differenz müssen dieselbe Patientenkoordinate verwenden.
- Eine Differenz darf nur berechnet werden, wenn Dimensionen, Spacing,
  Orientierung und Frame of Reference kompatibel sind.
- Bei inkompatibler Geometrie zeigt der Viewer einen verständlichen Fehler; er
  darf keine scheinbar plausible Differenz anzeigen.
- Linked Slice ist gemeinsame Zustandsführung im Parent, nicht nur drei optisch
  ähnliche Slider.

## 4. Autonomie-, Sicherheits- und Abbruchregeln

### 4.1 Erlaubte autonome Aktionen

Der ausführende Agent darf:

- Dateien im Repository innerhalb des unten definierten Scopes bearbeiten.
- einen neuen lokalen Feature-Branch erstellen und dorthin wechseln;
- Abhängigkeiten in einer isolierten Testumgebung installieren;
- Docker-Images lokal bauen und die betroffenen Container neu erstellen;
- synthetische oder bereits vorhandene anonymisierte Testdaten verwenden;
- lokale, kleine Conventional-Commit-Commits erstellen;
- Dokumentation an den verifizierten Stand angleichen.

### 4.2 Aktionen mit zwingendem Halt

Der Agent hält an und fordert eine Entscheidung an, wenn:

- ein echter Modelldownload nötig ist und weder Gewichte noch ausdrückliche
  Download-Autorisierung vorhanden sind;
- ein Test nur mit möglicherweise echten Patientendaten ausführbar wäre;
- Änderungen außerhalb des definierten Scopes erforderlich werden;
- bestehende uncommittete Änderungen nicht sicher von der geplanten Arbeit
  unterschieden werden können;
- ein Test eine produktive/existierende Orthanc-Instanz verändern würde;
- Push, PR, Release, Tag oder externe Veröffentlichung erforderlich wäre;
- eine regulatorische oder diagnostische Produktentscheidung nötig wird.

Der Halt blockiert nur den betroffenen optionalen Schritt. Alle unabhängigen
Arbeitspakete werden vorher abgeschlossen.

### 4.3 Verbotene Aktionen

- Kein `git reset --hard`, kein erzwungenes Checkout und kein Force-Push.
- Kein `docker compose down -v` gegen das bestehende Projekt `AmbientCT`.
- Kein Löschen oder Zurücksetzen bestehender Orthanc-Volumes.
- Keine echten DICOM-/Patientendaten in Git, Tests, Screenshots oder Berichten.
- Keine ungescrubbten Logs lesen oder ausgeben. Vor jeder Logauswertung:
  `python3 scripts/scrub.py <logfile>`.
- Keine Cloud-Inferenz, Telemetrie oder externe Übertragung medizinischer Daten.
- Kein automatischer Modell- oder Daten-Download ohne das definierte Gate.
- Keine Aussage, dass das Ergebnis diagnostisch, CE-/FDA-zertifiziert oder
  klinisch validiert sei.

## 5. Bearbeitungsscope

### 5.1 Primärer Scope

- `extensions/dental-cpr/src/components/ViewerToolbar.tsx`
- `extensions/dental-cpr/src/utils/orthancClient.ts`
- `extensions/dental-cpr/src/viewports/DentalContainerViewport.tsx`
- `extensions/dental-cpr/src/viewports/DentalMPRViewport.tsx`
- `extensions/dental-cpr/src/viewports/DentalMPRDiffViewport.tsx`
- `extensions/dental-cpr/tests/`
- `tests/e2e/`
- `playwright.config.js`
- `ai-inference/`
- `scripts/download-models.sh`
- `docker-compose.yml`
- `.env.example`
- `.gitignore`
- `.github/workflows/ci.yml`
- `README.md`
- `docs/AI-ASSIST-ARCHITECTURE.md`
- `docs/DENTAL-VIEWER-FEATURE-MATRIX-AND-PLAN.md`
- `docs/DENTAL-FEATURES-ROADMAP.md`
- `docs/TESTING.md`

### 5.2 Nur bei nachgewiesener Notwendigkeit

- `Dockerfile.ohif`
- `mar-processor/mar_pipeline.py`
- `config/ohif-config.js`
- `config/nginx/ohif.conf.template`

Änderungen in dieser zweiten Gruppe brauchen im Committext eine kurze Begründung.

## 6. Ausführungsreihenfolge und Gates

```text
P0 Bestands- und Sicherheitscheck
  -> P1 bekannte Quellcodeblocker
    -> Gate G1: schnelle Unit-Tests
      -> P2 reproduzierbare Testumgebung
        -> Gate G2: vollständige Unit-Tests
          -> P3 MAR/MPR-Integration
            -> Gate G3: Viewer-Build + isolierte E2E
              -> P4 AI-Demo + DICOM-SEG-Pfad
                -> Gate G4: isolierte AI-Integration
                  -> P5 reale Modellvorbereitung
                    -> Gate G5: optionaler Modelldownload
                      -> P6 reale Modellvalidierung
                        -> P7 Dokumentation, Review und Übergabe
```

G1 bis G4 und P7 gehören zu Track A und sind verpflichtend. G5 und P6 gehören zu
Track B und dürfen als sauber dokumentiertes `pending_external_artifact` enden.

## 7. P0 — Bestandsaufnahme und Arbeitsbaum sichern

### Ziel

Der Agent kennt die exakten Ausgangsänderungen und arbeitet ohne Verlust fremder
Arbeit.

### Schritte

1. Projektwurzel bestätigen:

   ```bash
   pwd
   git rev-parse --show-toplevel
   git status --short --branch
   ```

2. Pflichtdokumente vollständig lesen:

   - `CLAUDE.md`
   - `docs/ARCHITECTURE.md`
   - `docs/CONVENTIONS.md`
   - `docs/STOPP.md`
   - `docs/TESTING.md`

3. Ausgangsliste sichern, ohne Dateien zu verändern:

   ```bash
   git status --porcelain=v2 > /tmp/ambientct-preflight-status.txt
   git diff --binary > /tmp/ambientct-preflight.patch
   git ls-files --others --exclude-standard > /tmp/ambientct-preflight-untracked.txt
   git diff --check
   ```

4. Prüfen, ob der geplante Branch bereits existiert. Falls nicht:

   ```bash
   git switch -c feat/phase-3b2-mar-compare-stabilization
   ```

   Existiert er bereits, einen eindeutigen Suffix verwenden. Kein Reset und kein
   Rebase mit uncommittetem Arbeitsbaum.

5. Laufende Dienste und Versionen read-only erfassen:

   ```bash
   docker compose ps --all
   curl -fsS http://localhost:3000/api/ai/health
   curl -fsS http://localhost:8000/health
   docker compose config --quiet
   ```

6. Keine Logs lesen. Logs werden erst bei einem Fehler gezielt in eine Datei
   exportiert, gescrubbt und danach analysiert.

### Exit-Kriterium P0

- Branch und Arbeitsbaum sind dokumentiert.
- Die Preflight-Artefakte liegen nur unter `/tmp`.
- Kein vorhandener Quellcode wurde verloren oder überschrieben.

## 8. P1 — bekannte Quellcodeblocker beheben

### P1.1 React-State-Reihenfolge

In `DentalContainerViewport.tsx` muss `useState(initialLayoutMode)` vor jeder
Berechnung stehen, die `layoutMode` verwendet.

Zusätzlich:

- `compareSplitReady` erst nach der State-Deklaration berechnen;
- alle abgeleiteten DisplaySets null-sicher behandeln;
- Hooks nie bedingt aufrufen;
- einen kleinen reinen Helper für Layout-/Compare-Ableitung extrahieren, wenn das
  ohne unnötige API-Vergrößerung möglich ist;
- dafür einen Unit-Test ergänzen oder mindestens einen E2E-Test sicherstellen,
  der den ersten Render und den Wechsel CPR -> MPR abdeckt.

### P1.2 AI-Modus als Single Source of Truth

Eine zentrale, testbare Konfigurationsfunktion einführen, zum Beispiel
`resolve_inference_mode()` mit einem kleinen Ergebnisobjekt:

```text
mode: demo | real | unavailable
model_id
model_version
model_path
reason
device
```

Anforderungen:

- `main.py`, Healthcheck und `run_segmentation()` verwenden dieselbe Entscheidung.
- Demo-Modus wird explizit als Parameter übergeben; keine zweite, abweichende
  Auswertung derselben Environment-Variablen tief in der Pipeline.
- Fehlendes Modell + Demo aus ergibt `unavailable` und eine frühe, PHI-freie
  Fehlermeldung.
- Health liefert mindestens `mode`, `model_loaded`, `model_id`, `phase`, `device`
  und einen unkritischen `reason`-Code.
- Docker-Liveness bleibt HTTP 200, solange der Service selbst funktioniert.
- Ein Job im Modus `unavailable` lädt kein komplettes CBCT-Volumen, bevor er
  scheitert.

### P1.3 Demo-SEG-Sicherheit

- `AI_INFERENCE_PERSIST_DEMO_SEG=false` als Standard einführen.
- Bei `false` wird ein synthetisches Ergebnis nur im API-State zurückgegeben und
  nicht via STOW-RS in Orthanc gespeichert.
- Bei `true` muss `is_demo=true`, der Mock-Modellname und eine eindeutige
  SeriesDescription in der SEG-Datei stehen.
- Die UI behält die sichtbare Kennzeichnung „Research Preview · Demo Data · Not
  for Diagnosis“.

### Tests P1

Mindestens folgende Testfälle ergänzen:

- `demo=true`, Modell fehlt -> Demo-Predictor;
- `demo=false`, kein Modellpfad -> `unavailable`;
- `demo=false`, Pfad fehlt -> `unavailable`/klarer Jobfehler;
- `demo=false`, gültiger Modellordner -> `real`;
- Demo ohne Persistenz -> kein STOW-Aufruf;
- Demo mit Test-Persistenz -> STOW-Aufruf und `is_demo=true`;
- Viewer rendert im initialen CPR-Modus ohne TDZ-Fehler;
- Wechsel CPR -> MPR setzt URL und sichtbare Viewports korrekt.

### Gate G1

```bash
cd /Users/john/dev/AmbientCT/extensions/dental-cpr
../../node_modules/.bin/jest --runInBand
cd /Users/john/dev/AmbientCT
git diff --check
docker compose config --quiet
```

G1 ist bestanden, wenn alle vorhandenen 70 Tests plus neue Tests grün sind und
keine Whitespace-Fehler vorliegen.

### Commit-Grenze

```text
fix: stabilize viewer layout and AI mode selection
```

Nur committen, wenn G1 bestanden ist.

## 9. P2 — reproduzierbare Test- und CI-Umgebung

### Ziel

Python-, Viewer- und E2E-Tests laufen ohne Abhängigkeit vom zufälligen Hostzustand
und ohne Änderungen an der bestehenden Orthanc-Instanz.

### P2.1 Python-Testtarget

Im AI-Dockerfile einen dedizierten Test-Stage ergänzen oder eine gleichwertige,
reproduzierbare Python-3.11-Testumgebung schaffen.

Der Test-Stage muss:

- `requirements.txt` und `requirements-dev.txt` installieren;
- den Quellcode kopieren;
- `PYTHONPATH=/app` setzen;
- standardmäßig `pytest tests -q` ausführen;
- keine echten Modellgewichte voraussetzen;
- für Tests explizit Demo-Modus verwenden;
- den Production-Stage weiterhin ohne Pytest ausliefern.

Vorgesehene Befehle:

```bash
docker build --target test \
  -t ambientct/ai-inference:test \
  /Users/john/dev/AmbientCT/ai-inference
docker run --rm ambientct/ai-inference:test pytest tests -q
```

Falls ein vollständiger Torch-/nnU-Net-Build auf dem Entwicklungsrechner nicht
vertretbar ist, darf der Agent für reine Unit-Tests einen zweiten leichten
Requirements-Satz verwenden. Dieser darf reale Inferenztests nicht fälschlich als
bestanden markieren.

### P2.2 Isolierter Integrationstest-Stack

Eine Test-Compose-Override-Datei oder ein äquivalentes Harness erstellen:

- eigener Compose-Projektname, zum Beispiel `ambientct-test`;
- eigene Ports, zum Beispiel Viewer `3100`, Orthanc `8142`, MAR `8100`;
- eigenes benanntes Orthanc-Testvolume;
- expliziter Demo-Modus;
- `AI_INFERENCE_PERSIST_DEMO_SEG=true` nur hier;
- ausschließlich synthetische oder nachweislich anonymisierte Fixtures;
- deterministische Zugangsdaten nur für die lokale Testinstanz;
- teardown löscht ausschließlich Ressourcen mit dem exakten Test-Projektnamen.

Ein mögliches Kommandomuster:

```bash
docker compose -p ambientct-test \
  -f docker-compose.yml \
  -f docker-compose.test.yml \
  up -d --build
```

Teardown erst nach Prüfung des Projektnamens:

```bash
docker compose -p ambientct-test \
  -f docker-compose.yml \
  -f docker-compose.test.yml \
  down -v
```

`down -v` ist ausschließlich für `ambientct-test` zulässig, niemals für die
bestehende AmbientCT-Instanz.

### P2.3 Portables Playwright-Harness

- `BASE_URL` muss für Host- und Containerlauf explizit gesetzt werden können.
- Der DICOM-Fixture-Pfad kommt aus einer Environment-Variable oder wird relativ
  zur Repository-Wurzel aufgelöst.
- Tests brechen mit einer verständlichen Meldung ab, wenn die anonymisierte
  Fixture fehlt.
- Import- und MAR-Tests laufen ausschließlich gegen den isolierten Stack.
- Ein read-only Viewer-Smoke darf separat gegen eine vorhandene Instanz laufen.
- Playwright-Artefakte bleiben gitignored.

### P2.4 CI aktualisieren

`.github/workflows/ci.yml` so erweitern, dass mindestens ausgeführt werden:

- Docker-Compose-Validierung;
- Shellcheck;
- Dental-Extension-Unit-Tests;
- AI-Python-Unit-Tests unter Python 3.11 oder im Test-Stage;
- nach Möglichkeit ein isolierter Demo-Smoke;
- keine echten Modellgewichte und keine echten DICOM-Daten.

CI darf Modelltests sauber als separate, optionale Kategorie ausweisen. Ein
übersprungener Realmodelltest ist kein grüner Realmodellnachweis.

### Gate G2

- alle TypeScript-Unit-Tests grün;
- alle Python-Unit-Tests grün;
- Compose-Konfiguration gültig;
- Shellcheck für veränderte Shellskripte grün;
- Teststack startet ohne Zugriff auf das bestehende Orthanc-Volume;
- Teststack lässt sich vollständig entfernen, ohne andere Container/Volumes zu
  berühren.

### Commit-Grenze

```text
test: add isolated viewer and AI validation harness
```

## 10. P3 — MAR- und MPR-Viewer fertigstellen

### Ziel

Ein Anwender kann eine Quellserie öffnen, MAR ausführen, das Ergebnis wiederfinden
und Original/MAR/Differenz in synchronisierten MPR-Ansichten vergleichen.

### P3.1 Serien- und URL-Zustand

- `StudyInstanceUIDs`, `SeriesInstanceUIDs`, `initialSeriesInstanceUID`,
  `marSourceSeriesInstanceUID`, `marResultSeriesInstanceUID` und `layoutMode`
  konsistent lesen und schreiben.
- URL-Builder bleibt zentral in `orthancClient.ts`.
- UIDs werden dedupliziert und URL-kodiert.
- Ungültige oder unvollständige Compare-URLs fallen verständlich auf eine
  Einzelserienansicht zurück.
- Unit-Tests decken leere, doppelte und fehlende UIDs ab.

### P3.2 MAR-Ergebnisreferenz

- Das aktuelle localStorage-Mapping darf als v0.3-Zwischenlösung bleiben.
- Ein Mapping enthält Study UID, Quellserien-UID, MAR-Serien-UID und Zeitpunkt.
- Veraltete Mappings werden erkannt, wenn eine Serie nicht mehr in Orthanc
  vorhanden ist.
- Der Nutzer kann neu generieren, statt in einer Endlosschleife auf eine fehlende
  Serie zu warten.
- Die Dokumentation nennt klar: localStorage ist noch keine klinische Persistenz.

### P3.3 MPR-Rendering

- Coronal und sagittal müssen dieselbe Volume-Lookup-Strategie verwenden.
- Polling erhält Timeout, Retry-Schaltfläche und konkrete, PHI-freie Fehlercodes.
- Ein Unmount beendet Timer, Observer und vtk-Ressourcen.
- Keine Verwendung interner Cornerstone-Caches ohne isolierten Fallback und
  kommentierte Begründung.
- W/L, aktuelle Patientenkoordinate und Orientierung werden sichtbar angezeigt.

### P3.4 Synchronisierte Compare-Ansicht

Gemeinsamen Parent-State einführen:

```text
compareSliceWorldCoordinate
compareWindow
compareLevel
compareOpacity beziehungsweise diffWindow
```

- Original-, MAR- und Diff-Viewport lesen denselben Slice-State.
- Eine Sliderbewegung aktualisiert alle drei Spalten derselben Orientierung.
- Coronal und sagittal haben je einen gemeinsamen Achsenwert.
- W/L-Lock ist sichtbar und standardmäßig aktiv.
- Diff-Skalierung und Farblegende sind nachvollziehbar.

### P3.5 Geometrieprüfung

Vor jeder Differenzberechnung prüfen:

- Dimensionen;
- Spacing mit definierter Toleranz;
- Origin;
- Direction Cosines;
- FrameOfReferenceUID;
- kompatibler Wertebereich beziehungsweise RescaleSlope/Intercept.

Bei Abweichung:

- `status=error`;
- keine Pixel-Differenz zeichnen;
- Fehler „Seriengeometrie nicht kompatibel“ anzeigen;
- technische Details nur PHI-frei in Debug-Ausgabe.

### P3.6 E2E-Szenarien

Mindestens:

1. Studie öffnen -> CPR sichtbar -> MPR wechseln -> zurück zur Studienliste.
2. MAR starten -> Fortschritt sichtbar -> Ergebnis vorhanden.
3. „MAR öffnen“ lädt die Ergebnisserie.
4. „Vergleich“ lädt Original und MAR.
5. Original/MAR/Diff in coronal und sagittal sichtbar.
6. Sliderbewegung aktualisiert gekoppelte Viewports.
7. Reload findet das MAR-Mapping wieder.
8. Inkompatible oder fehlende Serie zeigt Fehler/Recovery statt Endlos-Loading.
9. Keine unerwarteten `pageerror`- oder Console-Errors.

### Gate G3

```bash
cd /Users/john/dev/AmbientCT/extensions/dental-cpr
../../node_modules/.bin/jest --runInBand
cd /Users/john/dev/AmbientCT
docker compose build viewer
```

Danach nur gegen den isolierten Teststack:

```bash
BASE_URL=http://localhost:3100 \
SAMPLE_DICOM=/absoluter/pfad/zur/anonymisierten/fixture.dcm \
npx playwright test tests/e2e/dental-cpr-ui.spec.js
```

G3 ist bestanden, wenn Unit-Tests, Viewer-Build und alle MAR/MPR-E2E-Szenarien
grün sind. Screenshots von Fehlern dürfen keine Patientendaten enthalten.

### Commit-Grenze

```text
feat: complete synchronized MAR compare workflow
```

## 11. P4 — AI-Demo- und DICOM-SEG-Pfad stabilisieren

### Ziel

Ohne echte Modellgewichte ist der komplette technische Pfad mit synthetischen
Daten testbar, ohne die normale Orthanc-Instanz zu verunreinigen.

### P4.1 Volumen- und Geometrievertrag

`LoadedVolume` bleibt die zentrale Quelle für:

- Pixelarray in dokumentierter Achsenreihenfolge;
- Spacing in dokumentierter Reihenfolge;
- Origin;
- Direction Cosines;
- Study/Series/SOP/FrameOfReference UIDs;
- Referenz auf notwendige Quelldatensätze für DICOM SEG.

Tests müssen mindestens axiale, umgekehrt sortierte und anisotrope synthetische
Serien abdecken.

### P4.2 DICOM-SEG-Writer

Für jedes erzeugte SEG prüfen:

- Modality `SEG`;
- korrekte SOP Class UID;
- gleiche StudyInstanceUID und FrameOfReferenceUID wie die Quelle;
- neue SeriesInstanceUID und SOPInstanceUID;
- valide SegmentSequence mit korrektem Anatomy Code;
- korrekte Referenzen auf die Quellinstanzen;
- korrekte Per-Frame PlanePosition;
- Roundtrip mit `pydicom.dcmread()`;
- leere Masken werden nicht als scheinbar erfolgreiche SEG ausgegeben;
- Demo-Artefakte sind im Description/Model-Feld eindeutig markiert.

SNOMED-Zuordnungen werden gegen die bereits dokumentierten Codes geprüft. Bei
Unsicherheit keine neuen klinischen Codes erfinden.

### P4.3 STOW-RS

- Erfolgsantwort und `FailedSOPSequence` vollständig behandeln.
- Partielle Uploadfehler führen nicht zu einem falschen Gesamterfolg.
- Retries nur bei temporären Netzwerk-/5xx-Fehlern; keine Endlosschleife.
- Keine vollständigen UIDs, Payloads oder DICOM-Tags loggen.
- Der Jobstatus enthält eine nutzbare, aber PHI-freie Fehlermeldung.

### P4.4 API-State

- Findings bleiben ausdrücklich Mock; Anatomy Segmentation und Finding Detection
  dürfen nicht vermischt werden.
- Jobstatus endet nur dann in `review_required`, wenn der konfigurierte Pfad
  erfolgreich abgeschlossen ist.
- Bei nicht persistiertem Demo-SEG wird der API-State als Demo geführt, aber kein
  Orthanc-SOP-UID vorgetäuscht.
- Neustart-Persistenz des In-Memory-Jobstores ist nicht Teil von v0.3, muss aber als
  Limitierung dokumentiert werden.

### Gate G4

Im isolierten Teststack:

1. anonymisierte/synthetische Studie importieren;
2. Demo-AI-Job starten;
3. Status `queued -> running -> review_required` beobachten;
4. Findings als Demo prüfen;
5. mit `AI_INFERENCE_PERSIST_DEMO_SEG=false` sicherstellen, dass kein SEG in
   Orthanc erscheint;
6. Teststack mit `true` neu starten und genau ein klar markiertes Demo-SEG prüfen;
7. DICOM SEG wieder laden und zentrale Geometrie-/Referenztags validieren;
8. AI-Panel-E2E ausführen.

Alle Python-Tests und die vier bestehenden AI-Panel-E2E-Tests müssen grün sein.

### Commit-Grenze

```text
feat: stabilize demo inference and DICOM SEG persistence
```

## 12. P5 — reale Modellvorbereitung

### Ziel

Der reale CPU-Pfad ist technisch korrekt vorbereitet, auch wenn die großen
Gewichte noch nicht heruntergeladen werden.

### P5.1 Downloadskript härten

Das Skript erhält:

- `--help`;
- `--yes` für ausdrücklich autorisierte nichtinteraktive Ausführung;
- `--verify-only`;
- Download in eine temporäre Datei und atomaren Rename;
- gepinnten SHA256-Wert vor Freigabe des Realmodell-Gates;
- ZIP-Strukturprüfung;
- deterministisches Entpackziel;
- Validierung von `dataset.json`, `plans.json` und mindestens einem
  `fold_*/checkpoint_final.pth`;
- idempotentes Verhalten;
- verständliche Lizenz-/Provenienz-Ausgabe;
- `shellcheck`-Sauberkeit;
- keine Modellgewichte in Git.

Das Skript darf einen vorhandenen, nicht passenden Download nicht ohne sichere
Prüfung überschreiben. Es schreibt die Model Card erst nach erfolgreicher
Verifikation.

### P5.2 Loader-Vertrag

- `AI_MODEL_PATH` zeigt auf den validierten entpackten Ordner.
- ZIP-Datei als Laufzeitpfad wird mit klarer Meldung abgelehnt oder vor dem
  Containerstart entpackt; kein Entpacken pro Job.
- Predictor wird lazy genau einmal geladen.
- Cache-Key enthält mindestens Modellpfad, Device und relevante Optionen, damit
  Konfigurationswechsel in Tests keinen falschen Predictor wiederverwenden.
- Das Health-Ergebnis meldet `model_loaded=true` erst nach erfolgreichem Load,
  nicht nur, weil ein Pfad existiert.

### P5.3 nnU-Net-Aufruf korrigieren

- echte Volume-Spacing-Werte in der von nnU-Net erwarteten Reihenfolge übergeben;
- `tile_step_size=0.9`, wenn dies der gewählte Speicherkompromiss bleibt;
- Mirroring/TTA deaktivieren, wenn die Dokumentation dies verspricht;
- `perform_everything_on_device` für CPU sinnvoll konfigurieren;
- nicht wirksame Option `AI_INFERENCE_PATCH_SIZE` entweder korrekt anbinden oder
  entfernen und dokumentieren;
- Rückgabeform des verwendeten nnU-Net-v2-Pins mit einem Contract-Test absichern;
- Canal Label `5` als Modellmetadatum führen, nicht inkonsistent als Default `1`;
- leeres Canal-Ergebnis ist Warnung/Review-Fall, kein erfundener positiver Befund.

### P5.4 Speicherschutz

Bevorzugte Reihenfolge:

1. Docker-`mem_limit` als harter Schutz beibehalten.
2. Inferenz in einen eigenen Worker-Prozess verschieben, wenn ein kontrolliertes
   Abbrechen gefordert ist.
3. Parent überwacht RSS/Timeout und kann den Worker-Prozess terminieren.
4. Bei OOM/Timeout Job sauber auf `failed` setzen; Service bleibt erreichbar.

Falls Prozessisolation in diesem Zyklus zu groß ist, muss der Agent:

- den Thread-Watchdog als beobachtend statt hart abbrechend dokumentieren;
- keine falsche Sicherheitsgarantie ausgeben;
- den Container-Hard-Limit-Test durchführen;
- Prozessisolation als konkretes offenes P1-Ticket in der Abschlussliste führen.

### Gate vor Modelldownload G5

Vor einem Download müssen alle Punkte erfüllt sein:

- Track A vollständig grün;
- Download ausdrücklich autorisiert oder Modell bereits vorhanden;
- Quelle und Lizenz dokumentiert;
- SHA256 gepinnt;
- mindestens 3 GB freier Speicher für Download, Entpacken und Image-Overhead;
- keine Patientendaten werden übertragen;
- Zielpfad liegt unter `data/ai-models/` und ist gitignored.

Ist ein Punkt nicht erfüllt, endet Track B mit Status
`pending_external_artifact`, ohne Track A als fehlgeschlagen zu markieren.

### Commit-Grenze

```text
fix: make DentalSegmentator model setup reproducible
```

## 13. P6 — optionale echte Modellvalidierung

Diese Phase nur nach bestandenem G5 ausführen.

### P6.1 Modellinstallation

```bash
bash scripts/download-models.sh --verify-only
```

Wenn noch nicht vorhanden und ausdrücklich autorisiert:

```bash
bash scripts/download-models.sh --yes
bash scripts/download-models.sh --verify-only
```

Der berechnete Hash, die Quelle und die Model Card dürfen dokumentiert werden;
die Gewichte selbst bleiben unversioniert.

### P6.2 Realmodell-Tests

Nur anonymisierte Testdaten im isolierten Stack verwenden.

Prüfen:

- Health meldet `mode=real` und erst nach Load `model_loaded=true`;
- CPU wird im Docker-Pfad verwendet;
- ein realer Job erreicht einen terminalen Status;
- Peak-RSS und Laufzeit werden ohne PHI erfasst;
- Ergebnis enthält ausschließlich erwartete Anatomy-Klassen;
- Canal Label entspricht Modelllabel 5;
- SEG liegt geometrisch korrekt über dem Quellvolumen;
- SEG ist in Orthanc wieder auffindbar;
- UI zeigt Research-Preview-Kennzeichnung;
- Findings bleiben als Mock/Demo markiert;
- Service bleibt nach Jobende und nach einem Fehler gesund.

### P6.3 Negativtests

- beschädigter Modellordner;
- fehlendes `plans.json`;
- falsches Device;
- zu kleines Memory-Limit;
- Netzwerkunterbrechung zu Orthanc;
- STOW-RS-Ablehnung;
- inkompatible oder unvollständige DICOM-Serie;
- leerer Canal-Mask-Output.

### Exit-Kriterium Track B

Ein echter, anonymisierter CBCT-Datensatz wurde vollständig durch

```text
Orthanc -> Volume -> nnU-Net -> Canal Mask -> DICOM SEG -> Orthanc -> Viewer
```

geführt und visuell plus programmatisch geprüft. Ohne diesen Nachweis darf die
Dokumentation nur „Realmodell-Pfad implementiert“, nicht „Realmodell validiert“
sagen.

## 14. P7 — Dokumentation, Versionierung und Abschlussreview

### P7.1 Dokumentation synchronisieren

Mindestens aktualisieren:

- `README.md`: klarer Ist-Stand, Demo vs. real, Research Preview;
- `ai-inference/README.md`: Phase 3b-2 statt widersprüchlicher Phase 3a;
- `docs/AI-ASSIST-ARCHITECTURE.md`: tatsächlich implementierter Datenfluss;
- `docs/DENTAL-VIEWER-FEATURE-MATRIX-AND-PLAN.md`: MAR Compare und DICOM SEG
  auf `Partial` oder `Done` nur entsprechend der Gates;
- `docs/DENTAL-FEATURES-ROADMAP.md`: Runtime-Verifikation mit Datum;
- `docs/TESTING.md`: exakte Unit-, Integration- und E2E-Befehle;
- `.env.example`: CPU-Default, Demo-/Persistenzvariablen und Modellordner;
- Dockerfile-Label und Serviceversion auf eine konsistente Version.

Keine Roadmapposition wird allein aufgrund vorhandenen Codes als `Done`
markiert. `Done` setzt einen bestandenen Runtime-/E2E-Nachweis voraus.

### P7.2 Finaler Testlauf

Track A Mindestmatrix:

| Bereich | Befehl/Nachweis | Muss grün sein |
|---|---|---|
| Diff-Qualität | `git diff --check` | ja |
| Compose | `docker compose config --quiet` | ja |
| Dental Unit | Jest, alle Suites | ja |
| AI Unit | Pytest, alle Tests | ja |
| Shell | Shellcheck veränderter Skripte | ja |
| Viewer Build | `docker compose build viewer` | ja |
| AI Build | Production- und Test-Stage | ja |
| Viewer E2E | isolierter Stack | ja |
| AI Panel E2E | isolierter Stack | ja |
| Demo SEG | Roundtrip und isoliertes STOW | ja |
| Realmodell | nur Track B | separat ausweisen |

Danach read-only prüfen:

```bash
git status --short --branch
git log --oneline --decorate -10
git diff --stat HEAD~4..HEAD
```

### P7.3 Abschlussreview

Der Agent führt eine adversariale Eigenprüfung durch:

- Löst die Änderung tatsächlich den Benutzerworkflow?
- Gibt es stille Demo-Fallbacks?
- Kann synthetisches SEG in eine normale Instanz gelangen?
- Sind Original und MAR geometrisch wirklich vergleichbar?
- Werden Patientendaten in Logs, Tests oder Screenshots sichtbar?
- Werden Container-/Volume-Namen vor destruktiven Test-Teardowns exakt geprüft?
- Sind neue Timeout-, Retry- und Fehlerzustände sichtbar?
- Sind Aussagen in README und UI schwächer oder gleich stark wie der reale
  Nachweis?
- Sind alle neuen Dateien versioniert und keine Gewichte/Testartefakte enthalten?

### P7.4 Empfohlene Commit-Reihenfolge

1. `fix: stabilize viewer layout and AI mode selection`
2. `test: add isolated viewer and AI validation harness`
3. `feat: complete synchronized MAR compare workflow`
4. `feat: stabilize demo inference and DICOM SEG persistence`
5. `fix: make DentalSegmentator model setup reproducible`
6. `docs: align viewer and AI roadmap with verified state`

Die tatsächliche Anzahl darf abweichen, solange jeder Commit in sich testbar und
thematisch geschlossen ist. Keine automatisch erzeugten Co-Author-Zeilen.

## 15. Definition of Done

### Track A — verpflichtend

- [ ] Bestehender Arbeitsstand ist ohne Verlust konsolidiert.
- [ ] Kein `layoutMode`-TDZ-Fehler mehr.
- [ ] AI-Modus ist eindeutig `demo`, `real` oder `unavailable`.
- [ ] Kein stiller Mock-Fallback bei fehlendem konfiguriertem Modell.
- [ ] Demo-SEG wird standardmäßig nicht in normales Orthanc geschrieben.
- [ ] Alle TypeScript-Unit-Tests sind grün.
- [ ] Alle Python-Unit-Tests sind reproduzierbar grün.
- [ ] Viewer- und AI-Images bauen erfolgreich.
- [ ] MAR Compare zeigt Original, MAR und Diff.
- [ ] Slice-State ist tatsächlich gekoppelt.
- [ ] Geometrieinkompatibilität erzeugt einen sichtbaren Fehler.
- [ ] E2E läuft in isolierter Orthanc-Instanz.
- [ ] DICOM SEG besteht Roundtrip- und Referenztests.
- [ ] Dokumentation und Versionsangaben stimmen mit dem Nachweis überein.
- [ ] Keine DICOMs, Gewichte, Secrets, Logs oder Testartefakte sind versehentlich
  versioniert.
- [ ] Lokale Commits sind klein, nachvollziehbar und testbar.

### Track B — optional und separat

- [ ] Modellquelle, Lizenz und SHA256 sind verifiziert.
- [ ] Modellstruktur wird vor Start validiert.
- [ ] Docker verwendet einen realistischen CPU-Pfad.
- [ ] nnU-Net erhält korrekte Geometrie und Labelkonfiguration.
- [ ] Ein anonymisierter Realmodell-End-to-End-Lauf ist erfolgreich.
- [ ] DICOM SEG überlagert das Quellvolumen korrekt.
- [ ] Laufzeit und Peak-RSS sind PHI-frei dokumentiert.

## 16. Abschlussbericht des autonomen Agenten

Der Abschlussbericht muss knapp, aber vollständig enthalten:

1. Ergebnis in einem Satz.
2. Branch und neue Commits.
3. Geänderte Funktionsbereiche.
4. Exakte Testergebnisse mit Anzahl bestandener/fehlgeschlagener Tests.
5. Build- und E2E-Status.
6. Track-B-Status: `complete`, `pending_external_artifact` oder `failed`.
7. Noch offene Risiken, nach Priorität sortiert.
8. Hinweis, dass weder gepusht noch released wurde.
9. Hinweis auf alle bewusst nicht ausgeführten destruktiven oder externen
   Aktionen.

Nicht erlaubt sind pauschale Aussagen wie „alles funktioniert“, wenn ein Gate
nicht ausgeführt wurde. Jeder nicht ausgeführte Test wird ausdrücklich als
„nicht verifiziert“ bezeichnet.

## 17. Priorisierte Restarbeiten nach diesem Plan

Diese Punkte gehören nicht zum zwingenden Track-A-Abschluss und werden nicht
nebenbei begonnen:

1. OHIF-native Anzeige der gespeicherten DICOM-SEG-Overlays im AI-Panel.
2. Orthanc-seitige Persistenz von MAR-Mapping, Arch-Linie und Review-State.
3. Screenshot-/PNG-Export mit Metadatenleiste.
4. DICOM-SR für Messungen und akzeptierte Findings.
5. Report Workspace mit lokalem PDF/HTML-Export.
6. Tooth-Chart-Navigation und persistenter Zahnkontext.
7. Implantat-Overlay und Distanz zum Nervkanal.
8. Prozessisolierter Inference-Worker, falls nicht bereits in P5 umgesetzt.
9. Native macOS-MPS-Entwicklungsoption außerhalb des Docker-Pfads.
10. Regulatorische Validierung bleibt vollständig außerhalb dieses OSS-
    Implementierungsplans.

---

## 18. Addendum — Verifikation und verbindliche Korrekturen (2026-08-28)

> Erstellt nach read-only Code-Verifikation aller Plan-Behauptungen durch
> 5 parallele Prüf-Agents. Dieses Addendum ist verbindlich und überschreibt
> widersprechende Angaben in den Abschnitten oben.

### 18.1 Verifikationsstatus der 10 Blocker

Alle 10 Blocker aus Abschnitt 2.3 sind **bestätigt**, mit Evidenz:

1. TDZ: `DentalContainerViewport.tsx:100` liest `layoutMode` vor der
   `useState`-Deklaration in Zeile 103 — crasht bei jedem Render. Hooks sind
   ansonsten unbedingt und korrekt geordnet.
2. `main.py:133-141` `_select_mode()` vs. `segmentation.py:559` — zwei
   divergente Auswertungen; `run_segmentation()` erhält keinen Demo-Flag.
3. `.env.example:120` und `docker-compose.yml:184` zeigen auf die ZIP;
   `_load_real_predictor()` gibt den Pfad direkt an
   `initialize_from_trained_model_folder()`. Kein Unzip-Code existiert —
   auch nicht in `download-models.sh`, obwohl dessen Abschlussbanner das
   Gegenteil behauptet.
4. `segmentation.py:327-335`: `use_mirroring=True`, `tile_step_size=0.5`
   hart kodiert; README verspricht `--disable_tta` / `step_size 0.9`.
5. `AI_INFERENCE_PATCH_SIZE` erreicht nur den Log-Aufruf
   (`segmentation.py:346-351`), nie den Predictor.
6. `segmentation.py:470-476`: `properties={"spacing": [1.0, 1.0, 1.0]}`;
   `volume.spacing_mm/origin_mm/direction` werden nie an den Predictor
   gegeben.
7. `_RssWatchdog` (`segmentation.py:218-276`) ruft nur `task.cancel()` auf
   einem `asyncio.to_thread()`-Task — der Inferenz-Thread läuft weiter.
8. Host-Python 3.14.3, kein Test-Stage im Dockerfile, `requirements-dev.txt`
   wird nirgends installiert, `pytest --collect-only` scheitert an fehlenden
   Imports.
9. E2E importiert real Daten in die laufende Instanz
   (`dental-cpr-ui.spec.js:154-181`) und hängt von vorhandenem Instanzzustand
   ab. Jest-Stand live verifiziert: 5 Suites, 70 Tests, grün.
10. Doku-Widersprüche bestätigt (Details in 18.3).

### 18.2 Korrekturen am Plan (überschreibt oben)

- **P3.3, Punkt „Coronal und sagittal müssen dieselbe Volume-Lookup-Strategie
  verwenden“ entfällt** — bereits erfüllt: beide Viewports nutzen identische
  3-Tier-Lookups (`DentalMPRViewport.tsx:142-175`,
  `DentalMPRDiffViewport.tsx:31-60`). Stattdessen verbindlich: die
  **unbegrenzten Polls** begrenzen — `setTimeout(tryLoad, 800)` ohne Cap in
  beiden MPR-Viewports (`DentalMPRViewport.tsx:309-340`,
  `DentalMPRDiffViewport.tsx:190-221`, UI hängt sonst ewig in „Waiting for
  volume…“) und der MAR-Status-`setInterval` ohne Obergrenze
  (`DentalContainerViewport.tsx:132-157`).
- **P0-Healthchecks**: `localhost:8000/health` ist der MAR-Processor;
  ai-inference hat bewusst keinen Host-Port. AI-Health ausschließlich über
  `http://localhost:3000/api/ai/health` (nginx-Proxy) prüfen.
- **Unit-Test-Referenzzahl**: 5 Suites / 70 Tests wurden live bestätigt und
  sind die Baseline für G1.

### 18.3 Zusätzliche verbindliche Arbeitspunkte (aus Verifikation)

Den Phasen zugeordnet, gleiche Gates:

- **P1.2**: (a) `_select_mode()` läuft einmal zur Importzeit
  (`main.py:144`) — nach Modellinstallation bleibt Health dauerhaft stale;
  `resolve_inference_mode()` muss pro Jobstart bzw. pro Health-Aufruf
  konsistent auflösen oder die Neustart-Pflicht dokumentieren.
  (b) `ModelLoadError` wird nur für nicht existierende Pfade früh geworfen —
  eine existierende, aber ungültige Datei (die Standard-ZIP!) passiert den
  `exists()`-Check und scheitert erst tief in nnU-Net. Früh validieren:
  Ordner mit `dataset.json`/`plans.json`/`fold_*`.
- **P1.3**: Demo-Kennzeichnung muss **in die persistierte SEG-Datei selbst**
  (SeriesDescription + ManufacturerModelName/SegmentAlgorithmName), nicht nur
  in den API-State — heute ist ein in Orthanc gespeichertes Demo-SEG im
  PACS-Browser nicht von echten Ergebnissen unterscheidbar.
- **P2.3**: BASE_URL-Fallback `http://host.docker.internal:3000`
  (beide Spec-Dateien) löst auf dem Host nicht auf; `SAMPLE_DICOM` ist hart
  auf nicht existentes `/work/dicom-import/...` gesetzt; Root-`package.json`
  hat kein E2E-Script.
- **P2.4**: `pytest.ini` nutzt `asyncio_default_fixture_loop_scope` —
  erfordert installiertes `pytest-asyncio`, sonst Config-Warnung/Fehler.
- **P5.1**: `download-models.sh` ist heute strikt interaktiv
  (`read -r CONFIRM`, Zeile 136) ohne `--yes`; **kein `--help`** (verstößt
  gegen CONVENTIONS.md „--help auf jedem Skript“); kein Unzip; der
  Idempotenz-Check übergeht bei leerem `KNOWN_SHA256` still eine potenziell
  korrupte vorhandene Datei. Shellcheck ist bereits sauber.
- **P5.2**: Modell-Load läuft synchron im async-Kontext
  (`segmentation.py:587-589` ohne `to_thread`) und blockiert den
  FastAPI-Event-Loop beim ersten Real-Job — in `asyncio.to_thread`
  verlagern.
- **P5.3 (kritisch, bestätigt)**: `AI_INFERENCE_CANAL_LABEL`-Default ist `1`
  (`segmentation.py:573`), das Modell-Labelschema sagt `5` = Kanal, `1` =
  Maxilla — reale Inferenz würde mit Stock-Konfiguration stillschweigend die
  **falsche Anatomie** extrahieren. Default auf Modellmetadatum 5 heben und
  in `.env.example` dokumentieren.
- **P7.1 zusätzlich**: Root-`VERSION` (1.0.0) vs. README-Komponententabelle
  (v0.2.0); `docs/AI-ASSIST-ARCHITECTURE.md:277` nennt nicht existente
  Variablen `AI_ASSIST_ENABLED`/`AI_ASSIST_DEMO_MODE` (real:
  `AI_INFERENCE_ENABLED`, `AI_INFERENCE_DEMO_MODE`); `.env.example` fehlen
  `AI_INFERENCE_DEMO_MODE`, `AI_INFERENCE_CANAL_LABEL` und das neue
  `AI_INFERENCE_PERSIST_DEMO_SEG`; `ai-inference/README.md`-Compose-Beispiel
  sagt `mps` als Device, real ist `cpu` der Compose-Default;
  `docs/TESTING.md` erwähnt die komplette Pytest-Suite nicht.
- **Optional, nicht blockierend**: `/api/ai/health` ruft bei jedem Aufruf
  Orthanc auf (kein Cache) — Healthcheck-Polling multipliziert Netzcalls.

### 18.4 Ausführungsoptimierung

- **P1 parallelisieren**: P1.1 (nur `extensions/dental-cpr/`) und P1.2+P1.3
  (nur `ai-inference/`) sind disjunkt und laufen parallel; G1 bleibt
  gemeinsames Gate danach.
- Track B endet ohne bereits vorhandene Gewichte und ohne ausdrückliche
  Download-Autorisierung als `pending_external_artifact` — Track A wartet
  nicht.
- Commits: Conventional Commits **ohne Co-Author-Zeilen** (CONVENTIONS.md,
  Abschnitt 14). Jede Phase staged nur ihre explizit benannten Dateien,
  kein `git add -A` — der Arbeitsbaum enthält Änderungen mehrerer Phasen.
- Nach jedem Viewer-Docker-Build: Browser öffnen und Screenshot als
  Verifikationsartefakt ablegen (PHI-frei).

