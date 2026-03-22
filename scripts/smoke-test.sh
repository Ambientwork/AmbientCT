#!/bin/bash
set -euo pipefail

# AmbientCT Smoke Test
# Validates that all services are running and connected.
# Usage: ./scripts/smoke-test.sh
# Requires: docker compose stack running, curl

ORTHANC_URL="http://localhost:${ORTHANC_HTTP_PORT:-8042}"
VIEWER_URL="http://localhost:${VIEWER_PORT:-3000}"
ORTHANC_USER="${ORTHANC_USER:-admin}"
ORTHANC_PASSWORD="${ORTHANC_PASSWORD:-changeme-on-first-run}"
PASS=0
FAIL=0

check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "🦷 AmbientCT Smoke Test"
echo "========================"
echo ""

echo "Docker containers:"
check "Orthanc container running" \
  "docker ps --filter 'name=ambientct-orthanc' --format '{{.Status}}' | grep -q 'Up'"
check "OHIF Viewer container running" \
  "docker ps --filter 'name=ambientct-viewer' --format '{{.Status}}' | grep -q 'Up'"

echo ""
echo "Orthanc PACS:"
check "Orthanc HTTP responding" \
  "curl -sf -u ${ORTHANC_USER}:${ORTHANC_PASSWORD} ${ORTHANC_URL}/system"
check "Orthanc DICOMweb endpoint" \
  "curl -sf -u ${ORTHANC_USER}:${ORTHANC_PASSWORD} ${ORTHANC_URL}/dicom-web/studies"

echo ""
echo "OHIF Viewer:"
check "OHIF responding on port" \
  "curl -sf ${VIEWER_URL} | grep -q 'html'"

echo ""
echo "DICOM Upload Test:"
# Create a minimal valid DICOM file for testing
TEMP_DCM=$(mktemp /tmp/test-XXXX.dcm)
# Minimal DICOM preamble (128 bytes) + DICM magic + basic tags
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
  UPLOAD_RESULT=$(curl -sf -u ${ORTHANC_USER}:${ORTHANC_PASSWORD} \
    -X POST "${ORTHANC_URL}/instances" \
    --data-binary @"$TEMP_DCM" 2>&1) || UPLOAD_RESULT=""

  if echo "$UPLOAD_RESULT" | grep -q '"Status"'; then
    check "DICOM upload via REST API" "true"
  else
    check "DICOM upload via REST API" "false"
  fi
else
  echo "  ⚠️  Could not create test DICOM (python3 not available)"
fi
rm -f "$TEMP_DCM"

echo ""
echo "========================"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "  ⚠️  Some checks failed. Run 'docker compose logs' for details."
  exit 1
else
  echo "  🎉 All checks passed!"
  exit 0
fi
