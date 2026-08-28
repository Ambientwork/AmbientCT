#!/usr/bin/env bash
# =============================================================================
# AmbientCT — Model Download Script (Phase 3b-2)
# Downloads and unpacks the DentalSegmentator nnU-Net pretrained model
# weights into a deterministic, validated, ready-to-mount model folder.
#
# Usage:
#   bash scripts/download-models.sh [--yes] [--verify-only] [--help]
#
# Flags:
#   -y, --yes           Skip the interactive confirmation prompt. Required
#                        for non-interactive / scripted / CI use — this is
#                        the explicit authorization gate for a real network
#                        download (plan §4.2 / §12 P5.1).
#       --verify-only    Do not download or touch the network. Only check
#                        whether a validated, unpacked model folder already
#                        exists at the deterministic target path, print a
#                        clear PASS/FAIL result, and exit 0 (valid model
#                        present) or 1 (missing/invalid) accordingly.
#   -h, --help           Show this help and exit 0.
#
# What this script produces:
#   data/ai-models/mandibular-canal/Dataset111_453CT_v100.zip   (raw download)
#   data/ai-models/mandibular-canal/Dataset111_453CT_v100/      (unpacked —
#     THIS directory is the runtime AI_MODEL_PATH target; the pipeline
#     (ai-inference/pipeline/segmentation.py) never unzips anything itself
#     — unpacking only ever happens here, once, at setup time.)
#   data/ai-models/mandibular-canal/MODEL_CARD.md                (provenance;
#     written ONLY after the unpacked folder has been structurally
#     validated — never on a bare download.)
#
# Requirements:
#   curl, python3 (only for the download/unpack path — not for --help or
#   --verify-only), and sha256sum or shasum (for integrity verification).
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Model metadata
# ---------------------------------------------------------------------------
MODEL_NAME="DentalSegmentator v1.0.0-alpha (Dataset111_453CT_v100)"
MODEL_ZIP_FILENAME="Dataset111_453CT_v100.zip"
MODEL_UNPACK_DIRNAME="Dataset111_453CT_v100"
# Primary: GitHub release (direct, no login required)
MODEL_URL="https://github.com/gaudot/SlicerDentalSegmentator/releases/download/v1.0.0-alpha/Dataset111_453CT_v100.zip"
# Fallback: Zenodo record (same file, DOI-stable)
MODEL_URL_FALLBACK="https://zenodo.org/records/10829675/files/Dataset111_453CT_v100.zip"
MODEL_LICENSE="Apache-2.0"
MODEL_LICENSE_URL="https://github.com/gaudot/SlicerDentalSegmentator/blob/main/LICENSE.txt"
MODEL_PAPER="Dot G, et al. DentalSegmentator: robust open source deep learning-based CT and CBCT image segmentation. Journal of Dentistry (2024) doi:10.1016/j.jdent.2024.105130"
MODEL_ZENODO="https://zenodo.org/records/10829675"
MODEL_APPROX_SIZE_MB="~175 MB (compressed ZIP)"

# SHA256 of the ZIP.
# NOTE: The authors did not publish a SHA256 in the release notes.
# On first download this script computes and prints the hash so you can pin
# it here for future runs. A download without a pinned hash here is a
# trust-on-first-download and is NOT a passed production gate (plan §12
# G5) — pin it before relying on this for anything beyond local dev/eval:
KNOWN_SHA256=""

# Where weights live inside the project
DEST_DIR="data/ai-models/mandibular-canal"
DEST_FILE="${DEST_DIR}/${MODEL_ZIP_FILENAME}"
UNPACK_DIR="${DEST_DIR}/${MODEL_UNPACK_DIRNAME}"
MODEL_CARD="${DEST_DIR}/MODEL_CARD.md"

# nnU-Net label scheme for this model (5 foreground classes):
#   0 = background
#   1 = maxilla & upper skull
#   2 = mandible
#   3 = upper teeth
#   4 = lower teeth
#   5 = mandibular canal  <- the class AmbientCT uses
#     (AI_INFERENCE_CANAL_LABEL defaults to this; see .env.example)
CANAL_LABEL_ID=5

