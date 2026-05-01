"""
mar_pipeline.py — Metal Artifact Reduction (post-reconstruction, image-space)

Algorithmus:
  1. Metallsegmentierung  HU > METAL_THRESHOLD  (+ morphologische Dilation)
  2. OpenCV TELEA-Inpainting der Metallregion  → füllt Metall mit interpoliertem Gewebe
  3. Bilateraler Filter im Übergangsbereich    → dämpft radiale Streak-Artefakte
  4. Gewichtete Rekombination:
       • Metallpixel      → 100 % Inpainting
       • Übergangsbereich → 40 % Bilat-Filter + 60 % Original
       • Rest             → 100 % Original (keine Veränderung)

Grenzen:
  Echtes Sinogramm-basiertes MAR (NMAR, iMAR) ist hier nicht möglich —
  die Rohdaten sind im DICOM nicht enthalten.  Dieses Verfahren ist das
  Maximum, das im Post-Processing (am rekonstruierten Bild) erreichbar ist.
"""

from __future__ import annotations

import logging
import io
import copy
import datetime
import time
from typing import Callable

import cv2
import numpy as np
import pydicom
import requests
from scipy import ndimage

log = logging.getLogger(__name__)

# ── Konstanten ────────────────────────────────────────────────────────────────

METAL_THRESHOLD_HU   = 2500   # HU-Grenze für Metallerkennung (Amalgam ~3000, Titan ~2800)
DILATION_RADIUS      = 5      # Morphologische Dilation des Metall-Masks (Pixel)
TRANSITION_RADIUS    = 14     # Zusätzliche Dilation für Übergangsbereich
INPAINT_RADIUS_PX    = 8      # OpenCV TELEA inpaintRadius
HU_DISPLAY_MIN       = -1024  # Normierungsbereich für OpenCV (CT-typisch)
HU_DISPLAY_MAX       = 3071
BILATERAL_D          = 9      # Bilat-Filter: Nachbarschaftsgrösse
BILATERAL_SIGMA_COLOR = 0.05  # Bilat-Filter: Farbsigma (normiert 0-1)
BILATERAL_SIGMA_SPACE = 7     # Bilat-Filter: Raumsigma (Pixel)
BLEND_ALPHA          = 0.40   # Anteil Bilat-Filter im Übergangsbereich

NEW_SERIES_SUFFIX    = "_MAR"
MAR_PRIVATE_TAG      = (0x0099, 0x0010)   # Privater Tag zur Markierung verarbeiteter Serien


# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def _pixel_to_hu(pixel_array: np.ndarray, ds: pydicom.Dataset) -> np.ndarray:
    slope     = float(getattr(ds, "RescaleSlope",     1.0))
    intercept = float(getattr(ds, "RescaleIntercept", 0.0))
    return pixel_array.astype(np.float32) * slope + intercept


def _hu_to_pixel(hu: np.ndarray, ds: pydicom.Dataset) -> np.ndarray:
    slope     = float(getattr(ds, "RescaleSlope",     1.0))
    intercept = float(getattr(ds, "RescaleIntercept", 0.0))
    raw = (hu - intercept) / slope
    # Clamp auf zulässigen Wertebereich
    bits   = int(getattr(ds, "BitsStored", 16))
    signed = int(getattr(ds, "PixelRepresentation", 1)) == 1
    if signed:
        lo, hi = -(2 ** (bits - 1)), 2 ** (bits - 1) - 1
    else:
        lo, hi = 0, 2**bits - 1
    return np.clip(raw, lo, hi).astype(np.int16 if signed else np.uint16)


def _normalize(hu: np.ndarray) -> np.ndarray:
    """HU → float32 im Bereich [0, 1] für OpenCV-Funktionen."""
    return np.clip(
        (hu - HU_DISPLAY_MIN) / (HU_DISPLAY_MAX - HU_DISPLAY_MIN),
        0.0, 1.0,
    ).astype(np.float32)


def _denormalize(norm: np.ndarray) -> np.ndarray:
    """float32 [0,1] → HU float32."""
    return (norm * (HU_DISPLAY_MAX - HU_DISPLAY_MIN) + HU_DISPLAY_MIN).astype(np.float32)


# ── Kern-Algorithmus (ein 2-D Schnitt) ───────────────────────────────────────

