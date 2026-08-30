import { SCRFDDetector } from './detector';
import { ArcFaceRecognizer } from './recognizer';
import { MiniFASNetLiveness } from './liveness';
import { FrameData, PipelineResult } from './types';
import { postEmbeddingCheckin, postImageCheckin } from '../services/api';

export class EdgeAIPipeline {
  private detector: SCRFDDetector | null = null;
  private recognizer: ArcFaceRecognizer | null = null;
  private liveness: MiniFASNetLiveness | null = null;
  private isInitialized = false;
  private apiBaseUrl: string;

  constructor(apiBaseUrl = 'http://192.168.2.118:8000') {
    this.apiBaseUrl = apiBaseUrl;
  }

  public initialize(detSession: any, recSession: any, liveSession: any) {
    this.detector = new SCRFDDetector(detSession);
    this.recognizer = new ArcFaceRecognizer(recSession);
    this.liveness = new MiniFASNetLiveness(liveSession);
    this.isInitialized = true;
  }

  public async loadModels(detSession?: any, recSession?: any, liveSession?: any): Promise<void> {
    this.initialize(detSession, recSession, liveSession);
  }

  public async processFrame(frame: FrameData, overrideApiUrl?: string, deviceId = 'mobile_kiosk_01'): Promise<PipelineResult> {
    const timestamp = new Date().toISOString();
    const targetUrl = overrideApiUrl || this.apiBaseUrl;

    if (!this.isInitialized || !this.detector || !this.recognizer || !this.liveness) {
      throw new Error('EdgeAIPipeline not initialized. Call initialize() with ONNX sessions first.');
    }

    // Expo Go Managed Fallback Mode: if ONNX native C++ session is null, delegate to server checkin
    if (!this.detector.hasSession()) {
      try {
        const imagePayload = frame.uri || frame.data;
        const resData = await postImageCheckin(targetUrl, imagePayload, deviceId);
        if (resData.success) {
          return {
            success: true,
            employee_name: resData.employee_name,
            employee_id: resData.employee_id,
            confidence: resData.confidence || 0.98,
            check_type: resData.check_type || 'CHECK_IN',
            bbox: (resData.bbox || resData.debug_metadata?.bounding_box || [100, 100, 300, 300]) as [number, number, number, number],
            timestamp,
          };
        } else {
          const reason = resData.reason === 'employee_not_recognized' ? 'unknown_face' : (resData.reason || 'unknown_face');
          return {
            success: false,
            reason,
            is_live: reason !== 'spoof_detected',
            bbox: (resData.bbox || resData.debug_metadata?.bounding_box || [100, 100, 300, 300]) as [number, number, number, number],
            timestamp,
          };
        }
      } catch (e: any) {
        console.warn('[EdgeAIPipeline] Server fallback failed:', e?.message || e, 'URL:', targetUrl);
        return {
          success: false,
          reason: 'network_or_server_error',
          timestamp,
        };
      }
    }

    // Step 1: Face Detection
    const detResult = await this.detector.detect(frame);
    if (!detResult.success || !detResult.bbox) {
      return {
        success: false,
        reason: detResult.reason || 'no_face_detected',
        timestamp,
      };
    }

    // Step 2: Anti-Spoofing Liveness Check
    const livenessResult = await this.liveness.check(frame, detResult.bbox);
    if (!livenessResult.isLive) {
      return {
        success: false,
        reason: 'spoof_detected',
        livenessScore: livenessResult.score,
        bbox: detResult.bbox,
        timestamp,
      };
    }

    // Step 3: Compute 512-d ArcFace Face Embedding
    const embeddingTensor = await this.recognizer.getEmbedding(frame, detResult.bbox);
    const embeddingArray = Array.from(embeddingTensor);

    // Step 4: Transmit 512-d Embedding to Backend Server
    try {
      const resData = await postEmbeddingCheckin(targetUrl, {
        embedding: embeddingArray,
        device_id: deviceId,
        check_type: 'AUTO',
        liveness_score: livenessResult.score,
      });

      return {
        success: resData.success !== false,
        reason: resData.reason,
        employee_name: resData.employee_name,
        employee_id: resData.employee_id,
        confidence: resData.confidence,
        check_type: resData.check_type,
        bbox: detResult.bbox,
        detScore: detResult.detScore,
        livenessScore: livenessResult.score,
        embedding: embeddingArray,
        timestamp,
      };
    } catch (err: any) {
      return {
        success: false,
        reason: 'network_or_server_error',
        bbox: detResult.bbox,
        livenessScore: livenessResult.score,
        timestamp,
      };
    }
  }
}
