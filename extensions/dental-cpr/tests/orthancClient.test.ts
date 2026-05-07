// extensions/dental-cpr/tests/orthancClient.test.ts

// Mock global fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

import {
  parseStudyResponse,
  OrthancClient,
  getOrthancRestBase,
  getStudyModalities,
  getStudyViewerPath,
  getStudyInstanceUIDFromStowResponse,
  isZipFile,
  supportsDentalViewer,
} from '../src/utils/orthancClient';

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
