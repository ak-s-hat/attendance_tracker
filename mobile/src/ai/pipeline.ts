import { SCRFDDetector } from './detector';
import { ArcFaceRecognizer } from './recognizer';
import { MiniFASNetLiveness } from './liveness';
import { FrameData, PipelineResult } from './types';
import { postEmbeddingCheckin, postImageCheckin } from '../services/api';
import { vectorGallery } from './vectorMatcher';
import { enqueueOfflineScan } from '../database/offlineDb';

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
    if (detSession !== undefined || recSession !== undefined || liveSession !== undefined) {
      this.initialize(detSession, recSession, liveSession);
      return;
    }

    try {
      const { loadAllEdgeSessions } = require('../services/onnxEngine');
      const loaded = await loadAllEdgeSessions();
      this.initialize(loaded.detSession, loaded.recSession, loaded.liveSession);
    } catch (err: any) {
      console.warn('[EdgeAIPipeline] Auto model loading fallback:', err?.message || err);
      this.initialize(null, null, null);
    }
  }

  public async processFrame(frame: FrameData, overrideApiUrl?: string, deviceId = 'mobile_kiosk_01'): Promise<PipelineResult> {
    const timestamp = new Date().toISOString();
    const targetUrl = overrideApiUrl || this.apiBaseUrl;

    if (!this.isInitialized || !this.detector || !this.recognizer || !this.liveness) {
      console.warn('[EdgeAIPipeline] Auto-initializing fallback sessions on processFrame');
      this.initialize(null, null, null);
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

    // Step 4: Autonomous On-Device Vector Matching via InMemVectorGallery
    if (vectorGallery.getGallerySize() > 0) {
      const match = vectorGallery.searchBestMatch(embeddingArray, 0.65);
      if (match) {
        // Enqueue punch into local SQLite queue for async cloud sync (zero punch latency)
        try {
          await enqueueOfflineScan({
            id: `scan_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            employee_id: match.employee.id,
            employee_name: match.employee.name,
            check_type: 'CHECK_IN',
            timestamp,
            confidence_score: match.similarity,
            liveness_score: livenessResult.score,
          });
        } catch (dbErr) {
          console.warn('[EdgeAIPipeline] Failed to enqueue offline scan:', dbErr);
        }

        return {
          success: true,
          employee_name: match.employee.name,
          employee_id: match.employee.id,
          confidence: match.similarity,
          check_type: 'CHECK_IN',
          bbox: detResult.bbox,
          detScore: detResult.detScore,
          livenessScore: livenessResult.score,
          embedding: embeddingArray,
          timestamp,
        };
      } else {
        return {
          success: false,
          reason: 'unknown_face',
          confidence: 0,
          bbox: detResult.bbox,
          detScore: detResult.detScore,
          livenessScore: livenessResult.score,
          embedding: embeddingArray,
          timestamp,
        };
      }
    }

    // Step 4b: Fallback mode if local gallery has not yet been populated
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
