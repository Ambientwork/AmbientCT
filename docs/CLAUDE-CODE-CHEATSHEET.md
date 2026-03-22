# Claude Code Cheat Sheet — Für Conductor Sessions

Ausdrucken oder als Sticky Note auf dem Desktop.

---

## VOR jeder Session

```
□  /status line          → Token-Verbrauch sehen (Tankanzeige)
□  Nur nötige MCPs aktiv → Unnötige fressen 20k+ Tokens
□  Richtiges Modell wählen:
   - Haiku:  Datei suchen, grep, einfache Edits
   - Sonnet: Multi-File Changes, Scripts, Tests
   - Opus:   Architektur, Security Review, harte Bugs
```

## WÄHREND der Session

```
□  Plan-First: "Erstelle einen Plan" → Prüfen → "Go"
□  Referenzcode zeigen: "Orientiere dich an [Open-Source-Repo X]"
□  /compact nach jeder fertigen Major-Task
□  NICHT /compact mitten in der Arbeit (Kontext geht verloren)
□  /status line regelmässig checken
```

## Sub-Agents (Conductor)

```
□  Jeder Agent = EINE Aufgabe, nicht drei
□  Agent 1: Plant  → Ergebnis an Agent 2
□  Agent 2: Baut   → Ergebnis an Agent 3
□  Agent 3: Prüft  → Ergebnis: fertig oder zurück an 2
□  Agents arbeiten in isolierten Git Worktrees (Conductor macht das)
```

## NACH der Session

```
□  Session-Log prüfen: docs/SESSION-LOG.md
□  git status → nichts uncommitted zurücklassen
□  Nächste Tasks als GitHub Issues anlegen
```

## Sicherheit

```
⚠️  Nicht zu viele MCPs gleichzeitig (Token-Verschwendung)
⚠️  Auto-Compact nicht blind vertrauen → manuell /compact
⚠️  Prompt Injection Risiko wenn Claude externe URLs/Daten liest
⚠️  ANTHROPIC_API_KEY darf NICHT gesetzt sein (Max Plan nutzen!)
```

---

## Modell-Routing Quick Reference

| Task | Modell | Warum |
|------|--------|-------|
| "Finde alle Dateien die Orthanc referenzieren" | Haiku | Einfaches grep |
| "Ändere 5 Config-Dateien für SSL" | Sonnet | Multi-File, mittlere Komplexität |
| "Schreibe smoke-test.sh" | Sonnet | Script-Writing, klar definiert |
| "Review die gesamte Docker-Architektur auf Security-Lücken" | Opus | Braucht tiefes Reasoning |
| "Warum crashed OHIF beim Volume Rendering?" | Opus | Komplexer Debug |
| "Formatiere README.md schöner" | Haiku | Triviale Textarbeit |
| "Implementiere DICOM Upload mit Progress" | Sonnet | Standard Feature-Work |

## /compact Timing

```
✅ COMPACT nach:          ❌ NICHT compact:
- Docker-Compose fertig    - Mitten im Feature
- Test-Suite geschrieben   - Nach kleinem Typo-Fix
- README überarbeitet      - Wenn du gleich weitermachst
- Architektur-Entscheidung - Bei kurzen Sessions (<30min)
- Security Review done
```
