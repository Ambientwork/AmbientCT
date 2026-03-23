#!/bin/bash
set -euo pipefail

# AmbientCT Backup & Restore
# Creates compressed backups of the Orthanc Docker volume (database + DICOM files).
# Can also restore from a previous backup.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="$HOME/backups/ambientct"
KEEP=10
VOLUME_NAME="ambientct_orthanc-db"
MODE="backup"

usage() {
  cat <<'EOF'
Usage: ./scripts/backup.sh [OPTIONS]

Creates compressed backups of AmbientCT Orthanc data (database + DICOM files).
Can also restore from a previous backup.

Options:
  -h, --help                Show this help message
  -o, --output-dir DIR      Backup directory (default: ~/backups/ambientct)
  -k, --keep N              Number of backups to retain (default: 10)
  -r, --restore FILE        Restore from a backup file
  -l, --list                List available backups
  --volume NAME             Docker volume name (default: ambientct_orthanc-db)

Examples:
  ./scripts/backup.sh                          # Backup with defaults
  ./scripts/backup.sh -o /mnt/nas/backups      # Backup to NAS
  ./scripts/backup.sh --keep 30                # Keep last 30 backups
  ./scripts/backup.sh --list                   # Show available backups
  ./scripts/backup.sh --restore ~/backups/ambientct/ambientct-backup-20240101_120000.tar.gz

IMPORTANT: Backups contain DICOM patient data.
  Do NOT upload to cloud storage without encryption.
  Always copy backups to an external drive.
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    -o|--output-dir) BACKUP_DIR="$2"; shift 2 ;;
    -k|--keep) KEEP="$2"; shift 2 ;;
    -r|--restore) MODE="restore"; RESTORE_FILE="$2"; shift 2 ;;
    -l|--list) MODE="list"; shift ;;
    --volume) VOLUME_NAME="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; echo "Run with --help for usage."; exit 1 ;;
  esac
done

list_backups() {
  echo ""
  echo "Available backups in: $BACKUP_DIR"
  echo ""
  if ls -1 "$BACKUP_DIR"/ambientct-backup-*.tar.gz 2>/dev/null | head -1 > /dev/null; then
    local count=0
    while IFS= read -r f; do
      count=$((count + 1))
      local size
      size=$(du -h "$f" | cut -f1)
      local name
      name=$(basename "$f")
      echo "  ${count}. ${name}  (${size})"
    done < <(ls -1t "$BACKUP_DIR"/ambientct-backup-*.tar.gz 2>/dev/null)
    echo ""
    echo "  Total: ${count} backup(s)"
  else
    echo "  No backups found."
  fi
  echo ""
}

do_backup() {
  echo ""
  echo "==============================="
  echo "  AmbientCT Backup"
  echo "==============================="
  echo ""

  # Check volume exists
  if ! docker volume inspect "$VOLUME_NAME" > /dev/null 2>&1; then
    echo "ERROR: Docker volume '$VOLUME_NAME' not found."
    echo "  Is the stack running? Try: docker compose up -d"
    exit 1
  fi

  mkdir -p "$BACKUP_DIR"

  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="$BACKUP_DIR/ambientct-backup-${timestamp}.tar.gz"

  echo "  Volume:  $VOLUME_NAME"
  echo "  Output:  $backup_file"
  echo ""
  echo "  Backing up..."

  docker run --rm \
    -v "${VOLUME_NAME}:/data:ro" \
    -v "$BACKUP_DIR:/backup" \
    alpine tar czf "/backup/ambientct-backup-${timestamp}.tar.gz" -C /data .

  local size
  size=$(du -h "$backup_file" | cut -f1)

  echo ""
  echo "  [OK] Backup complete"
  echo "  File: $backup_file"
  echo "  Size: $size"

  # Cleanup old backups
  local backup_count
  backup_count=$(find "$BACKUP_DIR" -name 'ambientct-backup-*.tar.gz' -type f | wc -l | tr -d ' ')
  if [ "$backup_count" -gt "$KEEP" ]; then
    local to_delete=$((backup_count - KEEP))
    ls -1t "$BACKUP_DIR"/ambientct-backup-*.tar.gz | tail -n "$to_delete" | xargs rm -f
    echo "  Cleaned up ${to_delete} old backup(s) (kept last ${KEEP})"
  fi

  echo ""
  echo "  WARNING: This backup contains DICOM patient data."
  echo "  Copy to an external drive. Do NOT upload unencrypted."
  echo ""
}

do_restore() {
  echo ""
  echo "==============================="
  echo "  AmbientCT Restore"
  echo "==============================="
  echo ""

  if [ ! -f "$RESTORE_FILE" ]; then
    echo "ERROR: Backup file not found: $RESTORE_FILE"
    exit 1
  fi

  local abs_dir abs_file
  abs_dir="$(cd "$(dirname "$RESTORE_FILE")" && pwd)"
  abs_file="$(basename "$RESTORE_FILE")"

  echo "  File:   $RESTORE_FILE"
  echo "  Volume: $VOLUME_NAME"
  echo ""

  # Check if containers are running
  if docker ps --filter "name=ambientct-orthanc" --format '{{.Names}}' | grep -q 'ambientct-orthanc'; then
    echo "  WARNING: Orthanc container is running."
    echo "  Stop it first with: docker compose down"
    echo ""
    read -r -p "  Stop containers and proceed? [y/N]: " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "  Aborted."
      exit 1
    fi
    cd "$PROJECT_DIR"
    docker compose down
    echo ""
  fi

  echo "  Restoring..."
  docker run --rm \
    -v "${VOLUME_NAME}:/data" \
    -v "${abs_dir}:/backup:ro" \
    alpine sh -c "rm -rf /data/* && tar xzf /backup/${abs_file} -C /data"

  echo ""
  echo "  [OK] Restore complete"
  echo ""
  echo "  Start the stack: docker compose up -d"
  echo ""
}

case "$MODE" in
  backup) do_backup ;;
  restore) do_restore ;;
  list) list_backups ;;
esac
