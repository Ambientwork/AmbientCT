# Setup-Guide — AmbientCT

> Schritt-für-Schritt-Anleitung für Praxis-Administratoren.
> Keine Programmierkenntnisse nötig.

## Was Sie brauchen

| Was | Minimum | Empfohlen |
|-----|---------|-----------|
| Computer | Jeder Desktop-PC oder Mac | Dedizierter Mini-PC (z.B. Intel NUC) |
| Arbeitsspeicher | 4 GB RAM | 8 GB RAM |
| Festplatte | 20 GB frei | 100 GB+ SSD (für CBCT-Daten) |
| Betriebssystem | Windows 10/11, macOS 12+, Ubuntu 22.04+ | — |
| Netzwerk | LAN-Verbindung | Gigabit-Ethernet |
| Software | Docker Desktop | — |

> **Wichtig:** AmbientCT läuft komplett lokal in Ihrem Praxis-Netzwerk.
> Keine Cloud, keine Internetverbindung nötig nach der Installation.

---

## Schritt 1: Docker Desktop installieren

Docker ist das Programm, das AmbientCT ausführt. Es ist kostenlos.

### Windows
1. Öffnen Sie https://www.docker.com/products/docker-desktop/
2. Klicken Sie auf **"Download for Windows"**
3. Führen Sie die heruntergeladene `.exe`-Datei aus
4. Folgen Sie dem Installationsassistenten (alle Standardeinstellungen beibehalten)
5. Starten Sie den Computer neu, wenn aufgefordert
6. Starten Sie Docker Desktop — das Wal-Symbol erscheint in der Taskleiste

### macOS
1. Öffnen Sie https://www.docker.com/products/docker-desktop/
2. Klicken Sie auf **"Download for Mac"** (Apple Chip oder Intel — je nach Ihrem Mac)
3. Ziehen Sie Docker in den Programme-Ordner
4. Starten Sie Docker aus dem Programme-Ordner
5. Erlauben Sie die System-Berechtigungen, wenn gefragt
6. Das Wal-Symbol erscheint in der Menüleiste

### Prüfen
Öffnen Sie ein Terminal (Windows: PowerShell, Mac: Terminal) und tippen Sie:
```bash
docker --version
```
Sie sollten etwas wie `Docker version 27.x.x` sehen.

---

## Schritt 2: AmbientCT herunterladen

### Variante A: Mit Git (empfohlen)
```bash
git clone https://github.com/Ambientwork/AmbientCT.git
cd AmbientCT
```

### Variante B: Ohne Git
1. Öffnen Sie https://github.com/Ambientwork/AmbientCT
2. Klicken Sie auf den grünen **"Code"**-Button → **"Download ZIP"**
3. Entpacken Sie die ZIP-Datei in einen Ordner Ihrer Wahl
4. Öffnen Sie ein Terminal und navigieren Sie in den Ordner:
   ```bash
   cd /Pfad/zum/AmbientCT
   ```

---

## Schritt 3: Setup-Wizard ausführen

```bash
./scripts/setup.sh
```

Der Wizard macht automatisch Folgendes:
- Prüft ob Docker läuft
- Prüft ob die benötigten Ports (3000, 8042, 4242) frei sind
- Erstellt die Konfigurationsdatei (`.env`) mit einem sicheren Passwort
- Lädt die Docker-Images herunter (ca. 500 MB, einmalig)

**Wichtig:** Notieren Sie sich das angezeigte Passwort! Es steht auch in der `.env`-Datei.

> **Windows-Nutzer:** Wenn `./scripts/setup.sh` nicht funktioniert, verwenden Sie:
> ```bash
> bash scripts/setup.sh
> ```

---

## Schritt 4: AmbientCT starten

```bash
docker compose up -d
```

Warten Sie ca. 30 Sekunden. Dann:

| Dienst | URL | Zweck |
|--------|-----|-------|
| **OHIF Viewer** | http://localhost:3000 | Bilder ansehen — hier arbeiten Ihre Mitarbeiter |
| **Orthanc Admin** | http://localhost:8042 | Server-Verwaltung (nur für Admin) |

Öffnen Sie http://localhost:3000 in Ihrem Browser. Sie sollten den OHIF Viewer sehen.

---

## Schritt 5: Erste Bilder importieren