def process_slice(hu_slice: np.ndarray) -> np.ndarray:
    """
    Wende MAR auf einen einzelnen 2-D HU-Schnitt an.
    Gibt einen 2-D float32-Array (HU) zurück.
    """
    struct2 = ndimage.generate_binary_structure(2, 2)

    # 1. Metallmaske
    metal_mask = hu_slice > METAL_THRESHOLD_HU

    if not np.any(metal_mask):
        return hu_slice.astype(np.float32)

    # 2. Dilation: Inpaint-Region (Metall + direkter Halo)
    inpaint_mask = ndimage.binary_dilation(
        metal_mask, structure=struct2, iterations=DILATION_RADIUS
    )

    # 3. Übergangsring für Bilat-Blend
    transition_mask = ndimage.binary_dilation(
        inpaint_mask, structure=struct2, iterations=TRANSITION_RADIUS
    )
    near_only = transition_mask & ~inpaint_mask   # Ring ohne Inpaint-Kern

    # 4. Normierung für OpenCV
    norm = _normalize(hu_slice)
    norm_u8 = (norm * 255).astype(np.uint8)
    mask_u8 = inpaint_mask.astype(np.uint8) * 255

    # 5. TELEA-Inpainting (schnell, gute Qualität für konvexe Metall-Blobs)
    inpainted_u8 = cv2.inpaint(norm_u8, mask_u8, INPAINT_RADIUS_PX, cv2.INPAINT_TELEA)
    inpainted_hu = _denormalize(inpainted_u8.astype(np.float32) / 255.0)

    # 6. Bilateraler Filter auf der normierten Originalscheibe
    bilat_norm = cv2.bilateralFilter(
        norm,
        d=BILATERAL_D,
        sigmaColor=BILATERAL_SIGMA_COLOR,
        sigmaSpace=BILATERAL_SIGMA_SPACE,
    )
    bilat_hu = _denormalize(bilat_norm)

    # 7. Rekombination
    result = hu_slice.astype(np.float32).copy()
    result[inpaint_mask] = inpainted_hu[inpaint_mask]
    result[near_only] = (
        BLEND_ALPHA * bilat_hu[near_only]
        + (1.0 - BLEND_ALPHA) * hu_slice[near_only]
    )

    return result


# ── Orthanc-Helfer ────────────────────────────────────────────────────────────

def _orthanc_get(url: str, path: str, auth: tuple[str, str]) -> requests.Response:
    r = requests.get(f"{url}{path}", auth=auth, timeout=30)
    r.raise_for_status()
    return r


def _orthanc_post(url: str, path: str, auth: tuple[str, str], data: bytes,
                  content_type: str = "application/dicom") -> requests.Response:
    r = requests.post(
        f"{url}{path}",
        auth=auth,
        data=data,
        headers={"Content-Type": content_type},
        timeout=60,
    )
    r.raise_for_status()
    return r


def _load_series_instances(orthanc_url: str, series_uid: str,
                            auth: tuple[str, str]) -> list[str]:
    """Gibt Orthanc-Instance-IDs für eine Serie zurück (nach Position sortiert)."""
    # Finde Orthanc-interne Series-ID via DICOMweb
    resp = _orthanc_get(orthanc_url,
                        f"/dicom-web/studies/-/series?SeriesInstanceUID={series_uid}",
                        auth)
    series_list = resp.json()
    if not series_list:
        raise ValueError(f"Serie nicht gefunden: {series_uid}")

    # Orthanc-interne ID via /series endpoint
    resp2 = _orthanc_get(orthanc_url,
                         f"/tools/find",
                         auth)
    # Direkter Weg: Orthanc /tools/find
    find_resp = requests.post(
        f"{orthanc_url}/tools/find",
        auth=auth,
        json={"Level": "Series",
              "Query": {"SeriesInstanceUID": series_uid}},
        timeout=15,
    )
    find_resp.raise_for_status()
    orthanc_series_ids = find_resp.json()
    if not orthanc_series_ids:
        raise ValueError(f"Serie nicht in Orthanc gefunden: {series_uid}")

    orthanc_series_id = orthanc_series_ids[0]
    instances = _orthanc_get(orthanc_url, f"/series/{orthanc_series_id}/instances", auth).json()

    # Sortiere nach ImagePositionPatient Z (oder InstanceNumber als Fallback)
    def sort_key(inst: dict) -> float:
        tags = inst.get("MainDicomTags", {})
        pos  = tags.get("ImagePositionPatient", "")
        if pos:
            try:
                return float(pos.split("\\")[2])
            except (IndexError, ValueError):
                pass
        try:
            return float(tags.get("InstanceNumber", 0))
        except ValueError:
            return 0.0

    instances.sort(key=sort_key)
    return [inst["ID"] for inst in instances]