# ---------------------------------------------------------------------------
# CLI flags
# ---------------------------------------------------------------------------
YES=0
VERIFY_ONLY=0

print_help() {
    cat <<'HELP'
AmbientCT — AI Model Download (Phase 3b-2)

Downloads, verifies, and unpacks the DentalSegmentator nnU-Net weights into
a deterministic model folder ready to be mounted read-only into the
ai-inference container.

Usage:
  bash scripts/download-models.sh [OPTIONS]

Options:
  -y, --yes          Skip the interactive confirmation prompt (required for
                      non-interactive / scripted use — this is the explicit
                      download authorization).
      --verify-only   Do not download anything. Only check whether a
                      validated, unpacked model already exists at the
                      deterministic target path and report PASS/FAIL.
                      Exit 0 if a valid model is present, 1 otherwise.
  -h, --help          Show this help and exit.

Examples:
  bash scripts/download-models.sh --verify-only
  bash scripts/download-models.sh --yes

Target paths:
  data/ai-models/mandibular-canal/Dataset111_453CT_v100.zip   (raw download)
  data/ai-models/mandibular-canal/Dataset111_453CT_v100/      (runtime path
    — point AI_MODEL_PATH at this UNPACKED folder, never at the .zip)
HELP
}

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            print_help
            exit 0
            ;;
        -y|--yes)
            YES=1
            shift
            ;;
        --verify-only)
            VERIFY_ONLY=1
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "" >&2
            print_help >&2
            exit 2
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info() {
    echo "  $*"
}

warn() {
    echo "  WARNING: $*" >&2
}

die() {
    echo "" >&2
    echo "ERROR: $*" >&2
    exit 1
}

# Prefer sha256sum (Linux); fall back to shasum -a 256 (macOS)
compute_sha256() {
    local file="$1"
    if command -v sha256sum > /dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    elif command -v shasum > /dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
    else
        echo ""
    fi
}

# Ask y/n unless --yes was passed; dies (aborts) on "no" or non-interactive
# EOF so a caller never silently proceeds past a declined confirmation.
confirm_or_die() {
    local prompt="$1"
    if [ "${YES}" -eq 1 ]; then
        return 0
    fi
    printf "  %s [y/n]: " "${prompt}"
    if ! read -r reply; then
        die "No confirmation received (non-interactive session without --yes)."
    fi
    case "${reply}" in
        y|Y|yes|YES)
            return 0
            ;;
        *)
            die "Aborted by user."
            ;;
    esac
}

# Pure-bash structural validation of an unpacked nnU-Net model folder.
# Prints a short reason on stdout and returns 0 (valid) or 1 (invalid).
# This is a stricter, download-time-only check than
# pipeline.inference_mode.validate_model_folder() (which intentionally does
# NOT check checkpoint file contents at runtime/health-check time) — here we
# also require an actual checkpoint_final.pth to exist under some fold_*/.
validate_unpacked_model() {
    local dir="$1"

    if [ ! -d "${dir}" ]; then
        echo "not a directory: ${dir}"
        return 1
    fi
    if [ ! -f "${dir}/dataset.json" ]; then
        echo "missing dataset.json"
        return 1
    fi
    if [ ! -f "${dir}/plans.json" ]; then
        echo "missing plans.json"
        return 1
    fi

    local found=0
    local fold_dir
    for fold_dir in "${dir}"/fold_*; do
        if [ -d "${fold_dir}" ] && [ -f "${fold_dir}/checkpoint_final.pth" ]; then
            found=1
            break
        fi
    done
    if [ "${found}" -ne 1 ]; then
        echo "no fold_*/checkpoint_final.pth found"
        return 1
    fi

    echo "ok"
    return 0
}

# ---------------------------------------------------------------------------
# --verify-only: no network, no download, just report current state
# ---------------------------------------------------------------------------