### Per Drag & Drop (einfachste Methode)
1. Öffnen Sie den OHIF Viewer (http://localhost:3000)
2. Ziehen Sie `.dcm`-Dateien oder einen ganzen DICOM-Ordner in das Browserfenster
3. Die Bilder werden automatisch importiert und erscheinen in der Studienliste

### Per DICOM-Netzwerk (von anderen Geräten)
Ihr CBCT-Scanner oder DVT kann Bilder direkt an AmbientCT senden:

| Einstellung | Wert |
|-------------|------|
| AE Title | `DENTALPACS` |
| Host/IP | IP-Adresse Ihres AmbientCT-Computers |
| Port | `4242` |

So finden Sie Ihre IP-Adresse:
- **Windows:** `ipconfig` im Terminal → IPv4-Adresse
- **Mac/Linux:** `ifconfig` oder `ip addr` → en0/eth0

### Per Kommandozeile (für Experten)
```bash
curl -u admin:IHR_PASSWORT -X POST http://localhost:8042/instances \
  --data-binary @/pfad/zur/datei.dcm
```

---

## Schritt 6: Smoke-Test

Prüfen Sie, ob alles funktioniert:
```bash
./scripts/smoke-test.sh
```

Erwartete Ausgabe:
```
✅ Orthanc container running
✅ OHIF Viewer container running
✅ Orthanc HTTP responding
✅ Orthanc DICOMweb endpoint
✅ OHIF responding on port
✅ DICOM upload via REST API
🎉 All checks passed!
```

---

## Täglicher Betrieb

### Starten
```bash
docker compose up -d
```
> **Tipp:** AmbientCT startet automatisch mit, wenn Docker Desktop beim
> Systemstart läuft (Einstellung: `restart: unless-stopped`).

### Stoppen
```bash
docker compose down
```
Ihre Daten bleiben erhalten (Docker Volume).

### Status prüfen
```bash
docker compose ps
```

### Logs ansehen
```bash
docker compose logs orthanc
docker compose logs viewer
```

---

## Backup

**Wichtig:** Erstellen Sie regelmäßige Backups Ihrer DICOM-Daten!

```bash
./scripts/backup.sh
```

Das Backup wird unter `~/backups/ambientct/` gespeichert. Es enthält alle DICOM-Bilder und die Orthanc-Datenbank.

- Die letzten 10 Backups werden aufbewahrt, ältere automatisch gelöscht
- Kopieren Sie Backups auf eine externe Festplatte oder einen verschlüsselten USB-Stick
- **Niemals** unverschlüsselt in die Cloud hochladen (Patientendaten!)

### Backup-Zeitplan (empfohlen)
| Häufigkeit | Methode |
|------------|---------|
| Täglich | `./scripts/backup.sh` manuell oder per Cron-Job |
| Wöchentlich | Kopie auf externe Festplatte |
| Monatlich | Zweite Kopie an einem anderen Ort |

### Cron-Job einrichten (automatisches Backup)
```bash
# Tägliches Backup um 22:00 Uhr
crontab -e
# Fügen Sie diese Zeile hinzu:
0 22 * * * /pfad/zu/AmbientCT/scripts/backup.sh
```

---

## Zugriff von anderen Computern im Netzwerk

Andere Computer in Ihrem Praxis-Netzwerk können den Viewer nutzen:

1. Finden Sie die IP-Adresse des AmbientCT-Computers (z.B. `192.168.1.100`)
2. Auf den anderen Computern öffnen Sie: `http://192.168.1.100:3000`

> **Hinweis:** Der Orthanc-Admin (Port 8042) ist ebenfalls erreichbar.
> Schützen Sie diesen Zugang mit dem Passwort aus der `.env`-Datei.

---

## Update

```bash
cd /pfad/zu/AmbientCT
git pull                    # Neuste Version holen
docker compose pull         # Neue Docker-Images holen
docker compose up -d        # Neu starten
./scripts/smoke-test.sh     # Prüfen
```

---

## Deinstallation

```bash
# Stoppen und Container entfernen
docker compose down

# DICOM-Daten löschen (ACHTUNG: unwiderruflich!)
docker volume rm ambientct_orthanc-db

# Projektordner löschen
rm -rf /pfad/zu/AmbientCT
```

---

## Hinweise

- **Datenschutz:** AmbientCT läuft lokal. Keine Daten verlassen Ihr Netzwerk.
- **Kein Medizinprodukt:** AmbientCT ist nicht als Medizinprodukt zertifiziert (kein CE/FDA). Diagnoseentscheidungen müssen immer auf zertifizierten Systemen verifiziert werden.
- **Support:** Bei Problemen siehe [Troubleshooting](TROUBLESHOOTING.md) oder erstellen Sie ein Issue auf GitHub.
