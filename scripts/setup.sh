#!/bin/bash
set -euo pipefail

# AmbientCT Setup Wizard
# Run this once before your first `docker compose up`.
# Usage: ./scripts/setup.sh

echo ""
echo "🦷 AmbientCT Setup"
echo "==================="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed."
  echo "   Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi
echo "✅ Docker found: $(docker --version | head -1)"

if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop."
  exit 1
fi
echo "✅ Docker is running"

# Check ports
for PORT in 8042 3000 4242; do
  if lsof -i ":$PORT" > /dev/null 2>&1; then
    echo "⚠️  Port $PORT is already in use."
    echo "   Stop the service using it, or change the port in .env"
  fi
done

# Create .env if not exists
if [ ! -f .env ]; then
  echo ""
  echo "Creating .env from template..."
  cp .env.example .env

  # Generate random password
  RANDOM_PW=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/changeme-on-first-run/${RANDOM_PW}/" .env
  else
    sed -i "s/changeme-on-first-run/${RANDOM_PW}/" .env
  fi
  echo "✅ .env created with secure password"
  echo ""
  echo "   Orthanc Admin Credentials:"
  echo "   URL:      http://localhost:8042"
  echo "   Username: admin"
  echo "   Password: ${RANDOM_PW}"
  echo ""
  echo "   ⚠️  Save this password! It's in your .env file."
else
  echo "✅ .env already exists"
fi

# Create directories
mkdir -p logs
echo "✅ Log directory created"

# Pull images
echo ""
echo "Pulling Docker images (this may take a few minutes)..."
docker compose pull
echo "✅ Images ready"

echo ""
echo "==================="
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. docker compose up -d"
echo "  2. Open http://localhost:3000 (OHIF Viewer)"
echo "  3. Open http://localhost:8042 (Orthanc Admin)"
echo "  4. Upload DICOM files via drag & drop in OHIF"
echo ""
echo "Run smoke test:  ./scripts/smoke-test.sh"
echo "Stop everything: docker compose down"
echo ""
