#!/bin/bash
set -euo pipefail

# AmbientCT Setup Wizard
# Checks prerequisites, generates .env with secure credentials, pulls Docker images.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
INTERACTIVE=true
ORTHANC_USER="admin"
ORTHANC_HTTP_PORT=8042
ORTHANC_DICOM_PORT=4242
VIEWER_PORT=3000

usage() {
  cat <<'EOF'
Usage: ./scripts/setup.sh [OPTIONS]

First-time setup wizard for AmbientCT. Checks Docker, generates .env
with secure credentials, and pulls container images.

Options:
  -h, --help             Show this help message
  -n, --non-interactive  Skip interactive prompts, use defaults
  -u, --user NAME        Orthanc admin username (default: admin)
  --http-port PORT       Orthanc HTTP port (default: 8042)
  --dicom-port PORT      Orthanc DICOM port (default: 4242)
  --viewer-port PORT     OHIF Viewer port (default: 3000)

Examples:
  ./scripts/setup.sh                        # Interactive wizard
  ./scripts/setup.sh --non-interactive      # CI/automated setup
  ./scripts/setup.sh -u doctor --http-port 9042
EOF
  exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    -n|--non-interactive) INTERACTIVE=false; shift ;;
    -u|--user) ORTHANC_USER="$2"; shift 2 ;;
    --http-port) ORTHANC_HTTP_PORT="$2"; shift 2 ;;
    --dicom-port) ORTHANC_DICOM_PORT="$2"; shift 2 ;;
    --viewer-port) VIEWER_PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; echo "Run with --help for usage."; exit 1 ;;
  esac
done

prompt() {
  local varname="$1" prompt_text="$2" default="$3"
  if [[ "$INTERACTIVE" == "true" ]]; then
    read -r -p "$prompt_text [$default]: " input
    printf -v "$varname" '%s' "${input:-$default}"
  else
    printf -v "$varname" '%s' "$default"
  fi
}

generate_password() {
  openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24
}

validate_port() {
  local port="$1" name="$2"
  if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
    echo "ERROR: $name must be a number between 1024 and 65535 (got: $port)"
    exit 1
  fi
}

