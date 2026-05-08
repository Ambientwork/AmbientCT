// AmbientCT AI Assist — type definitions. Research preview, not for diagnosis.

export type AiJobStatus =
  | 'queued'
  | 'running'
  | 'review_required'
  | 'completed'
  | 'failed';

export type AnatomyClass =
  | 'mandible'
  | 'maxilla'
  | 'tooth'
  | 'mandibular_canal'
  | 'maxillary_sinus';

export type FindingClass =
  | 'periodontal_bone_loss'
  | 'periapical_radiolucency'
  | 'caries_suspected'
  | 'sinus_opacity'
  | 'tmj_degeneration_suspected';

export type UncertaintyLevel = 'low' | 'medium' | 'high';

export type ReviewerState = 'unreviewed' | 'accepted' | 'rejected' | 'edited';

export interface MeasurementPayload {
  distance_mm?: number;
  area_mm2?: number;
  volume_mm3?: number;
  tooth_number?: number;
  canal_distance_mm?: number;
}

export interface AiSourceMetadata {
  modelId: string;
  modelVersion: string;
  createdAt: string;        // ISO 8601
  studyInstanceUID: string;
  seriesInstanceUID?: string;
}

export interface AiJob {
  jobId: string;
  studyInstanceUID: string;
  status: AiJobStatus;
  progress: number;         // 0.0 – 1.0
  error?: string;
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
}

export interface AiFinding {
  findingId: string;
  jobId: string;
  studyInstanceUID: string;
  findingClass: FindingClass;
  anatomyClass?: AnatomyClass;
  confidence: number;       // 0.0 – 1.0
  uncertainty: UncertaintyLevel;
  reviewerState: ReviewerState;
  measurement?: MeasurementPayload;
  source: AiSourceMetadata;
  isDemo: boolean;
  description?: string;
}

/**
 * Metadata for an anatomy segmentation mask.
 * Geometry data arrives later as DICOM SEG; only metadata is stored here.
 */
export interface AiSegmentationMask {
  segmentationId: string;
  jobId: string;
  studyInstanceUID: string;
  anatomyClass: AnatomyClass;
  confidence: number;       // 0.0 – 1.0
  uncertainty: UncertaintyLevel;
  source: AiSourceMetadata;
  isDemo: boolean;
}
