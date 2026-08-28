// extensions/dental-cpr/src/utils/volumeLookup.ts
//
// Shared cornerstone volume lookup + geometry extraction, used identically by
// DentalMPRViewport and DentalMPRDiffViewport (previously duplicated inline
// in both files). Kept dependency-free (the cornerstone `cache` singleton is
// passed in, never imported here) so it is unit-testable in the plain-node
// jest environment this project uses, without cornerstone/vtk mocks.

import type { VolumeGeometry } from './geometryCompat';

export interface VolumeCacheLike {
  getVolume: (id: string) => any;
  _volumeCache?: Map<string, any>;
}

/**
 * 3-tier volume lookup for a display set:
 *   1. explicit volumeId set by the 3D SOP class handler
 *   2. the OHIF streaming-volume convention id derived from displaySetInstanceUID
 *   3. a scan of cornerstone's internal volume cache keyed by SeriesInstanceUID
 */
export function findVolumeForDisplaySet(cache: VolumeCacheLike, displaySets: any[]): any | null {
  if (!displaySets?.length) return null;
  const ds = displaySets[0];
  if (!ds) return null;

  if (ds.volumeId) {
    const vol = cache.getVolume(ds.volumeId);
    if (vol) return vol;
  }

  const derivedId = `cornerstoneStreamingImageVolume:${ds.displaySetInstanceUID}`;
  const volByDerived = cache.getVolume(derivedId);
  if (volByDerived) return volByDerived;

  const seriesUID: string | undefined = ds.SeriesInstanceUID;
  if (seriesUID) {
    const volumeCache = cache._volumeCache;
    if (volumeCache) {
      for (const [, vol] of volumeCache) {
        if (
          vol?.metadata?.SeriesInstanceUID === seriesUID ||
          (vol?.imageIds?.[0] as string | undefined)?.includes(seriesUID)
        ) {
          return vol;
        }
      }
    }
  }

  return null;
}

/** True once a looked-up volume actually has sampleable voxel data. */
export function isVolumeReady(volume: any): boolean {
  try {
    return !!(volume?.imageData && volume.imageData.getNumberOfPoints?.() > 0);
  } catch {
    return false;
  }
}

/**
 * Extracts the plain-numeric geometry needed by the P3.5 compatibility gate
 * from a cornerstone volume. Returns null (never throws) if the volume's
 * vtk imageData isn't in a readable state yet.
 */
export function extractVolumeGeometry(volume: any): VolumeGeometry | null {
  const imgData = volume?.imageData;
  if (!imgData) return null;

  let dims: number[] | undefined;
  let spacing: number[] | undefined;
  let origin: number[] | undefined;
  let direction: ArrayLike<number> | undefined;
  try {
    dims = imgData.getDimensions?.();
    spacing = imgData.getSpacing?.();
    origin = imgData.getOrigin?.();
    direction = imgData.getDirection?.();
  } catch {
    return null;
  }

  if (!dims || dims.length < 3 || !spacing || spacing.length < 3 || !origin || origin.length < 3) {
    return null;
  }

  return {
    dimensions: [dims[0], dims[1], dims[2]],
    spacing: [spacing[0], spacing[1], spacing[2]],
    origin: [origin[0], origin[1], origin[2]],
    direction: direction ? Array.from(direction) : undefined,
    frameOfReferenceUID: volume?.metadata?.FrameOfReferenceUID,
    rescaleSlope: volume?.metadata?.RescaleSlope,
    rescaleIntercept: volume?.metadata?.RescaleIntercept,
  };
}
