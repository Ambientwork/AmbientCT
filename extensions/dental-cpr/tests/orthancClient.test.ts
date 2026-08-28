// extensions/dental-cpr/tests/orthancClient.test.ts

// Mock global fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

import {
  findStoredMarSeriesResult,
  getStoredMarSeriesResult,
  invalidateStoredMarSeriesResult,
  parseStudyResponse,
  OrthancClient,
  getOrthancRestBase,
  getSeriesViewerPath,
  getStudyModalities,
  getStudyViewerPath,
  getStudyInstanceUIDFromStowResponse,
  isZipFile,
  saveStoredMarSeriesResult,
  supportsDentalViewer,
} from '../src/utils/orthancClient';

const storageState = new Map<string, string>();

Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: (key: string) => (storageState.has(key) ? storageState.get(key)! : null),
    setItem: (key: string, value: string) => {
      storageState.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageState.delete(key);
    },
    clear: () => {
      storageState.clear();
    },
  },
  configurable: true,
});

beforeEach(() => {
  storageState.clear();
  mockFetch.mockReset();
});

describe('parseStudyResponse', () => {
  test('parses complete DICOMweb study entry', () => {
    const raw = {
      '0020000D': { vr: 'UI', Value: ['1.2.3.4'] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Yoo^Jeong-Woo' }] },
      '00080020': { vr: 'DA', Value: ['20230911'] },
      '00080061': { vr: 'CS', Value: ['CT'] },
      '00201206': { vr: 'IS', Value: ['2'] },
      '00081030': { vr: 'LO', Value: ['CBCT Dental'] },
    };
    const result = parseStudyResponse(raw);
    expect(result.studyInstanceUID).toBe('1.2.3.4');
    expect(result.patientName).toBe('Yoo Jeong-Woo');
    expect(result.studyDate).toBe('20230911');
    expect(result.modality).toBe('CT');
    expect(result.numSeries).toBe(2);
    expect(result.description).toBe('CBCT Dental');
  });

  test('handles missing optional tags gracefully', () => {
    const raw = {
      '0020000D': { vr: 'UI', Value: ['1.2.3.5'] },
    };
    const result = parseStudyResponse(raw);
    expect(result.studyInstanceUID).toBe('1.2.3.5');
    expect(result.patientName).toBe('Unbekannt');
    expect(result.modality).toBe('—');
    expect(result.numSeries).toBe(0);
    expect(result.description).toBe('');
  });

  test('formats PN tag: caret → space', () => {
    const raw = {
      '0020000D': { vr: 'UI', Value: ['x'] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Schmidt^Karl^Dr' }] },
    };
    expect(parseStudyResponse(raw).patientName).toBe('Schmidt Karl Dr');
  });

  test('preserves multiple modalities as backslash-separated string', () => {
    const raw = {
      '0020000D': { vr: 'UI', Value: ['1.2.3.6'] },
      '00080061': { vr: 'CS', Value: ['CT', 'MR'] },
    };
    expect(parseStudyResponse(raw).modality).toBe('CT\\MR');
  });
});

describe('OrthancClient.checkHealth', () => {
  test('returns true on HTTP 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const client = new OrthancClient('/pacs/dicom-web');
    expect(await client.checkHealth()).toBe(true);
  });

  test('returns true even on HTTP 503 (server is reachable, content irrelevant)', async () => {
    // Any HTTP response = server is up; only network errors = offline
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const client = new OrthancClient('/pacs/dicom-web');
    expect(await client.checkHealth()).toBe(true);
  });

  test('returns false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'));
    const client = new OrthancClient('/pacs/dicom-web');
    expect(await client.checkHealth()).toBe(false);
  });
});

describe('OrthancClient.listStudies', () => {
  test('maps DICOMweb JSON to StudySummary[]', async () => {
    const raw = [{
      '0020000D': { vr: 'UI', Value: ['1.2.3'] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'Müller^Anna' }] },
      '00080020': { vr: 'DA', Value: ['20240203'] },
    }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => raw });
    const client = new OrthancClient('/pacs/dicom-web');
    const studies = await client.listStudies();
    expect(studies).toHaveLength(1);
    expect(studies[0].patientName).toBe('Müller Anna');
  });

  test('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.listStudies()).rejects.toThrow('503');
  });
});