def _download_instance(orthanc_url: str, instance_id: str,
                       auth: tuple[str, str]) -> pydicom.Dataset:
    resp = _orthanc_get(orthanc_url, f"/instances/{instance_id}/file", auth)
    return pydicom.dcmread(io.BytesIO(resp.content))


def _new_series_uid(original_uid: str) -> str:
    """Erzeugt eine neue SeriesInstanceUID basierend auf der originalen."""
    # Nutze Orthanc-eigenen UID-Generator wenn verfügbar, sonst einfache Modifikation
    parts = original_uid.split(".")
    # Ersetze letzte Komponente durch Timestamp-basierten Wert
    ts = str(int(time.time() * 1000))[-9:]
    parts[-1] = ts
    return ".".join(parts)


def _make_mar_dataset(original_ds: pydicom.Dataset,
                      processed_hu: np.ndarray,
                      new_series_uid: str,
                      new_series_number: int) -> pydicom.Dataset:
    """Erstellt ein neues DICOM-Dataset mit MAR-verarbeiteten Pixeldaten."""
    ds = copy.deepcopy(original_ds)

    # Neue UIDs für die MAR-Serie
    ds.SeriesInstanceUID = new_series_uid
    ds.SOPInstanceUID    = pydicom.uid.generate_uid()

    # Serienmetadaten anpassen
    orig_desc = str(getattr(original_ds, "SeriesDescription", "CT"))
    ds.SeriesDescription = orig_desc + NEW_SERIES_SUFFIX
    ds.SeriesNumber      = new_series_number

    # Privater Tag zur Markierung
    block = ds.private_block(0x0099, "AmbientCT_MAR", create=True)
    block.add_new(0x10, "LO", f"MAR processed {datetime.datetime.utcnow().isoformat()}")

    # Pixeldaten zurückschreiben
    pixel_data = _hu_to_pixel(processed_hu, original_ds)
    ds.PixelData = pixel_data.tobytes()

    # Kompression entfernen (unkomprimiertes Explicit VR Little Endian)
    ds.is_implicit_VR = False
    ds.is_little_endian = True
    ds.file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian

    return ds


# ── Haupt-Einstiegspunkt ──────────────────────────────────────────────────────

def run_mar(
    orthanc_url: str,
    series_uid: str,
    auth: tuple[str, str],
    progress_cb: Callable[[float, str], None] | None = None,
) -> str:
    """
    Lädt eine Serie aus Orthanc, verarbeitet alle Slices mit MAR,
    und speichert das Ergebnis als neue Serie zurück.

    Gibt die neue SeriesInstanceUID zurück.
    """

    def _progress(pct: float, msg: str) -> None:
        if progress_cb:
            progress_cb(pct, msg)
        log.info("[MAR %.0f%%] %s", pct * 100, msg)

    _progress(0.0, "Lade Instanz-Liste …")
    instance_ids = _load_series_instances(orthanc_url, series_uid, auth)
    n = len(instance_ids)
    if n == 0:
        raise ValueError("Keine Instanzen in der Serie gefunden.")

    _progress(0.05, f"{n} Instanzen gefunden – starte Verarbeitung …")

    new_suid = _new_series_uid(series_uid)
    # SeriesNumber: z.B. Original 1 → MAR-Serie 1001
    processed_datasets: list[pydicom.Dataset] = []

    for i, inst_id in enumerate(instance_ids):
        ds = _download_instance(orthanc_url, inst_id, auth)

        if not hasattr(ds, "PixelData"):
            log.warning("Instanz %s hat keine Pixeldaten – übersprungen.", inst_id)
            continue

        hu = _pixel_to_hu(ds.pixel_array, ds)
        processed_hu = process_slice(hu)

        series_number = (int(getattr(ds, "SeriesNumber", 1)) % 900) + 1000
        mar_ds = _make_mar_dataset(ds, processed_hu, new_suid, series_number)
        processed_datasets.append(mar_ds)

        pct = 0.05 + 0.85 * (i + 1) / n
        _progress(pct, f"Slice {i + 1}/{n} verarbeitet")

    if not processed_datasets:
        raise RuntimeError("Keine Slices konnten verarbeitet werden.")

    _progress(0.90, f"Speichere {len(processed_datasets)} MAR-Instanzen in Orthanc …")

    for mar_ds in processed_datasets:
        buf = io.BytesIO()
        pydicom.dcmwrite(buf, mar_ds)
        _orthanc_post(orthanc_url, "/instances", auth, buf.getvalue())

    _progress(1.0, f"MAR abgeschlossen — neue Serie: {new_suid}")
    return new_suid
