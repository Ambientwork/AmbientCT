#!/usr/bin/env python3
"""
scrub.py — DSGVO-konformes Log-Scrubbing für Claude Code Sessions.

Entfernt Patientennamen, IDs, Geburtsdaten, Emails, IPs und API Keys
aus Logdateien BEVOR sie von Claude gelesen werden.

Verwendung:
  python3 scripts/scrub.py logs/orthanc.log
  python3 scripts/scrub.py logs/*.log

Integration:
  Wird automatisch im session_start Hook aufgerufen.
  Siehe .claude/settings.json und docs/HOOKS.md.
"""

import re
import sys
import os
import glob

PATTERNS = {
    # DICOM-spezifische Felder (Orthanc Logs)
    r'(?i)PatientName\s*[:=]\s*\S+.*': "PatientName: [REDACTED_NAME]",
    r'(?i)PatientID\s*[:=]\s*\S+.*': "PatientID: [REDACTED_ID]",
    r'(?i)PatientBirthDate\s*[:=]\s*\S+.*': "PatientBirthDate: [REDACTED_DATE]",
    r'(?i)ReferringPhysician\s*[:=]\s*\S+.*': "ReferringPhysician: [REDACTED_NAME]",
    r'(?i)InstitutionName\s*[:=]\s*\S+.*': "InstitutionName: [REDACTED_INSTITUTION]",

    # DICOM Tags in JSON-Format (Orthanc REST API Responses)
    r'"0010,0010":\s*\{[^}]*"Value"\s*:\s*"[^"]*"': '"0010,0010": {"Value": "[REDACTED_NAME]"',
    r'"0010,0020":\s*\{[^}]*"Value"\s*:\s*"[^"]*"': '"0010,0020": {"Value": "[REDACTED_ID]"',
    r'"0010,0030":\s*\{[^}]*"Value"\s*:\s*"[^"]*"': '"0010,0030": {"Value": "[REDACTED_DATE]"',

    # Allgemeine PII-Muster
    r'\b\d{2}\.\d{2}\.\d{4}\b': "[REDACTED_DATE]",
    r'\b\d{4}-\d{2}-\d{2}\b(?=.*[Pp]atient)': "[REDACTED_DATE]",
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b': "[REDACTED_EMAIL]",
    r'\b(?:\d{1,3}\.){3}\d{1,3}\b': "[REDACTED_IP]",

    # Schweizer AHV-Nummer (756.XXXX.XXXX.XX)
    r'\b756\.\d{4}\.\d{4}\.\d{2}\b': "[REDACTED_AHV]",

    # API Keys (OpenAI, Anthropic, etc.)
    r'sk-[a-zA-Z0-9]{32,}': "[REDACTED_API_KEY]",
    r'eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}': "[REDACTED_JWT]",
}

# Dateien die NICHT gescrubbt werden sollen
SKIP_EXTENSIONS = {'.py', '.js', '.ts', '.md', '.yml', '.yaml', '.json', '.sh'}


def scrub_content(content: str) -> str:
    scrubbed = content
    for pattern, replacement in PATTERNS.items():
        scrubbed = re.sub(pattern, replacement, scrubbed)
    return scrubbed


def scrub_file(file_path: str, dry_run: bool = False) -> bool:
    ext = os.path.splitext(file_path)[1].lower()
    if ext in SKIP_EXTENSIONS:
        return False

    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
    except (IOError, PermissionError) as e:
        print(f"⚠️  Cannot read: {file_path} ({e})")
        return False

    scrubbed = scrub_content(content)

    if scrubbed != content:
        if dry_run:
            print(f"🔍 Would scrub: {file_path}")
        else:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(scrubbed)
            print(f"✅ Scrubbed: {file_path}")
        return True
    return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scrub.py <file_or_glob> [--dry-run]")
        print("  python3 scrub.py logs/orthanc.log")
        print("  python3 scrub.py 'logs/*.log'")
        print("  python3 scrub.py logs/ --dry-run")
        sys.exit(1)

    dry_run = "--dry-run" in sys.argv
    targets = [a for a in sys.argv[1:] if a != "--dry-run"]

    files_to_scrub = []
    for target in targets:
        if os.path.isdir(target):
            files_to_scrub.extend(glob.glob(os.path.join(target, "**", "*"), recursive=True))
        elif '*' in target:
            files_to_scrub.extend(glob.glob(target))
        elif os.path.isfile(target):
            files_to_scrub.append(target)
        else:
            print(f"⚠️  Not found: {target}")

    scrubbed_count = 0
    for f in files_to_scrub:
        if os.path.isfile(f):
            if scrub_file(f, dry_run):
                scrubbed_count += 1

    if scrubbed_count == 0:
        print("✅ No sensitive data found.")
    else:
        action = "would scrub" if dry_run else "scrubbed"
        print(f"\n{'🔍' if dry_run else '✅'} {action} {scrubbed_count} file(s).")


if __name__ == "__main__":
    main()