if [ "${VERIFY_ONLY}" -eq 1 ]; then
    echo ""
    echo "  Verifying: ${UNPACK_DIR}"
    if [ ! -e "${DEST_DIR}" ] && [ ! -d "${UNPACK_DIR}" ]; then
        echo "  MISSING — no model installed (${DEST_DIR} does not exist yet)."
        echo "  Run 'bash scripts/download-models.sh --yes' to install it."
        echo ""
        exit 1
    fi
    if reason="$(validate_unpacked_model "${UNPACK_DIR}")"; then
        echo "  VALID — ${reason} (${UNPACK_DIR})"
        echo ""
        exit 0
    else
        echo "  INVALID — ${reason}"
        echo "  Run 'bash scripts/download-models.sh --yes' to (re)install it."
        echo ""
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Pre-flight checks (download path only — --help/--verify-only never reach here)
# ---------------------------------------------------------------------------

if ! command -v curl > /dev/null 2>&1; then
    die "curl is not installed. Install it first (brew install curl / apt install curl)."
fi
if ! command -v python3 > /dev/null 2>&1; then
    die "python3 is not installed. It is required to safely inspect and unpack the model archive."
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

cat <<BANNER

================================================================
  AmbientCT — AI Model Download (Phase 3b-2)
================================================================

  Model   : ${MODEL_NAME}
  Size    : ${MODEL_APPROX_SIZE_MB}
  License : ${MODEL_LICENSE}
  Source  : ${MODEL_URL}
  Zenodo  : ${MODEL_ZENODO}

  The model segments 5 dental anatomy structures in CBCT volumes.
  AmbientCT uses ONLY label ${CANAL_LABEL_ID} (mandibular canal).

  License terms: ${MODEL_LICENSE_URL}
  Paper  : ${MODEL_PAPER}

  Download target : ${DEST_FILE}
  Runtime target   : ${UNPACK_DIR}  (point AI_MODEL_PATH here)

BANNER

# ---------------------------------------------------------------------------
# Idempotency, step 1: already unpacked and valid? Nothing to do.
# ---------------------------------------------------------------------------

if reason="$(validate_unpacked_model "${UNPACK_DIR}")"; then
    info "Found already-installed, valid model at ${UNPACK_DIR} (${reason})."
    info "Nothing to do. Delete that directory manually to force a reinstall."
    echo ""
    exit 0
fi

mkdir -p "${DEST_DIR}"

# ---------------------------------------------------------------------------
# Idempotency, step 2: is there an existing zip we can reuse?
#
# Never silently reuse (or silently discard) an existing file blindly:
#   - structurally corrupt zip           -> always requires confirmation
#   - structurally valid, hash mismatch  -> always requires confirmation
#   - structurally valid, hash matches   -> reuse silently (verified)
#   - structurally valid, no pinned hash -> reuse, but say so explicitly
#     (this was previously a silent skip regardless of file integrity —
#     fixed: we now always test zip validity first, pinned hash or not)
# ---------------------------------------------------------------------------

SKIP_DOWNLOAD=0
HASH_PINNED=0

if [ -f "${DEST_FILE}" ]; then
    info "Found existing file: ${DEST_FILE}"
    export DMS_ZIP_PATH="${DEST_FILE}"
    if python3 - <<'PY'
import os
import sys
import zipfile

zip_path = os.environ["DMS_ZIP_PATH"]
try:
    with zipfile.ZipFile(zip_path) as zf:
        bad = zf.testzip()
except (zipfile.BadZipFile, OSError) as exc:
    print(f"corrupt or unreadable zip: {exc}", file=sys.stderr)
    sys.exit(1)