describe('OrthancClient.uploadDicom', () => {
  test('uploads regular DICOM files via STOW-RS', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        '00081190': {
          Value: ['http://localhost/dicom-web/studies/1.2.3.4'],
        },
      }),
    });
    const client = new OrthancClient('/pacs/dicom-web');
    const file = {
      name: 'scan.dcm',
      type: 'application/dicom',
      arrayBuffer: async () => new ArrayBuffer(8),
    } as File;

    await expect(client.uploadDicom(file)).resolves.toEqual({
      studyInstanceUID: '1.2.3.4',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/pacs/dicom-web/studies',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': expect.stringContaining('multipart/related'),
        }),
      })
    );
  });

  test('uploads ZIP archives via Orthanc REST /instances', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ParentStudy: 'orthanc-study-id',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          MainDicomTags: {
            StudyInstanceUID: '9.8.7.6',
          },
        }),
      });
    const client = new OrthancClient('/pacs/dicom-web');
    const file = {
      name: 'study.zip',
      type: 'application/zip',
      arrayBuffer: async () => new ArrayBuffer(8),
    } as File;

    await expect(client.uploadDicom(file)).resolves.toEqual({
      studyInstanceUID: '9.8.7.6',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/pacs/instances',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
      })
    );
    expect(mockFetch).toHaveBeenCalledWith('/pacs/studies/orthanc-study-id');
  });
});

describe('upload helpers', () => {
  test('splits multi-modality strings', () => {
    expect(getStudyModalities('CT\\MR')).toEqual(['CT', 'MR']);
    expect(getStudyModalities(' ct ')).toEqual(['CT']);
  });

  test('routes CT studies to the dental viewer and others to the default viewer', () => {
    expect(
      getStudyViewerPath({
        studyInstanceUID: '1.2.3',
        modality: 'CT',
      })
    ).toBe('/dentalCPR?StudyInstanceUIDs=1.2.3');
    expect(
      getStudyViewerPath({
        studyInstanceUID: '1.2.4',
        modality: 'MR',
      })
    ).toBe('/viewer?StudyInstanceUIDs=1.2.4');
    expect(supportsDentalViewer({ modality: 'CT\\MR' })).toBe(true);
    expect(supportsDentalViewer({ modality: 'MR' })).toBe(false);
  });

  test('builds a filtered series viewer path with initial series and MAR compare params', () => {
    expect(
      getSeriesViewerPath(
        {
          studyInstanceUID: '1.2.3',
          modality: 'CT',
        },
        ['2.3.4', '5.6.7', '2.3.4'],
        '5.6.7',
        {
          marSourceSeriesInstanceUID: '2.3.4',
          marResultSeriesInstanceUID: '5.6.7',
        }
      )
    ).toBe(
      '/dentalCPR?StudyInstanceUIDs=1.2.3&SeriesInstanceUIDs=2.3.4%2C5.6.7&initialSeriesInstanceUID=5.6.7&marSourceSeriesInstanceUID=2.3.4&marResultSeriesInstanceUID=5.6.7'
    );
  });

  // ── P3.1: URL/series-state edge cases ─────────────────────────────────────

  test('series path with an empty UID list omits SeriesInstanceUIDs entirely (single-series fallback)', () => {
    expect(
      getSeriesViewerPath({ studyInstanceUID: '1.2.3', modality: 'CT' }, [])
    ).toBe('/dentalCPR?StudyInstanceUIDs=1.2.3');
  });

  test('series path drops blank/whitespace-only UIDs from the list', () => {
    expect(
      getSeriesViewerPath({ studyInstanceUID: '1.2.3', modality: 'CT' }, ['', '  ', '2.3.4'])
    ).toBe('/dentalCPR?StudyInstanceUIDs=1.2.3&SeriesInstanceUIDs=2.3.4');
  });

  test('series path dedupes repeated UIDs while preserving first-seen order', () => {
    expect(
      getSeriesViewerPath({ studyInstanceUID: '1.2.3', modality: 'CT' }, ['a.1', 'b.2', 'a.1', 'b.2'])
    ).toBe('/dentalCPR?StudyInstanceUIDs=1.2.3&SeriesInstanceUIDs=a.1%2Cb.2');
  });

  test('series path omits initialSeriesInstanceUID when not provided', () => {
    expect(
      getSeriesViewerPath({ studyInstanceUID: '1.2.3', modality: 'CT' }, ['a.1'])
    ).toBe('/dentalCPR?StudyInstanceUIDs=1.2.3&SeriesInstanceUIDs=a.1');
  });

  test('series path omits falsy extraParams entries (incomplete MAR-compare params fall back cleanly)', () => {
    expect(
      getSeriesViewerPath(
        { studyInstanceUID: '1.2.3', modality: 'CT' },
        ['a.1'],
        undefined,
        { marSourceSeriesInstanceUID: 'a.1', marResultSeriesInstanceUID: undefined }
      )
    ).toBe('/dentalCPR?StudyInstanceUIDs=1.2.3&SeriesInstanceUIDs=a.1&marSourceSeriesInstanceUID=a.1');
  });

  test('series path URL-encodes UIDs containing reserved characters', () => {
    expect(
      getSeriesViewerPath({ studyInstanceUID: 'study a/b', modality: 'CT' }, ['s a', 's&b'])
    ).toBe('/dentalCPR?StudyInstanceUIDs=study+a%2Fb&SeriesInstanceUIDs=s+a%2Cs%26b');
  });

  test('detects ZIP uploads by file name or MIME type', () => {
    expect(isZipFile({ name: 'foo.zip', type: '' } as File)).toBe(true);
    expect(isZipFile({ name: 'foo.dcm', type: 'application/zip' } as File)).toBe(true);
    expect(isZipFile({ name: 'foo.dcm', type: 'application/dicom' } as File)).toBe(false);
  });

  test('derives Orthanc REST base from dicom-web base', () => {
    expect(getOrthancRestBase('/pacs/dicom-web')).toBe('/pacs');
    expect(getOrthancRestBase('/pacs/dicom-web/')).toBe('/pacs');
  });

  test('extracts StudyInstanceUID from STOW-RS response', () => {
    expect(
      getStudyInstanceUIDFromStowResponse({
        '00081190': {
          Value: ['http://localhost/dicom-web/studies/1.2.840.1'],
        },
      })
    ).toBe('1.2.840.1');
  });
});

