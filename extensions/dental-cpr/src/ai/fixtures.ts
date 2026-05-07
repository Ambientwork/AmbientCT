// Demo fixtures — visibly marked isDemo:true. Used only when no real inference results exist.

import type {
  AiFinding,
  AiJob,
  AiSegmentationMask,
  AiSourceMetadata,
} from './types';

const DEMO_MODEL_ID = 'ambientct-demo-v0';
const DEMO_MODEL_VERSION = '0.0.0-demo';

function demoSource(studyInstanceUID: string): AiSourceMetadata {
  return {
    modelId: DEMO_MODEL_ID,
    modelVersion: DEMO_MODEL_VERSION,
    createdAt: '2024-01-01T00:00:00.000Z',
    studyInstanceUID,
  };
}

/**
 * Returns a deterministic demo AiJob in review_required state.
 * Used when no real inference job exists for the study.
 */
export function buildDemoJob(studyInstanceUID: string): AiJob {
  return {
    jobId: `demo-job-${studyInstanceUID}`,
    studyInstanceUID,
    status: 'review_required',
    progress: 1.0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:01:00.000Z',
  };
}

/**
 * Returns 4 demo AiFinding objects covering mixed classes, confidences and
 * uncertainty levels. All carry isDemo:true and reviewerState:'unreviewed'.
 *
 * Measurements are physiologically plausible:
 *  - periodontal_bone_loss: area_mm2 (bone loss surface area)
 *  - periapical_radiolucency: volume_mm3 (lesion volume estimate)
 */
export function buildDemoFindings(studyInstanceUID: string): AiFinding[] {
  const src = demoSource(studyInstanceUID);

  return [
    {
      findingId: `demo-finding-1-${studyInstanceUID}`,
      jobId: `demo-job-${studyInstanceUID}`,
      studyInstanceUID,
      findingClass: 'periodontal_bone_loss',
      anatomyClass: 'mandible',
      confidence: 0.81,
      uncertainty: 'low',
      reviewerState: 'unreviewed',
      measurement: { area_mm2: 14.3, tooth_number: 36 },
      source: src,
      isDemo: true,
      description: 'Possible horizontal bone loss at tooth 36. Requires clinician confirmation.',
    },
    {
      findingId: `demo-finding-2-${studyInstanceUID}`,
      jobId: `demo-job-${studyInstanceUID}`,
      studyInstanceUID,
      findingClass: 'periapical_radiolucency',
      anatomyClass: 'tooth',
      confidence: 0.94,
      uncertainty: 'low',
      reviewerState: 'unreviewed',
      measurement: { volume_mm3: 38.7, tooth_number: 46 },
      source: src,
      isDemo: true,
      description: 'Possible periapical radiolucency at tooth 46. Requires clinician confirmation.',
    },
    {
      findingId: `demo-finding-3-${studyInstanceUID}`,
      jobId: `demo-job-${studyInstanceUID}`,
      studyInstanceUID,
      findingClass: 'sinus_opacity',
      anatomyClass: 'maxillary_sinus',
      confidence: 0.62,
      uncertainty: 'high',
      reviewerState: 'unreviewed',
      source: src,
      isDemo: true,
      description: 'Possible sinus opacity, right maxillary sinus. Low confidence — requires review.',
    },
    {
      findingId: `demo-finding-4-${studyInstanceUID}`,
      jobId: `demo-job-${studyInstanceUID}`,
      studyInstanceUID,
      findingClass: 'caries_suspected',
      anatomyClass: 'tooth',
      confidence: 0.74,
      uncertainty: 'medium',
      reviewerState: 'unreviewed',
      measurement: { tooth_number: 26 },
      source: src,
      isDemo: true,
      description: 'Caries suspected at tooth 26. Requires clinician confirmation.',
    },
  ];
}

/**
 * Returns 2 demo segmentation mask metadata entries (mandible + mandibular_canal).
 * Geometry is deferred to DICOM SEG delivery; these are metadata placeholders only.
 */
export function buildDemoSegmentations(studyInstanceUID: string): AiSegmentationMask[] {
  const src = demoSource(studyInstanceUID);

  return [
    {
      segmentationId: `demo-seg-mandible-${studyInstanceUID}`,
      jobId: `demo-job-${studyInstanceUID}`,
      studyInstanceUID,
      anatomyClass: 'mandible',
      confidence: 0.91,
      uncertainty: 'low',
      source: src,
      isDemo: true,
    },
    {
      segmentationId: `demo-seg-canal-${studyInstanceUID}`,
      jobId: `demo-job-${studyInstanceUID}`,
      studyInstanceUID,
      anatomyClass: 'mandibular_canal',
      confidence: 0.78,
      uncertainty: 'medium',
      source: src,
      isDemo: true,
    },
  ];
}
