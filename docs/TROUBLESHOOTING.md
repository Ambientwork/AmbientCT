# Troubleshooting — AmbientCT

> Die 10 häufigsten Probleme und ihre Lösungen.

---

## 1. Docker Desktop startet nicht / ist nicht installiert

**Symptom:** `docker: command not found` oder `Cannot connect to the Docker daemon`

**Lösung:**
1. Docker Desktop installieren: https://www.docker.com/products/docker-desktop/
2. Docker Desktop starten (Wal-Symbol in der Taskleiste/Menüleiste)
3. Warten bis das Symbol nicht mehr animiert (ca. 30 Sekunden)
4. Erneut versuchen:
   ```bash
   docker --version
   docker compose version
   ```

**Windows-spezifisch:** WSL2 muss aktiviert sein. Docker Desktop fordert dies beim ersten Start an.

---

## 2. Port bereits belegt

**Symptom:** `Bind for 0.0.0.0:3000 failed: port is already allocated`

**Lösung:**
Prüfen Sie, welches Programm den Port nutzt:
```bash
# macOS/Linux
lsof -i :3000
lsof -i :8042

# Windows (PowerShell)
netstat -ano | findstr :3000
```

Entweder das andere Programm stoppen oder die Ports in `.env` ändern:
```env
VIEWER_PORT=3001        # statt 3000
ORTHANC_HTTP_PORT=8043  # statt 8042
```

Danach: `docker compose down && docker compose up -d`

---

## 3. OHIF Viewer zeigt leere Seite / lädt nicht

**Symptom:** http://localhost:3000 zeigt weiße Seite oder Endlos-Ladebalken

**Ursachen & Lösungen:**

**a) Orthanc ist noch nicht bereit:**
```bash
docker compose ps
```
Der Orthanc-Container muss `healthy` zeigen. Warten Sie 30–60 Sekunden nach dem Start.

**b) Browser-Cache:**
Drücken Sie `Ctrl+Shift+R` (Windows) oder `Cmd+Shift+R` (Mac) für einen Hard-Refresh.

**c) Container neu starten:**
```bash
docker compose restart viewer
```

**d) Logs prüfen:**
```bash
docker compose logs viewer
```

---

## 4. DICOM-Upload funktioniert nicht

**Symptom:** Drag & Drop zeigt Fehler oder Bilder erscheinen nicht in der Liste

**Lösung:**

**a) Orthanc erreichbar?**
```bash
curl -u admin:IHR_PASSWORT http://localhost:8042/system
```
Sollte JSON mit Orthanc-Version zurückgeben.

**b) Upload per Kommandozeile testen:**
```bash
curl -u admin:IHR_PASSWORT -X POST http://localhost:8042/instances \
  --data-binary @/pfad/zur/datei.dcm
```
Bei Erfolg kommt `{"Status": "Success"}` oder `{"Status": "AlreadyStored"}`.

**c) Dateiformat prüfen:**
- Nur echte DICOM-Dateien (`.dcm`) werden akzeptiert
- JPEG/PNG-Bilder sind kein DICOM — sie müssen vorher konvertiert werden

**d) Speicherplatz prüfen:**
```bash
docker system df
```

---

## 5. Orthanc-Admin nicht erreichbar

**Symptom:** http://localhost:8042 zeigt "Verbindung abgelehnt"

**Lösung:**
```bash
# Container-Status prüfen
docker compose ps

# Ist der Container gestartet?
docker compose logs orthanc | tail -20

# Neustart
docker compose restart orthanc
```

**Passwort vergessen?** Das Passwort steht in der `.env`-Datei:
```bash
cat .env | grep ORTHANC_PASSWORD
```

---

## 6. DICOM-Gerät kann nicht an AmbientCT senden

**Symptom:** CBCT-Scanner/DVT findet AmbientCT nicht oder Senden schlägt fehl

**Checkliste:**
1. Sind beide Geräte im selben Netzwerk?
2. Stimmen die DICOM-Einstellungen?
   - AE Title: `DENTALPACS`
   - Port: `4242`
   - Host: IP-Adresse des AmbientCT-Computers
3. Firewall-Regel: Port `4242` muss eingehend erlaubt sein

