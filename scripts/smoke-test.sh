#!/bin/bash
# shellcheck disable=SC2317
set -euo pipefail

# AmbientCT Smoke Test
# Validates that all services are running, healthy, and endpoints are reachable.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERBOSE=false
PASS=0
FAIL=0
WARN=0

usage() {
  cat <<'EOF'
Usage: ./scripts/smoke-test.sh [OPTIONS]

Validates that all AmbientCT services are running and endpoints respond.
Tests Docker containers, Orthanc REST API, DICOMweb, DICOM upload, and OHIF Viewer.

Options:
  -h, --help      Show this help message
  -v, --verbose   Show detailed output for each check

Credentials are loaded from .env if present, otherwise uses defaults.

Examples:
  ./scripts/smoke-test.sh             # Quick pass/fail
  ./scripts/smoke-test.sh --verbose   # Detailed output per check
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    -v|--verbose) VERBOSE=true; shift ;;
    *) echo "Unknown option: $1"; echo "Run with --help for usage."; exit 1 ;;
  esac
done

# Load .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_DIR/.env"
  set +a
fi

ORTHANC_URL="http://localhost:${ORTHANC_HTTP_PORT:-8042}"
VIEWER_URL="http://localhost:${VIEWER_PORT:-3000}"
ORTHANC_USER="${ORTHANC_USER:-admin}"
ORTHANC_PASSWORD="${ORTHANC_PASSWORD:-changeme-on-first-run}"
AUTH="${ORTHANC_USER}:${ORTHANC_PASSWORD}"

check() {
  local name="$1"
  shift
  local output
  if output=$("$@" 2>&1); then
    echo "  [PASS] $name"
    PASS=$((PASS + 1))
    if [[ "$VERBOSE" == "true" ]] && [[ -n "$output" ]]; then
      echo "         $(echo "$output" | head -3)"
    fi
  else
    echo "  [FAIL] $name"
    FAIL=$((FAIL + 1))
    if [[ "$VERBOSE" == "true" ]] && [[ -n "$output" ]]; then
      echo "         $(echo "$output" | head -3)"
    fi
  fi
}

warn_check() {
  local name="$1"
  shift
  local output
  if output=$("$@" 2>&1); then
    echo "  [PASS] $name"
    PASS=$((PASS + 1))
  else
    echo "  [WARN] $name"
    WARN=$((WARN + 1))
    if [[ "$VERBOSE" == "true" ]] && [[ -n "$output" ]]; then
      echo "         $(echo "$output" | head -3)"
    fi
  fi
}

echo ""
echo "==============================="
echo "  AmbientCT Smoke Test"
echo "==============================="
echo ""

# --- Docker Containers ---
echo "Docker containers:"
check "Orthanc container running" \
  bash -c "docker ps --filter 'name=ambientct-orthanc' --format '{{.Status}}' | grep -q 'Up'"
check "OHIF Viewer container running" \
  bash -c "docker ps --filter 'name=ambientct-viewer' --format '{{.Status}}' | grep -q 'Up'"

# Container health
ORTHANC_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' ambientct-orthanc 2>/dev/null || echo "unknown")
if [[ "$ORTHANC_HEALTH" == "healthy" ]]; then
  echo "  [PASS] Orthanc health check: $ORTHANC_HEALTH"
  PASS=$((PASS + 1))
else
  echo "  [WARN] Orthanc health check: $ORTHANC_HEALTH"
  WARN=$((WARN + 1))
fi

# --- Orthanc REST API ---
echo ""
echo "Orthanc PACS (${ORTHANC_URL}):"
check "GET /system" \
  curl -sf -u "$AUTH" "${ORTHANC_URL}/system"
check "GET /patients" \
  curl -sf -u "$AUTH" "${ORTHANC_URL}/patients"
check "GET /studies" \
  curl -sf -u "$AUTH" "${ORTHANC_URL}/studies"
check "GET /series" \
  curl -sf -u "$AUTH" "${ORTHANC_URL}/series"
check "GET /instances" \
  curl -sf -u "$AUTH" "${ORTHANC_URL}/instances"
check "GET /modalities" \
  curl -sf -u "$AUTH" "${ORTHANC_URL}/modalities"

