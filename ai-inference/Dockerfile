FROM python:3.11-slim-bookworm

WORKDIR /app

# OpenCV headless braucht libGL + libglib.
# Pinned auf Bookworm (Debian 12), weil Trixie (Debian 13) das alte
# libgl1-mesa-glx-Paket entfernt hat — dort heisst es nur noch libgl1.
# Wenn das Base-Image später auf Trixie wechselt: libgl1-mesa-glx → libgl1.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user für Security
RUN useradd -m -u 1000 aiuser
USER aiuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request as r; r.urlopen('http://localhost:8000/api/ai/health', timeout=3)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