if bad is not None:
    print(f"corrupt member inside zip: {bad}", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY
    then
        if [ -n "${KNOWN_SHA256}" ]; then
            ACTUAL_SHA256="$(compute_sha256 "${DEST_FILE}")"
            if [ "${ACTUAL_SHA256}" = "${KNOWN_SHA256}" ]; then
                info "SHA256 matches pinned hash. Reusing existing file, skipping download."
                SKIP_DOWNLOAD=1
                HASH_PINNED=1
            else
                warn "Existing file's SHA256 does NOT match the pinned hash."
                warn "  Expected: ${KNOWN_SHA256}"
                warn "  Actual  : ${ACTUAL_SHA256}"
                confirm_or_die "Remove the mismatched file and re-download?"
                rm -f "${DEST_FILE}"
            fi
        else
            info "Existing file is a structurally valid archive (no KNOWN_SHA256 pinned"
            info "in this script to verify authenticity against — trust-on-first-download)."
            info "Computed SHA256: $(compute_sha256 "${DEST_FILE}")"
            info "Reusing it. Delete it manually to force a re-download."
            SKIP_DOWNLOAD=1
        fi
    else
        warn "Existing file at ${DEST_FILE} failed a zip integrity check"
        warn "(possibly corrupt or an incomplete previous download)."
        confirm_or_die "Remove it and re-download?"
        rm -f "${DEST_FILE}"
    fi
fi

# ---------------------------------------------------------------------------
# Download (temp file + atomic rename)
# ---------------------------------------------------------------------------

if [ "${SKIP_DOWNLOAD}" -ne 1 ]; then
    confirm_or_die "Proceed with download?"
    echo ""

    TMP_FILE="$(mktemp "${DEST_DIR}/.download.XXXXXX")"
    trap 'rm -f "${TMP_FILE}"' EXIT

    info "Downloading from: ${MODEL_URL}"
    echo ""

    if ! curl -fL --progress-bar --retry 3 --retry-delay 2 \
         -o "${TMP_FILE}" \
         "${MODEL_URL}"; then
        echo ""
        info "Primary URL failed. Trying Zenodo fallback..."
        echo ""
        if ! curl -fL --progress-bar --retry 3 --retry-delay 2 \
             -o "${TMP_FILE}" \
             "${MODEL_URL_FALLBACK}"; then
            die "Download failed from both primary URL and Zenodo fallback."
        fi
    fi

    # Atomic rename onto the final path only once the download fully
    # succeeded — a reader can never observe a partially-written DEST_FILE.
    mv -f "${TMP_FILE}" "${DEST_FILE}"
    trap - EXIT

    echo ""
    info "Download complete: ${DEST_FILE}"
    echo ""

    export DMS_ZIP_PATH="${DEST_FILE}"
    if ! python3 - <<'PY'
import os
import sys
import zipfile

zip_path = os.environ["DMS_ZIP_PATH"]
try:
    with zipfile.ZipFile(zip_path) as zf:
        bad = zf.testzip()
except (zipfile.BadZipFile, OSError) as exc:
    print(f"corrupt or unreadable zip: {exc}", file=sys.stderr)
    sys.exit(1)
if bad is not None:
    print(f"corrupt member inside zip: {bad}", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY
    then
        rm -f "${DEST_FILE}"
        die "Downloaded file is not a valid zip archive. Removed; check your network and retry."
    fi

    ACTUAL_SHA256="$(compute_sha256 "${DEST_FILE}")"

    if [ -z "${ACTUAL_SHA256}" ]; then
        warn "Neither sha256sum nor shasum found. Cannot verify integrity."
        warn "Install coreutils (brew install coreutils) for SHA256 support."
    elif [ -n "${KNOWN_SHA256}" ]; then
        if [ "${ACTUAL_SHA256}" = "${KNOWN_SHA256}" ]; then
            info "SHA256 verified OK: ${ACTUAL_SHA256}"
            HASH_PINNED=1
        else
            rm -f "${DEST_FILE}"
            die "SHA256 mismatch!
    Expected : ${KNOWN_SHA256}
    Actual   : ${ACTUAL_SHA256}
  File removed. Check your network or the source URL for tampering."
        fi
    else
        cat <<WARN
  WARNING: No SHA256 was pinned in this script (KNOWN_SHA256 is empty).
           This is a trust-on-first-download and does NOT count as a passed
           production gate (plan G5). To pin the hash for future runs, edit
           scripts/download-models.sh and set:

             KNOWN_SHA256="${ACTUAL_SHA256}"

  Computed hash of downloaded file:
    SHA256 = ${ACTUAL_SHA256}
WARN
    fi
    echo ""
else
    ACTUAL_SHA256="$(compute_sha256 "${DEST_FILE}")"
fi

# ---------------------------------------------------------------------------
# Unpack: deterministic target, structural validation before anything else
# trusts it.
#
# The zip's internal layout is not assumed — we search it for the
# shallowest directory that actually contains dataset.json + plans.json +
# a fold_* entry, and extract only that subtree. This is more robust than
# assuming a fixed nesting depth, and it never extracts the whole archive
# to the final runtime path sight-unseen (also guards against path
# traversal: any member path containing ".." or an absolute path aborts
# extraction entirely).
# ---------------------------------------------------------------------------

info "Unpacking model archive..."

STAGE_DIR="$(mktemp -d "${DEST_DIR}/.unpack.XXXXXX")"
trap 'rm -rf "${STAGE_DIR}"' EXIT

export DMS_ZIP_PATH="${DEST_FILE}"
export DMS_STAGE_DIR="${STAGE_DIR}"

if ! MODEL_ROOT_REL="$(python3 - <<'PY'
import os
import sys
import zipfile

zip_path = os.environ["DMS_ZIP_PATH"]
stage_dir = os.environ["DMS_STAGE_DIR"]

with zipfile.ZipFile(zip_path) as zf:
    names = zf.namelist()

    for n in names:
        if n.startswith("/") or ".." in n.split("/"):
            print(f"unsafe path in archive: {n}", file=sys.stderr)
            sys.exit(1)

    dirs = {os.path.dirname(n) for n in names}
    dirs.add("")

    def has(prefix, fname):
        target = (prefix + "/" + fname) if prefix else fname
        return target in names

    def has_fold(prefix):
        for n in names:
            if prefix and not n.startswith(prefix + "/"):
                continue
            rel = n[len(prefix) + 1:] if prefix else n
            if rel.split("/", 1)[0].startswith("fold_"):
                return True
        return False

    candidates = [
        d for d in dirs
        if has(d, "dataset.json") and has(d, "plans.json") and has_fold(d)
    ]
    if not candidates:
        print("no dataset.json + plans.json + fold_* found anywhere in the archive", file=sys.stderr)
        sys.exit(1)

    candidates.sort(key=lambda d: d.count("/"))
    root = candidates[0]

    prefix = (root + "/") if root else ""
    members = [n for n in names if n.startswith(prefix) and n != root]
    zf.extractall(stage_dir, members=members)

    print(root)
PY
)"; then
    rm -rf "${STAGE_DIR}"
    trap - EXIT
    die "Could not locate a valid nnU-Net model folder (dataset.json + plans.json + fold_*) inside ${DEST_FILE}."
fi

if [ -n "${MODEL_ROOT_REL}" ]; then
    EXTRACTED_ROOT="${STAGE_DIR}/${MODEL_ROOT_REL}"
else
    EXTRACTED_ROOT="${STAGE_DIR}"
fi

if reason="$(validate_unpacked_model "${EXTRACTED_ROOT}")"; then
    rm -rf "${UNPACK_DIR}"
    mv "${EXTRACTED_ROOT}" "${UNPACK_DIR}"
    rm -rf "${STAGE_DIR}"
    trap - EXIT
    info "Unpacked and validated: ${UNPACK_DIR} (${reason})"
else
    rm -rf "${STAGE_DIR}"
    trap - EXIT
    die "Unpacked archive failed structural validation: ${reason}"
fi

echo ""

# ---------------------------------------------------------------------------
# Write MODEL_CARD.md — ONLY reached after successful unpack + structural
# validation above. A download that failed validation never gets this far,
# so a MODEL_CARD.md on disk is itself evidence the model passed the check.
# ---------------------------------------------------------------------------

DOWNLOAD_DATE="$(date -u +%Y-%m-%d)"
if [ "${HASH_PINNED}" -eq 1 ]; then
    HASH_STATUS_LINE="PINNED and VERIFIED — matches KNOWN_SHA256 in scripts/download-models.sh"
else
    HASH_STATUS_LINE="NOT pinned (trust-on-first-download) — NOT a passed production gate (plan G5)"
fi

cat > "${MODEL_CARD}" <<CARD
# Model Card — DentalSegmentator (nnU-Net v2)

## Provenance

| Field            | Value |
|------------------|-------|
| Model name       | DentalSegmentator v1.0.0-alpha |
| Dataset ID       | Dataset111_453CT_v100 |
| Framework        | nnU-Net v2 |
| Download URL     | ${MODEL_URL} |
| Zenodo record    | ${MODEL_ZENODO} |
| License          | ${MODEL_LICENSE} — ${MODEL_LICENSE_URL} |
| Downloaded on    | ${DOWNLOAD_DATE} |
| SHA256 (ZIP)     | ${ACTUAL_SHA256:-NOT COMPUTED — install sha256sum/shasum and re-run} |
| SHA256 status    | ${HASH_STATUS_LINE} |
| Runtime path     | ${UNPACK_DIR} (unpacked; set AI_MODEL_PATH to this folder) |
| Paper            | ${MODEL_PAPER} |

## Label Scheme

The model produces a 5-class segmentation of dento-maxillo-facial CT/CBCT volumes.

| Label ID | Structure |
|----------|-----------|
| 0 | Background |
| 1 | Maxilla & upper skull |
| 2 | Mandible |
| 3 | Upper teeth |
| 4 | Lower teeth |
| **5** | **Mandibular canal (bilateral IAN canal)** <- AmbientCT target |

AmbientCT uses **only label 5** (mandibular canal) by default
(AI_INFERENCE_CANAL_LABEL, env-overridable — see .env.example). The other
labels are computed but discarded by the pipeline.

## Voxel Spacing

The model was trained on CT and CBCT volumes with voxel spacings spanning
~0.2-0.4 mm isotropic. nnU-Net automatically resamples input volumes to
its learned target spacing at inference time, using the real spacing of
the loaded volume — AmbientCT passes this through, it is never hardcoded.

## Hardware Notes

- **Recommended by the model authors**: 32 GB RAM for whole-volume inference without swap.
- **AmbientCT Docker path (linux/amd64, CPU by default — plan §3.3)**:
  - Runs with tile_step_size=0.9 and mirroring/TTA disabled to reduce peak RSS.
  - The Docker \`mem_limit\` is the hard memory boundary; a software watchdog
    is observational only (see ai-inference/pipeline/segmentation.py).
  - MPS acceleration is an optional native macOS *development* path, never
    promised or relied upon inside the linux/amd64 container.

## Usage via nnU-Net CLI (for manual/offline verification only —

AmbientCT's own pipeline calls nnUNetPredictor in-process; this CLI form is
provided only for independently reproducing/inspecting the model.)

\`\`\`bash
nnUNetv2_predict \\
  -i INPUT_DIR \\
  -o OUTPUT_DIR \\
  -d 111 \\
  -c 3d_fullres \\
  --disable_tta \\
  --step_size 0.9 \\
  -device cpu \\
  -chk checkpoint_final.pth
# Point nnUNet_results at the parent of: ${UNPACK_DIR}
\`\`\`

## Attribution

If you use this model, please cite:

> Dot G, et al. DentalSegmentator: robust open source deep learning-based
> CT and CBCT image segmentation. *Journal of Dentistry* (2024).
> doi:10.1016/j.jdent.2024.105130

> Isensee F, et al. nnU-Net: a self-configuring method for deep
> learning-based biomedical image segmentation. *Nat Methods* 18, 203-211
> (2021). doi:10.1038/s41592-020-01008-z
CARD

info "Model card written: ${MODEL_CARD}"
echo ""

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

cat <<DONE
================================================================
  Install complete!
================================================================

  Zip     : ${DEST_FILE}
  Model   : ${UNPACK_DIR}
  SHA256  : ${ACTUAL_SHA256:-see warning above}

  Next steps:
    1. Set AI_MODEL_PATH to the UNPACKED folder, not the zip, e.g. in .env:
         AI_MODEL_PATH=/models/mandibular-canal/${MODEL_UNPACK_DIRNAME}
    2. docker compose build ai-inference
    3. docker compose up -d ai-inference
    4. bash scripts/download-models.sh --verify-only   # sanity check anytime

  This script is the ONLY place that unzips the model archive — the
  inference service reads the already-unpacked folder directly and never
  unpacks a zip itself at request time.

================================================================
DONE
