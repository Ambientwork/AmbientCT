# Claude Code Hooks — AmbientCT

## Was sind Hooks?
Automatische Befehle die zu bestimmten Zeitpunkten einer Claude Code
Session ausgeführt werden. Sie sorgen dafür, dass Kontext erhalten bleibt,
Erkenntnisse gesichert werden, und jede Session sauber dokumentiert ist.

## Konfiguration

In `.claude/settings.json`:

```json
{
  "hooks": {
    "session_start": [
      "python3 scripts/scrub.py logs/ 2>/dev/null || true",
      "cat docs/SESSION-LOG.md | tail -30",
      "echo '--- Session started at $(date) ---' >> docs/SESSION-LOG.md"
    ],
    "pre_compact": [
      "if [ -z \"$(tail -n 5 docs/SESSION-LOG.md | grep 'Key decisions')\" ]; then echo '⛔ BLOCKED: Log your key decisions BEFORE compacting! Write them in docs/SESSION-LOG.md first.'; exit 1; fi",
      "echo '## Pre-Compact Save ($(date))' >> docs/SESSION-LOG.md"
    ],
    "session_stop": [
      "echo '## Session End ($(date))' >> docs/SESSION-LOG.md",
      "git diff --stat >> docs/SESSION-LOG.md 2>/dev/null || true",
      "echo '' >> docs/SESSION-LOG.md",
      "echo '### Auto Case Study Draft' >> docs/SESSION-LOG.md",
      "git log -1 --format='Feature built: %s' >> docs/SESSION-LOG.md 2>/dev/null || true"
    ]
  }
}
```

## Was jeder Hook tut

### session_start
1. **Scrubbt Logdateien** — `scripts/scrub.py` entfernt Patientennamen,
   IDs, Geburtsdaten, Emails und API Keys aus Logs. DSGVO-Schutz.
   Passiert BEVOR Claude irgendetwas liest.
2. Liest die letzten 30 Zeilen des Session-Logs (Kontext)
3. Loggt den Session-Start

### pre_compact
**Validierung eingebaut:** Wenn die letzten 5 Zeilen des Session-Logs
kein "Key decisions" enthalten, wird `/compact` BLOCKIERT.
Du musst zuerst dokumentieren was du entschieden hast.

### session_stop
1. Schreibt `git diff --stat` ins Log (was wurde geändert)
2. Schreibt den letzten Commit als Case-Study-Prompt ins Log
   → Cowork kann daraus Content generieren

## DSGVO: Warum Scrubbing im Hook sein MUSS

```
OHNE Scrubbing:
  Orthanc Log: "PatientName=Mueller^Hans"
  Du: "Claude, schau dir diesen Error-Log an"
  → Patientenname geht an Anthropic API = DSGVO-Verstoss

MIT Scrubbing (session_start Hook):
  scrub.py: "PatientName: [REDACTED_NAME]"
  Claude sieht nur [REDACTED_NAME]
  → Kein Verstoss
```

## Wann /compact nutzen

Nach jeder abgeschlossenen Major Task. Nicht mittendrin.
Der pre_compact Hook erzwingt dass du vorher dokumentierst.
