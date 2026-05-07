// Compile-smoke and literal-coverage tests for AI Assist type definitions.

import type {
  AiJobStatus,
  AnatomyClass,
  FindingClass,
  UncertaintyLevel,
  ReviewerState,
  MeasurementPayload,
  AiSourceMetadata,
  AiJob,
  AiFinding,
  AiSegmentationMask,
} from '../src/ai/types';

// ── Enum literal coverage ────────────────────────────────────────────────────

describe('AiJobStatus literals', () => {
  const allowed: AiJobStatus[] = [
    'queued',
    'running',
    'review_required',
    'completed',
    'failed',
  ];
  test('all 5 status values are defined', () => {
    expect(allowed).toHaveLength(5);
    expect(allowed).toContain('queued');
    expect(allowed).toContain('running');
    expect(allowed).toContain('review_required');
    expect(allowed).toContain('completed');
    expect(allowed).toContain('failed');
  });
});

describe('AnatomyClass literals', () => {
  const allowed: AnatomyClass[] = [
    'mandible',
    'maxilla',
    'tooth',
    'mandibular_canal',
    'maxillary_sinus',
  ];
  test('all 5 anatomy classes are defined', () => {
    expect(allowed).toHaveLength(5);
    expect(allowed).toContain('mandibular_canal');
    expect(allowed).toContain('maxillary_sinus');
  });
});

describe('FindingClass literals', () => {
  const allowed: FindingClass[] = [
    'periodontal_bone_loss',
    'periapical_radiolucency',
    'caries_suspected',
    'sinus_opacity',
    'tmj_degeneration_suspected',
  ];
  test('all 5 finding classes are defined', () => {
    expect(allowed).toHaveLength(5);
    expect(allowed).toContain('periapical_radiolucency');
    expect(allowed).toContain('tmj_degeneration_suspected');
  });
});

describe('UncertaintyLevel literals', () => {
  const allowed: UncertaintyLevel[] = ['low', 'medium', 'high'];
  test('all 3 uncertainty levels are defined', () => {
    expect(allowed).toHaveLength(3);
  });
});

describe('ReviewerState literals', () => {
  const allowed: ReviewerState[] = ['unreviewed', 'accepted', 'rejected', 'edited'];
  test('all 4 reviewer states are defined', () => {
    expect(allowed).toHaveLength(4);
    expect(allowed).toContain('unreviewed');
    expect(allowed).toContain('edited');
  });
});

// ── Type-shape smoke tests (compile-level: TS rejects invalid shapes) ─────────

describe('AiJob shape', () => {
  test('constructs a valid AiJob object', () => {
    const job: AiJob = {
      jobId: 'j1',
      studyInstanceUID: '1.2.3',
      status: 'queued',
      progress: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    expect(job.status).toBe('queued');
    expect(job.progress).toBe(0);
    expect(job.error).toBeUndefined();
  });
});

describe('AiFinding shape', () => {
  test('constructs a valid AiFinding object', () => {
    const source: AiSourceMetadata = {
      modelId: 'test',
      modelVersion: '0.0.1',
      createdAt: '2024-01-01T00:00:00Z',
      studyInstanceUID: '1.2.3',
    };
    const finding: AiFinding = {
      findingId: 'f1',
      jobId: 'j1',
      studyInstanceUID: '1.2.3',
      findingClass: 'periapical_radiolucency',
      confidence: 0.9,
      uncertainty: 'low',
      reviewerState: 'unreviewed',
      source,
      isDemo: false,
    };
    expect(finding.findingClass).toBe('periapical_radiolucency');
    expect(finding.isDemo).toBe(false);
    expect(finding.anatomyClass).toBeUndefined();
    expect(finding.measurement).toBeUndefined();
  });

  test('MeasurementPayload accepts all optional fields', () => {
    const m: MeasurementPayload = {
      distance_mm: 1.2,
      area_mm2: 5.5,
      volume_mm3: 20.1,
      tooth_number: 36,
      canal_distance_mm: 3.4,
    };
    expect(m.tooth_number).toBe(36);
  });
});

describe('AiSegmentationMask shape', () => {
  test('constructs a valid AiSegmentationMask', () => {
    const mask: AiSegmentationMask = {
      segmentationId: 's1',
      jobId: 'j1',
      studyInstanceUID: '1.2.3',
      anatomyClass: 'mandibular_canal',
      confidence: 0.85,
      uncertainty: 'medium',
      source: {
        modelId: 'x',
        modelVersion: '1',
        createdAt: '2024-01-01T00:00:00Z',
        studyInstanceUID: '1.2.3',
      },
      isDemo: true,
    };
    expect(mask.anatomyClass).toBe('mandibular_canal');
    expect(mask.isDemo).toBe(true);
  });
});
