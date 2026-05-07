#!/bin/bash
set -euo pipefail

# AmbientCT DICOM Bulk Import
# Uploads DICOM files from a directory to Orthanc via REST API.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RECURSIVE=false
IMPORT_DIR=""
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: ./scripts/import-dicom.sh --dir <path> [OPTIONS]

Bulk-imports DICOM files (.dcm) from a directory into Orthanc via REST API.
Duplicates are handled automatically (Orthanc overwrites identical instances).

Options:
  -h, --help          Show this help message
  -d, --dir DIR       Directory containing DICOM files (required)
  -r, --recursive     Search subdirectories recursively
  --dry-run           Show what would be imported without uploading
  --port PORT         Orthanc HTTP port (default: from .env or 8042)
  --user USER         Orthanc username (default: from .env or admin)
  --password PASS     Orthanc password (default: from .env)

Credentials are loaded from .env if present.

Examples:
  ./scripts/import-dicom.sh --dir ~/Downloads/patient-scans
  ./scripts/import-dicom.sh --dir /mnt/cd-rom --recursive
  ./scripts/import-dicom.sh --dir ./test-data --dry-run
EOF
  exit 0
}

# Load .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_DIR/.env"
  set +a
fi

ORTHANC_PORT="${ORTHANC_HTTP_PORT:-8042}"
ORTHANC_USER="${ORTHANC_USER:-admin}"
ORTHANC_PASSWORD="${ORTHANC_PASSWORD:-changeme-on-first-run}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    -d|--dir) IMPORT_DIR="$2"; shift 2 ;;
    -r|--recursive) RECURSIVE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --port) ORTHANC_PORT="$2"; shift 2 ;;
    --user) ORTHANC_USER="$2"; shift 2 ;;
    --password) ORTHANC_PASSWORD="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; echo "Run with --help for usage."; exit 1 ;;
  esac
done

if [ -z "$IMPORT_DIR" ]; then
  echo "ERROR: --dir is required."
  echo "Run with --help for usage."
  exit 1
fi

if [ ! -d "$IMPORT_DIR" ]; then
  echo "ERROR: Directory not found: $IMPORT_DIR"
  exit 1
fi

ORTHANC_URL="http://localhost:${ORTHANC_PORT}"
AUTH="${ORTHANC_USER}:${ORTHANC_PASSWORD}"

echo ""
echo "==============================="
echo "  AmbientCT DICOM Import"
echo "==============================="
echo ""
echo "  Source:  $IMPORT_DIR"
echo "  Target:  $ORTHANC_URL"
echo "  Mode:    $(if [[ "$DRY_RUN" == "true" ]]; then echo "DRY RUN"; else echo "LIVE"; fi)"
echo ""

# Check Orthanc is reachable (skip for dry-run)
if [[ "$DRY_RUN" == "false" ]]; then
  if ! curl -sf -u "$AUTH" "${ORTHANC_URL}/system" > /dev/null 2>&1; then
    echo "ERROR: Cannot reach Orthanc at $ORTHANC_URL"
    echo "  Is the stack running? Try: docker compose up -d"
    exit 1
  fi
  echo "  [OK] Orthanc is reachable"
  echo ""
fi

# Find DICOM files
FILES=()
if [[ "$RECURSIVE" == "true" ]]; then
  while IFS= read -r file; do
    FILES+=("$file")
  done < <(find "$IMPORT_DIR" -type f \( -iname '*.dcm' -o -iname '*.DCM' \) | sort)
else
  while IFS= read -r file; do
    FILES+=("$file")
  done < <(find "$IMPORT_DIR" -maxdepth 1 -type f \( -iname '*.dcm' -o -iname '*.DCM' \) | sort)
fi

TOTAL=${#FILES[@]}

if [ "$TOTAL" -eq 0 ]; then
  echo "  No .dcm files found in $IMPORT_DIR"
  if [[ "$RECURSIVE" == "false" ]]; then
    echo "  Tip: use --recursive to search subdirectories"
  fi
  exit 0
fi

echo "  Found $TOTAL DICOM file(s)"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "  Files that would be imported:"
  for f in "${FILES[@]}"; do
    local_size=$(du -h "$f" | cut -f1)
    echo "    $f  ($local_size)"
  done
  echo ""
  echo "  DRY RUN complete. Use without --dry-run to import."
  exit 0
fi

# Orthanc can either reject duplicates as "AlreadyStored" or accept them as
# successful overwrites when OverwriteInstances=true. Detect the current mode so
# the CLI reports the import result honestly.
OVERWRITE_MODE=$(curl -sf -u "$AUTH" "${ORTHANC_URL}/system" \
  | python3 -c "import sys,json; print(str(json.load(sys.stdin).get('OverwriteInstances', '')).lower())" 2>/dev/null || echo "")

if [[ -z "$OVERWRITE_MODE" && -f "$PROJECT_DIR/config/orthanc.json" ]]; then
  OVERWRITE_MODE=$(python3 - "$PROJECT_DIR/config/orthanc.json" <<'PY'
import json
import sys
from pathlib import Path

try:
    config = json.loads(Path(sys.argv[1]).read_text())
    print(str(config.get("OverwriteInstances", "")).lower())
except Exception:
    print("")
PY
)
fi

if [[ "$OVERWRITE_MODE" == "true" ]]; then
  RESULT_LABEL_SUCCESS="upserted"
  RESULT_SUMMARY_SUCCESS="Upserted"
  RESULT_SUMMARY_SKIPPED_NOTE="(already stored without overwrite)"
else
  RESULT_LABEL_SUCCESS="OK"
  RESULT_SUMMARY_SUCCESS="Imported"
  RESULT_SUMMARY_SKIPPED_NOTE="(already stored)"
fi

# Import files
IMPORTED=0
FAILED=0
SKIPPED=0

for f in "${FILES[@]}"; do
  CURRENT=$((IMPORTED + FAILED + SKIPPED + 1))
  BASENAME=$(basename "$f")
  printf "  [%d/%d] %s ... " "$CURRENT" "$TOTAL" "$BASENAME"

  RESPONSE=$(curl -s -w "\n%{http_code}" -u "$AUTH" \
    -X POST "${ORTHANC_URL}/instances" \
    --data-binary @"$f" 2>&1) || RESPONSE=""

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  case "$HTTP_CODE" in
    200)
      STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Status',''))" 2>/dev/null || echo "")
      if [[ "$STATUS" == "AlreadyStored" ]]; then
        echo "already stored"
        SKIPPED=$((SKIPPED + 1))
      else
        echo "$RESULT_LABEL_SUCCESS"
        IMPORTED=$((IMPORTED + 1))
      fi
      ;;
    *)
      echo "FAILED (HTTP $HTTP_CODE)"
      FAILED=$((FAILED + 1))
      ;;
  esac
done

echo ""
echo "==============================="
echo "  Import complete"
echo "  ${RESULT_SUMMARY_SUCCESS}: $IMPORTED"
echo "  Skipped:  $SKIPPED ${RESULT_SUMMARY_SKIPPED_NOTE}"
echo "  Failed:   $FAILED"
echo "==============================="
echo ""

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
