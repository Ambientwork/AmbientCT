#!/bin/bash
set -euo pipefail

# AmbientCT Backup — DICOM Data
# Creates a compressed backup of the Orthanc database and DICOM files.
# Usage: ./scripts/backup.sh [--output-dir /path/to/backups]

BACKUP_DIR="${1:-$HOME/backups/ambientct}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/ambientct-backup-$TIMESTAMP.tar.gz"
VOLUME_NAME="ambientct_orthanc-db"

echo ""
echo "🦷 AmbientCT Backup"
echo "==================="
echo ""

# Check if volume exists
if ! docker volume inspect "$VOLUME_NAME" > /dev/null 2>&1; then
  echo "❌ Docker volume '$VOLUME_NAME' not found."
  echo "   Is the stack running? Try: docker compose up -d"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Backing up Orthanc data..."
docker run --rm \
  -v "${VOLUME_NAME}:/data:ro" \
  -v "$BACKUP_DIR:/backup" \
  alpine tar czf "/backup/ambientct-backup-$TIMESTAMP.tar.gz" -C /data .

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo ""
echo "✅ Backup complete"
echo "   File: $BACKUP_FILE"
echo "   Size: $SIZE"
echo ""

# Cleanup old backups (keep last 10)
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/ambientct-backup-*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 10 ]; then
  ls -1t "$BACKUP_DIR"/ambientct-backup-*.tar.gz | tail -n +11 | xargs rm -f
  echo "🧹 Cleaned up old backups (kept last 10)"
fi

echo ""
echo "⚠️  Remember: Copy this backup to an external drive!"
echo "   This backup contains DICOM patient data."
echo "   Do NOT upload to cloud storage without encryption."
echo ""
