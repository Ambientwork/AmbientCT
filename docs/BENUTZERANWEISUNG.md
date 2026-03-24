# AmbientCT — Bedienungsanweisung

> Für Praxis-Personal. Keine Programmierkenntnisse nötig.

---

## Übersicht: Was ist AmbientCT?

AmbientCT ist ein **CBCT/DICOM-Bildbetrachter** für Zahnarztpraxen — vollständig lokal, keine Cloud.

| Komponente | Was es tut |
|---|---|
| **OHIF Viewer** | Zeigt Röntgenbilder und CBCT-Aufnahmen im Browser |
| **Orthanc** | Speichert und verwaltet alle Bilddaten (PACS) |
| **Dental CPR** | Erstellt Panorama-Rekonstruktionen aus CBCT-Daten |

---

## 1. System starten

Öffnen Sie ein Terminal (Mac: `Terminal`, Windows: `PowerShell`) und tippen Sie:

```bash
cd ~/dev/AmbientCT
docker compose up -d
```

Warten Sie ca. 30 Sekunden. Das System ist bereit, wenn Sie sehen:
```
✔ Container ambientct-orthanc  Started
✔ Container ambientct-viewer   Started
```

**Status prüfen:**
```bash
docker compose ps
```
Beide Container müssen `Up` und `healthy` anzeigen.

---

## 2. Viewer öffnen

Öffnen Sie Ihren Browser und rufen Sie auf:

| Zugang | URL |
|---|---|
| **Viewer (Bilder ansehen)** | http://localhost:3000 |
| **Orthanc (Bilder verwalten)** | http://localhost:8042 |
| **Im Praxisnetzwerk** | http://[IP-des-Computers]:3000 |

> Die IP-Adresse Ihres Computers finden Sie in den Netzwerkeinstellungen oder mit:
> `ifconfig | grep "inet " | grep -v 127.0.0.1` (Mac) bzw. `ipconfig` (Windows)

---

## 3. Bilder hochladen (DICOM-Import)

### Option A: Über Orthanc Web-Interface (empfohlen)

1. Öffnen Sie http://localhost:8042
2. Melden Sie sich an (Standard: `admin` / Passwort aus `.env`)
3. Klicken Sie oben auf **„Upload"**
4. Ziehen Sie DICOM-Dateien oder einen ganzen Ordner in das Upload-Fenster
5. Klicken Sie **„Start the upload"**
6. Die Bilder erscheinen automatisch im Viewer unter http://localhost:3000

### Option B: Per Skript (für IT/Admin)

```bash
cd ~/dev/AmbientCT
./scripts/import-dicom.sh /pfad/zum/dicom/ordner
```

### Option C: Direkt via DICOM-Netz (von Röntgengerät)

Konfigurieren Sie Ihr Röntgengerät mit:
- **AE Title:** `DENTALPACS`
- **Host:** IP-Adresse des Computers
- **Port:** `4242`

---

## 4. CBCT-Studie öffnen

1. Öffnen Sie http://localhost:3000
2. In der Studienübersicht erscheinen alle importierten Aufnahmen
3. Klicken Sie auf eine Studie, um sie zu öffnen
4. CBCT-Studien öffnen automatisch mit dem **2-Panel-Layout** (Axial + 3D)

---

## 5. Panorama-Rekonstruktion erstellen (Dental CPR)

Die **CPR-Funktion** (Curved Planar Reformation) erzeugt ein klassisches Panoramabild aus einer CBCT-Aufnahme.

### Schritt-für-Schritt:

**Schritt 1 — CBCT öffnen**
Öffnen Sie eine CBCT-Studie. Das System erkennt CBCT automatisch und wechselt in den Dental-Modus mit Axial-Ansicht links und CPR-Panel rechts.

**Schritt 2 — Zahnbogen einzeichnen**
- Klicken Sie im **linken Panel (Axial-Ansicht)** auf den ersten Molaren (hinten links)
- Setzen Sie weitere Punkte entlang des Zahnbogens durch einfaches Klicken:
  - Hinterer Molar links → Prämolaren → Frontzähne → Prämolaren → Hinterer Molar rechts
- Empfohlen: **8–12 Punkte** für eine genaue Kurve

**Schritt 3 — Kurve abschließen**
Doppelklicken Sie auf den letzten Punkt (hinterer Molar rechts).

**Schritt 4 — Panorama ansehen**
Das **rechte Panel** zeigt sofort das rekonstruierte Panoramabild.

**Schritt 5 — Slab-Dicke anpassen**
Mit dem **Slab-Regler** (1–20 mm) passen Sie die Projektionsdicke an:
- Dünner Slab (1–3 mm): Scharfe Einzelschicht, ideal für Strukturdetails
- Dicker Slab (5–15 mm): MIP-Projektion, ähnlich klassischem OPG

### Tipps für eine gute Rekonstruktion:

| Situation | Empfehlung |
|---|---|
| Punkte falsch gesetzt | Klicken Sie den falschen Punkt an → Entfernen-Taste |
| Panorama verzerrt | Kurve zu flach oder zu steil → Punkte neu setzen |
| Bild zu dunkel/hell | Fenster-/Niveau-Werkzeug (W/L) anpassen |
| Kurve neu zeichnen | Tool zurücksetzen, neu beginnen |

---

## 6. Bilder exportieren

### Screenshot speichern
Im OHIF Viewer: **Kamera-Symbol** in der Toolbar → Bild als PNG herunterladen.

### DICOM exportieren (via Orthanc)
1. Öffnen Sie http://localhost:8042
2. Suchen Sie die Studie
3. Klicken Sie **„Download as ZIP"**

---

## 7. System stoppen

Wenn Sie AmbientCT nicht mehr benötigen:

```bash
cd ~/dev/AmbientCT
docker compose down
```

> **Daten bleiben erhalten.** Beim nächsten `docker compose up -d` sind alle Bilder noch vorhanden.

---

## 8. Häufige Fragen

**„Der Viewer lädt nicht."**
→ Warten Sie 30–60 Sekunden nach dem Start. Prüfen Sie: `docker compose ps` — sind beide Container `Up`?

**„Ich sehe keine Bilder."**
→ Prüfen Sie, ob der Import abgeschlossen ist. Reload im Browser (F5).

**„Das Passwort für Orthanc stimmt nicht."**
→ Das Passwort steht in der Datei `.env` im AmbientCT-Ordner. Fragen Sie Ihren Administrator.

**„Der Computer startet neu und AmbientCT läuft nicht."**
→ Docker startet nicht automatisch. Führen Sie nach dem Neustart `docker compose up -d` aus.

**„Wie sehe ich Fehler-Logs?"**
```bash
docker compose logs viewer   # OHIF Viewer Logs
docker compose logs orthanc  # Orthanc Logs
```

---

## 9. Notfallkontakt / Support

Bei technischen Problemen:
- GitHub Issues: https://github.com/Ambientwork/AmbientCT/issues
- E-Mail: support@ambientwork.ai

---

*AmbientCT — Open-Source DICOM Viewer | Ambientwork | MIT Licence*
