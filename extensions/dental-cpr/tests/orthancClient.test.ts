// extensions/dental-cpr/tests/orthancClient.test.ts

// Mock global fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

import { parseStudyResponse, OrthancClient } from '../src/utils/orthancClient';

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
