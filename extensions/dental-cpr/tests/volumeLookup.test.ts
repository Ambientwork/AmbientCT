import {
  extractVolumeGeometry,
  findVolumeForDisplaySet,
  isVolumeReady,
  type VolumeCacheLike,
} from '../src/utils/volumeLookup';

describe('findVolumeForDisplaySet', () => {
  test('returns null when no display sets are given', () => {
    const cache: VolumeCacheLike = { getVolume: jest.fn() };
    expect(findVolumeForDisplaySet(cache, [])).toBeNull();
    expect(findVolumeForDisplaySet(cache, undefined as any)).toBeNull();
  });

  test('tier 1: resolves via explicit volumeId', () => {
    const volume = { id: 'vol-1' };
    const cache: VolumeCacheLike = { getVolume: jest.fn(id => (id === 'my-volume-id' ? volume : null)) };
    const result = findVolumeForDisplaySet(cache, [{ volumeId: 'my-volume-id' }]);
    expect(result).toBe(volume);
  });

  test('tier 2: falls back to the OHIF streaming-volume id derived from displaySetInstanceUID', () => {
    const volume = { id: 'vol-2' };
    const cache: VolumeCacheLike = {
      getVolume: jest.fn(id =>
        id === 'cornerstoneStreamingImageVolume:ds-123' ? volume : null
      ),
    };
    const result = findVolumeForDisplaySet(cache, [{ displaySetInstanceUID: 'ds-123' }]);
    expect(result).toBe(volume);
  });

  test('tier 3: scans the internal volume cache by SeriesInstanceUID', () => {
    const volume = { metadata: { SeriesInstanceUID: 'series-9' } };
    const cache: VolumeCacheLike = {
      getVolume: jest.fn(() => null),
      _volumeCache: new Map([['some-key', volume]]),
    };
    const result = findVolumeForDisplaySet(cache, [{ SeriesInstanceUID: 'series-9' }]);
    expect(result).toBe(volume);
  });

  test('tier 3: also matches via imageIds containing the series UID', () => {
    const volume = { imageIds: ['wadors:http://x/series-7/instance-1'] };
    const cache: VolumeCacheLike = {
      getVolume: jest.fn(() => null),
      _volumeCache: new Map([['k', volume]]),
    };
    const result = findVolumeForDisplaySet(cache, [{ SeriesInstanceUID: 'series-7' }]);
    expect(result).toBe(volume);
  });

  test('returns null when nothing matches in any tier', () => {
    const cache: VolumeCacheLike = { getVolume: jest.fn(() => null), _volumeCache: new Map() };
    const result = findVolumeForDisplaySet(cache, [{ SeriesInstanceUID: 'missing' }]);
    expect(result).toBeNull();
  });
});

describe('isVolumeReady', () => {
  test('true when imageData has points', () => {
    expect(isVolumeReady({ imageData: { getNumberOfPoints: () => 100 } })).toBe(true);
  });

  test('false when imageData has zero points', () => {
    expect(isVolumeReady({ imageData: { getNumberOfPoints: () => 0 } })).toBe(false);
  });

  test('false (not throwing) when volume/imageData is missing', () => {
    expect(isVolumeReady(null)).toBe(false);
    expect(isVolumeReady({})).toBe(false);
  });

  test('false (not throwing) when getNumberOfPoints throws', () => {
    const volume = {
      imageData: {
        getNumberOfPoints: () => {
          throw new Error('not ready');
        },
      },
    };
    expect(isVolumeReady(volume)).toBe(false);
  });
});

describe('extractVolumeGeometry', () => {
  function fakeVolume(overrides: Partial<Record<string, any>> = {}) {
    return {
      imageData: {
        getDimensions: () => [256, 256, 180],
        getSpacing: () => [0.3, 0.3, 0.3],
        getOrigin: () => [-40, -40, -20],
        getDirection: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
      metadata: {
        FrameOfReferenceUID: '1.2.3.for',
        RescaleSlope: 1,
        RescaleIntercept: 0,
      },
      ...overrides,
    };
  }

  test('extracts dimensions/spacing/origin/direction/metadata into plain numbers', () => {
    const geometry = extractVolumeGeometry(fakeVolume());
    expect(geometry).toEqual({
      dimensions: [256, 256, 180],
      spacing: [0.3, 0.3, 0.3],
      origin: [-40, -40, -20],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      frameOfReferenceUID: '1.2.3.for',
      rescaleSlope: 1,
      rescaleIntercept: 0,
    });
  });

  test('returns null when imageData is missing', () => {
    expect(extractVolumeGeometry(null)).toBeNull();
    expect(extractVolumeGeometry({})).toBeNull();
  });

  test('returns null when dimensions/spacing/origin are incomplete', () => {
    const volume = fakeVolume({
      imageData: {
        getDimensions: () => [256, 256, 180],
        getSpacing: () => undefined,
        getOrigin: () => [-40, -40, -20],
        getDirection: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
    });
    expect(extractVolumeGeometry(volume)).toBeNull();
  });

  test('returns null instead of throwing when vtk accessors throw', () => {
    const volume = {
      imageData: {
        getDimensions: () => {
          throw new Error('boom');
        },
      },
    };
    expect(extractVolumeGeometry(volume)).toBeNull();
  });

  test('omits frameOfReferenceUID/rescale fields gracefully when metadata is absent', () => {
    const volume = fakeVolume({ metadata: undefined });
    const geometry = extractVolumeGeometry(volume);
    expect(geometry?.frameOfReferenceUID).toBeUndefined();
    expect(geometry?.rescaleSlope).toBeUndefined();
    expect(geometry?.rescaleIntercept).toBeUndefined();
  });
});