validate_env() {
  local env_file="$1"
  local errors=0

  echo "  Validating .env..."

  # Required variables
  for var in ORTHANC_USER ORTHANC_PASSWORD ORTHANC_HTTP_PORT ORTHANC_DICOM_PORT VIEWER_PORT; do
    val=$(grep "^${var}=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
    if [ -z "$val" ]; then
      echo "  ERROR: Required variable $var is missing or empty in .env"
      errors=$((errors + 1))
    fi
  done

  # Password strength
  local pw
  pw=$(grep "^ORTHANC_PASSWORD=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
  if [ -n "$pw" ] && [ "${#pw}" -lt 16 ]; then
    echo "  ERROR: ORTHANC_PASSWORD must be at least 16 characters (got ${#pw})"
    errors=$((errors + 1))
  fi
  if [ -n "$pw" ]; then
    case "$pw" in
      changeme-on-first-run|changeme|password|admin|orthanc)
        echo "  ERROR: ORTHANC_PASSWORD uses a default/weak value — generate a strong password"
        errors=$((errors + 1))
        ;;
    esac
  fi

  # Port validation
  for portvar in ORTHANC_HTTP_PORT ORTHANC_DICOM_PORT VIEWER_PORT; do
    pval=$(grep "^${portvar}=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
    if [ -n "$pval" ]; then
      if ! [[ "$pval" =~ ^[0-9]+$ ]] || [ "$pval" -lt 1024 ] || [ "$pval" -gt 65535 ]; then
        echo "  ERROR: $portvar must be between 1024 and 65535 (got: $pval)"
        errors=$((errors + 1))
      fi
    fi
  done

  # Port uniqueness
  local http_port dicom_port viewer_port
  http_port=$(grep "^ORTHANC_HTTP_PORT=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
  dicom_port=$(grep "^ORTHANC_DICOM_PORT=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
  viewer_port=$(grep "^VIEWER_PORT=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
  if [ "$http_port" = "$dicom_port" ] || [ "$http_port" = "$viewer_port" ] || [ "$dicom_port" = "$viewer_port" ]; then
    echo "  ERROR: All ports must be unique (HTTP=$http_port, DICOM=$dicom_port, Viewer=$viewer_port)"
    errors=$((errors + 1))
  fi

  if [ "$errors" -gt 0 ]; then
    echo ""
    echo "  $errors validation error(s) found. Fix .env before running docker compose up."
    exit 1
  fi
  echo "  [OK] .env validated"
}

echo ""
echo "==============================="
echo "  AmbientCT Setup Wizard"
echo "==============================="
echo ""

# --- Step 1: Check Docker ---
echo "Step 1/4: Checking prerequisites..."
echo ""

if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker is not installed."
  echo "  Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi
echo "  [OK] Docker found: $(docker --version | head -1)"

if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running. Please start Docker Desktop."
  exit 1
fi
echo "  [OK] Docker daemon is running"

if ! command -v curl &> /dev/null; then
  echo "ERROR: curl is not installed."
  exit 1
fi
echo "  [OK] curl found"
echo ""

# --- Step 2: Interactive configuration ---
echo "Step 2/4: Configuration..."
echo ""

if [[ "$INTERACTIVE" == "true" ]]; then
  prompt ORTHANC_USER "Orthanc admin username" "$ORTHANC_USER"
  prompt ORTHANC_HTTP_PORT "Orthanc HTTP port" "$ORTHANC_HTTP_PORT"
  prompt ORTHANC_DICOM_PORT "Orthanc DICOM port" "$ORTHANC_DICOM_PORT"
  prompt VIEWER_PORT "OHIF Viewer port" "$VIEWER_PORT"
  echo ""
fi

# Validate port values before proceeding
validate_port "$ORTHANC_HTTP_PORT" "ORTHANC_HTTP_PORT"
validate_port "$ORTHANC_DICOM_PORT" "ORTHANC_DICOM_PORT"
validate_port "$VIEWER_PORT" "VIEWER_PORT"

# Check port conflicts
for PORT in $ORTHANC_HTTP_PORT $ORTHANC_DICOM_PORT $VIEWER_PORT; do
  if lsof -i ":$PORT" > /dev/null 2>&1; then
    echo "  WARNING: Port $PORT is already in use."
  fi
done

# --- Step 3: Generate .env ---
echo "Step 3/4: Generating configuration..."
echo ""

cd "$PROJECT_DIR"

if [ -f .env ]; then
  if [[ "$INTERACTIVE" == "true" ]]; then
    read -r -p "  .env already exists. Overwrite? [y/N]: " overwrite
    if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
      echo "  Keeping existing .env"
      echo ""
    else
      OVERWRITE=true
    fi
  else
    echo "  .env already exists, skipping (use interactive mode to overwrite)"
    echo ""
  fi
fi

if [ ! -f .env ] || [[ "${OVERWRITE:-}" == "true" ]]; then
  if [ ! -f .env.example ]; then
    echo "ERROR: .env.example not found in $PROJECT_DIR"
    exit 1
  fi

  ORTHANC_PASSWORD="$(generate_password)"

  cat > .env <<ENVEOF
# AmbientCT Environment Configuration
# Generated by setup.sh on $(date +%Y-%m-%d)

# === Orthanc PACS Server ===
ORTHANC_HTTP_PORT=${ORTHANC_HTTP_PORT}
ORTHANC_DICOM_PORT=${ORTHANC_DICOM_PORT}
ORTHANC_USER=${ORTHANC_USER}
ORTHANC_PASSWORD=${ORTHANC_PASSWORD}
DICOM_AE_TITLE=DENTALPACS

# === OHIF Viewer ===
VIEWER_PORT=${VIEWER_PORT}
ENVEOF

  echo "  [OK] .env created with secure password"
  echo ""
  echo "  +-----------------------------------------+"
  echo "  |  Orthanc Admin Credentials               |"
  echo "  |  URL:      http://localhost:${ORTHANC_HTTP_PORT}       |"
  echo "  |  Username: ${ORTHANC_USER}"
  echo "  |  Password: ${ORTHANC_PASSWORD}"
  echo "  +-----------------------------------------+"
  echo ""
  echo "  IMPORTANT: Save this password! It is stored in .env"
  echo ""
fi

# Validate the .env file
validate_env "$PROJECT_DIR/.env"

# Create directories
mkdir -p logs
echo "  [OK] Log directory ready"

# --- Step 4: Pull images ---
echo ""
echo "Step 4/4: Pulling Docker images..."
echo ""
docker compose pull
echo ""
echo "  [OK] Images ready"

echo ""
echo "==============================="
echo "  Setup complete!"
echo "==============================="
echo ""
echo "Next steps:"
echo "  1. docker compose up -d"
echo "  2. Open http://localhost:${VIEWER_PORT} (OHIF Viewer)"
echo "  3. Open http://localhost:${ORTHANC_HTTP_PORT} (Orthanc Admin)"
echo "  4. Upload DICOM files via drag & drop in OHIF"
echo ""
echo "Useful commands:"
echo "  ./scripts/smoke-test.sh       Verify everything works"
echo "  ./scripts/import-dicom.sh     Bulk-import DICOM files"
echo "  ./scripts/backup.sh           Backup patient data"
echo "  docker compose down           Stop everything"
echo ""