describe('OrthancClient.checkSeriesExists', () => {
  test('returns true when the QIDO series search finds a match', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ '0020000E': { Value: ['s.1'] } }] });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.checkSeriesExists('s.1')).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/pacs/dicom-web/series?SeriesInstanceUID=s.1');
  });

  test('returns false when the series is confirmed gone (empty result set)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.checkSeriesExists('s.gone')).resolves.toBe(false);
  });

  test('returns true (cannot verify) on a non-ok HTTP response rather than declaring the series gone', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.checkSeriesExists('s.1')).resolves.toBe(true);
  });

  test('returns true (cannot verify) on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'));
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.checkSeriesExists('s.1')).resolves.toBe(true);
  });

  test('returns false for an empty series UID without calling fetch', async () => {
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.checkSeriesExists('')).resolves.toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('OrthancClient.waitForSeriesQueryable', () => {
  test('resolves true immediately when the series is already queryable', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ '0020000E': { Value: ['s.1'] } }] });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.waitForSeriesQueryable('s.1', { delayMs: 0 })).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('retries through eventual-consistency lag and resolves true once found', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ '0020000E': { Value: ['s.1'] } }] });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.waitForSeriesQueryable('s.1', { attempts: 5, delayMs: 0 })).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test('gives up after the attempt budget and resolves false without throwing', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    const client = new OrthancClient('/pacs/dicom-web');
    await expect(client.waitForSeriesQueryable('s.gone', { attempts: 3, delayMs: 0 })).resolves.toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('stored MAR series helpers', () => {
  test('stores and retrieves MAR series mapping by source series', () => {
    saveStoredMarSeriesResult({
      studyInstanceUID: '1.2.3',
      sourceSeriesInstanceUID: 'orig.1',
      marSeriesInstanceUID: 'mar.1',
    });

    expect(getStoredMarSeriesResult('orig.1')).toEqual(
      expect.objectContaining({
        studyInstanceUID: '1.2.3',
        sourceSeriesInstanceUID: 'orig.1',
        marSeriesInstanceUID: 'mar.1',
      })
    );
  });

  test('finds MAR series mapping from either original or MAR series uid', () => {
    saveStoredMarSeriesResult({
      studyInstanceUID: '1.2.3',
      sourceSeriesInstanceUID: 'orig.2',
      marSeriesInstanceUID: 'mar.2',
    });

    expect(findStoredMarSeriesResult('orig.2')).toEqual(
      expect.objectContaining({ marSeriesInstanceUID: 'mar.2' })
    );
    expect(findStoredMarSeriesResult('mar.2')).toEqual(
      expect.objectContaining({ sourceSeriesInstanceUID: 'orig.2' })
    );
  });

  test('invalidateStoredMarSeriesResult removes a mapping by source series UID (regenerate path)', () => {
    saveStoredMarSeriesResult({
      studyInstanceUID: '1.2.3',
      sourceSeriesInstanceUID: 'orig.3',
      marSeriesInstanceUID: 'mar.3',
    });
    expect(getStoredMarSeriesResult('orig.3')).toBeDefined();

    invalidateStoredMarSeriesResult('orig.3');

    expect(getStoredMarSeriesResult('orig.3')).toBeUndefined();
    expect(findStoredMarSeriesResult('mar.3')).toBeUndefined();
  });

  test('invalidateStoredMarSeriesResult is a no-op for an unknown or empty UID', () => {
    saveStoredMarSeriesResult({
      studyInstanceUID: '1.2.3',
      sourceSeriesInstanceUID: 'orig.4',
      marSeriesInstanceUID: 'mar.4',
    });
    invalidateStoredMarSeriesResult('does-not-exist');
    invalidateStoredMarSeriesResult('');
    expect(getStoredMarSeriesResult('orig.4')).toBeDefined();
  });
});