# --- DICOMweb ---
echo ""
echo "DICOMweb endpoints:"
check "WADO-RS /dicom-web/studies" \
  curl -sf -u "$AUTH" "${ORTHANC_URL}/dicom-web/studies"
check "QIDO-RS /dicom-web/studies (Accept JSON)" \
  curl -sf -u "$AUTH" -H "Accept: application/dicom+json" "${ORTHANC_URL}/dicom-web/studies"

# --- DICOM DIMSE Port ---
echo ""
echo "DICOM network:"
DICOM_PORT="${ORTHANC_DICOM_PORT:-4242}"
if nc -z localhost "$DICOM_PORT" 2>/dev/null; then
  echo "  [PASS] DIMSE port $DICOM_PORT reachable"
  PASS=$((PASS + 1))
else
  echo "  [WARN] DIMSE port $DICOM_PORT not reachable (may be normal if not exposed)"
  WARN=$((WARN + 1))
fi

# --- OHIF Viewer ---
echo ""
echo "OHIF Viewer (${VIEWER_URL}):"
check "GET / returns HTML" \
  bash -c "curl -sfL '${VIEWER_URL}' | grep -q 'html'"

# --- DICOM Upload Test ---
echo ""
echo "DICOM upload test:"
TEMP_DCM=$(mktemp /tmp/test-XXXX.dcm)
python3 -c "
import struct, sys
# 128-byte preamble + DICM
data = b'\x00' * 128 + b'DICM'
# File Meta Information Group Length (0002,0000)
data += struct.pack('<HH', 0x0002, 0x0000) + b'UL' + struct.pack('<H', 4) + struct.pack('<I', 62)
# Transfer Syntax (0002,0010)
ts = b'1.2.840.10008.1.2.1\x00'
data += struct.pack('<HH', 0x0002, 0x0010) + b'UI' + struct.pack('<H', len(ts)) + ts
# Media Storage SOP Class (0002,0002)
sc = b'1.2.840.10008.5.1.4.1.1.2\x00'
data += struct.pack('<HH', 0x0002, 0x0002) + b'UI' + struct.pack('<H', len(sc)) + sc
# SOP Instance UID (0008,0018)
uid = b'1.2.3.4.5.6.7.8.9.0\x00'
data += struct.pack('<HH', 0x0008, 0x0018) + b'UI' + struct.pack('<H', len(uid)) + uid
# Patient Name (0010,0010)
pn = b'SMOKETEST^AMBIENTCT '
data += struct.pack('<HH', 0x0010, 0x0010) + b'PN' + struct.pack('<H', len(pn)) + pn
sys.stdout.buffer.write(data)
" > "$TEMP_DCM" 2>/dev/null || true

if [ -s "$TEMP_DCM" ]; then
  UPLOAD_RESULT=$(curl -sf -u "$AUTH" \
    -X POST "${ORTHANC_URL}/instances" \
    --data-binary @"$TEMP_DCM" 2>&1) || UPLOAD_RESULT=""

  if echo "$UPLOAD_RESULT" | grep -q '"Status"'; then
    echo "  [PASS] DICOM upload via REST API"
    PASS=$((PASS + 1))
  else
    echo "  [WARN] DICOM upload via REST API (synthetic test file may be rejected)"
    WARN=$((WARN + 1))
    if [[ "$VERBOSE" == "true" ]]; then
      echo "         Response: $(echo "$UPLOAD_RESULT" | head -1)"
    fi
  fi
else
  echo "  [WARN] Could not create test DICOM (python3 not available)"
  WARN=$((WARN + 1))
fi
rm -f "$TEMP_DCM"

# --- Volume Check ---
echo ""
echo "Storage:"
if docker volume inspect ambientct_orthanc-db > /dev/null 2>&1; then
  echo "  [PASS] Docker volume ambientct_orthanc-db exists"
  PASS=$((PASS + 1))
else
  echo "  [WARN] Docker volume ambientct_orthanc-db not found"
  WARN=$((WARN + 1))
fi

# --- Summary ---
echo ""
echo "==============================="
TOTAL=$((PASS + FAIL + WARN))
echo "  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed, ${WARN} warnings"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "  Some checks failed. Run 'docker compose logs' for details."
  exit 1
else
  echo "  All critical checks passed!"
  exit 0
fi