**Firewall öffnen:**
```bash
# Linux (ufw)
sudo ufw allow 4242/tcp

# Windows (PowerShell als Admin)
New-NetFirewallRule -DisplayName "AmbientCT DICOM" -Direction Inbound -Port 4242 -Protocol TCP -Action Allow
```

**Verbindung testen (von einem anderen Rechner):**
```bash
# Prüft ob Port offen ist
nc -zv IP_DES_SERVERS 4242

# Oder mit echostorecu (wenn dcmtk installiert)
echoscu -aec DENTALPACS IP_DES_SERVERS 4242
```

---

## 7. Bilder laden langsam / Viewer ruckelt

**Symptom:** 3D-Ansicht (MPR) lädt sehr langsam, Viewer reagiert träge

**Lösungen:**

**a) Docker mehr Ressourcen zuweisen:**
Docker Desktop → Einstellungen → Resources:
- Memory: mindestens 4 GB (besser 8 GB)
- CPUs: mindestens 2

**b) WebGL prüfen:**
AmbientCT nutzt GPU-beschleunigtes Rendering. Öffnen Sie `chrome://gpu` und prüfen Sie ob WebGL aktiv ist.

**c) Browser wechseln:**
Chrome/Edge bieten die beste WebGL-Performance. Safari und Firefox können langsamer sein.

**d) Große Studien:**
CBCT-Datensätze mit 500+ Schichten sind rechenintensiv. Das ist bei jedem DICOM-Viewer so.

---

## 8. "Container unhealthy" oder Endlos-Neustart

**Symptom:** `docker compose ps` zeigt `unhealthy` oder Container startet immer wieder neu

**Lösung:**
```bash
# Detaillierte Logs ansehen
docker compose logs orthanc --tail 50

# Container komplett neu erstellen
docker compose down
docker compose up -d

# Im Extremfall: Images neu laden
docker compose pull
docker compose up -d --force-recreate
```

**Häufige Ursache:** Beschädigte Datenbank nach Stromausfall.
```bash
# Backup erstellen (falls möglich)
./scripts/backup.sh

# Volume neu erstellen (ACHTUNG: Daten gehen verloren!)
docker compose down
docker volume rm ambientct_orthanc-db
docker compose up -d
```

---

## 9. Update schlägt fehl

**Symptom:** `docker compose pull` oder `git pull` zeigt Fehler

**Lösung:**

**Git-Konflikte:**
```bash
# Lokale Änderungen sichern
git stash

# Update holen
git pull

# Lokale Änderungen zurückholen
git stash pop
```

**Docker-Image-Probleme:**
```bash
# Alte Images aufräumen
docker system prune -f

# Neu herunterladen
docker compose pull
docker compose up -d
```

---

## 10. Datenschutz-Bedenken (DSGVO)

**Frage:** Sind Patientendaten sicher?

**Antwort:**
- AmbientCT läuft **komplett lokal**. Keine Daten verlassen Ihr Netzwerk.
- Kein Cloud-Upload, keine Telemetrie, kein Tracking.
- DICOM-Daten liegen in einem Docker-Volume auf Ihrer lokalen Festplatte.
- Zugriff auf Orthanc ist passwortgeschützt (Basic Auth).

**Empfehlungen:**
- Regelmäßige Backups auf verschlüsselten Datenträgern
- Zugang zum Server-Raum beschränken
- Starkes Passwort in `.env` verwenden
- Für Zugriff außerhalb des LANs: VPN verwenden, **niemals** Ports ins Internet öffnen
- Festplattenverschlüsselung aktivieren (BitLocker/FileVault)

---

## Schnelldiagnose

Wenn Sie nicht wissen, wo das Problem liegt — führen Sie den Smoke-Test aus:

```bash
./scripts/smoke-test.sh
```

Er prüft automatisch alle kritischen Komponenten und zeigt genau, was nicht funktioniert.

### Log-Dateien sammeln (für Support)

```bash
# Alle Logs in eine Datei
docker compose logs > /tmp/ambientct-logs.txt 2>&1

# Docker-Info
docker compose ps >> /tmp/ambientct-logs.txt
docker system df >> /tmp/ambientct-logs.txt
```

> **Achtung:** Logs können Patientennamen enthalten! Vor dem Teilen:
> ```bash
> python3 scripts/scrub.py /tmp/ambientct-logs.txt
> ```
