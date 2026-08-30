export interface Point2D {
  x: number;
  y: number;
}

export type BoundingBox = [number, number, number, number]; // [x1, y1, x2, y2]

export type FacialLandmarks = [Point2D, Point2D, Point2D, Point2D, Point2D]; // 5 facial landmarks

export interface FrameData {
  data: Uint8Array; // Raw RGBA or RGB pixel buffer
  width: number;
  height: number;
  uri?: string;     // Local image file URI from camera
}

export interface DetectionResult {
  success: boolean;
  reason?: 'no_face_detected' | 'multiple_faces' | 'detection_failed';
  bbox?: BoundingBox;
  detScore?: number;
  landmarks?: FacialLandmarks;
}

export interface LivenessResult {
  isLive: boolean;
  score: number;
  note: string;
}

export interface RecognitionResult {
  embedding: Float32Array; // 512-dimensional L2-normalized vector
}

export interface PipelineResult {
  success: boolean;
  reason?: string;
  employee_name?: string;
  employee_id?: string;
  confidence?: number;
  check_type?: string;
  bbox?: BoundingBox;
  detScore?: number;
  det_score?: number;
  livenessScore?: number;
  is_live?: boolean;
  embedding?: number[]; // 512 float array sent to API
  timestamp: string;
}
