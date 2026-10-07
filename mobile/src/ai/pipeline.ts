import { SCRFDDetector } from './detector';
import { ArcFaceRecognizer } from './recognizer';
import { MiniFASNetLiveness } from './liveness';
import { FrameData, PipelineResult } from './types';
import { postEmbeddingCheckin, postImageCheckin } from '../services/api';
import { vectorGallery } from './vectorMatcher';
import { enqueueOfflineScan } from '../database/offlineDb';
import { flushPendingAttendanceLogs } from '../services/syncService';
import { ScanTrace, log, errorToData } from '../services/logger';
import { dumpScanArtifacts, isDebugDumpEnabled } from '../services/debugDump';

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
      log.error('APP', 'ONNX model loading failed -> server fallback mode', errorToData(err));
      this.initialize(null, null, null);
    }
  }

  public isEdgeMode(): boolean {
    return !!(this.detector && this.detector.hasSession());
  }

  public getEngineDiagnostics() {
    try {
      const { getEngineDiagnostics } = require('../services/onnxEngine');
      return getEngineDiagnostics();
    } catch {
      return null;
    }
  }

  /**
   * Runs one scan. When a ScanTrace is passed, per-stage timings/scores are recorded on it and,
   * if debug mode is on, the exact model inputs are dumped to disk for offline comparison.
   */
  public async processFrame(
    frame: FrameData,
    overrideApiUrl?: string,
    deviceId = 'mobile_kiosk_01',
    trace?: ScanTrace
  ): Promise<PipelineResult> {
    trace?.set('frame', { width: frame.width, height: frame.height, bytes: frame.data?.length ?? 0 });
    const result = await this.processFrameInner(frame, overrideApiUrl, deviceId, trace);
    if (trace) {
      trace.set('result', {
        success: result.success,
        reason: result.reason,
        execution_mode: result.executionMode,
        employee_id: result.employee_id,
        employee_name: result.employee_name,
        confidence: result.confidence,
        check_type: result.check_type,
        error: result.errorMessage,
      });
      if (isDebugDumpEnabled()) {
        await dumpScanArtifacts({
          traceId: trace.id,
          frameUri: frame.uri,
          tensors: [
            { name: 'det_input_640', tensor: this.detector?.lastInputTensor, size: 640, layout: { order: 'RGB', mean: 127.5, std: 128.0 } },
            { name: 'liveness_input_80', tensor: this.liveness?.lastInputTensor, size: 80, layout: { order: 'BGR', mean: 0, std: 1 } },
            { name: 'rec_input_112', tensor: this.recognizer?.lastInputTensor, size: 112, layout: { order: 'RGB', mean: 127.5, std: 127.5 } },
          ],
          trace: { trace_id: trace.id, timings_ms: trace.timings, ...trace.data },
        });
        trace.mark('debug_dump');
      }
      // Clear so a later failed scan can't dump a stale tensor from a previous one
      if (this.detector) this.detector.lastInputTensor = null;
      if (this.liveness) this.liveness.lastInputTensor = null;
      if (this.recognizer) this.recognizer.lastInputTensor = null;
    }
    return result;
  }

  private async processFrameInner(
    frame: FrameData,
    overrideApiUrl: string | undefined,
    deviceId: string,
    trace?: ScanTrace
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const targetUrl = overrideApiUrl || this.apiBaseUrl;

    if (!this.isInitialized || !this.detector || !this.recognizer || !this.liveness) {
      throw new Error('EdgeAIPipeline not initialized');
    }

    // Expo Go Managed Fallback Mode: if ONNX native C++ session is null, delegate to server checkin
    if (!this.detector.hasSession()) {
      trace?.set('execution_mode', 'SERVER_FALLBACK');
      try {
        const imagePayload = frame.uri || frame.data;
        const resData = await postImageCheckin(targetUrl, imagePayload, deviceId);
        trace?.mark('server_checkin');
        trace?.set('server', { reason: resData.reason, debug: resData.debug_metadata });
        const inferenceLatencyMs = Date.now() - startTime;
        if (resData.success) {
          return {
            success: true,
            employee_name: resData.employee_name,
            employee_id: resData.employee_id,
            confidence: resData.confidence || 0.98,
            check_type: resData.check_type || 'CHECK_IN',
            bbox: (resData.bbox || resData.debug_metadata?.bounding_box || [100, 100, 300, 300]) as [number, number, number, number],
            timestamp,
            executionMode: 'SERVER_FALLBACK',
            inferenceLatencyMs,
          };
        } else {
          const reason = resData.reason === 'employee_not_recognized' ? 'unknown_face' : (resData.reason || 'unknown_face');
          return {
            success: false,
            reason,
            is_live: reason !== 'spoof_detected',
            bbox: (resData.bbox || resData.debug_metadata?.bounding_box || [100, 100, 300, 300]) as [number, number, number, number],
            timestamp,
            executionMode: 'SERVER_FALLBACK',
            inferenceLatencyMs,
          };
        }
      } catch (e: any) {
        log.warn('SCAN', 'Server fallback check-in failed', { url: targetUrl, ...errorToData(e) }, trace?.id);
        return {
          success: false,
          reason: 'network_or_server_error',
          timestamp,
          executionMode: 'SERVER_FALLBACK',
          inferenceLatencyMs: Date.now() - startTime,
        };
      }
    }

    let detResult: any;
    let livenessResult: any;
    let embeddingArray: number[];

    try {
      // Step 1: Face Detection
      detResult = await this.detector.detect(frame);
      trace?.mark('det');
      trace?.set('det', {
        success: detResult.success,
        reason: detResult.reason,
        score: detResult.detScore,
        faces_after_nms: this.detector.lastCandidateCount,
        bbox: detResult.bbox?.map((v: number) => Math.round(v)),
        landmarks: detResult.landmarks?.map((p: any) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
      });
      if (!detResult.success || !detResult.bbox) {
        return {
          success: false,
          reason: detResult.reason || 'no_face_detected',
          timestamp,
          executionMode: 'ONNX_LOCAL',
          inferenceLatencyMs: Date.now() - startTime,
        };
      }

      // Step 2: Anti-Spoofing Liveness Check
      livenessResult = await this.liveness.check(frame, detResult.bbox);
      trace?.mark('liveness');
      trace?.set('liveness', {
        score: livenessResult.score,
        is_live: livenessResult.isLive,
        note: livenessResult.note,
        logits: this.liveness.lastLogits,
        crop_box: this.liveness.lastExpandedBox?.map((v: number) => Math.round(v)),
      });
      if (!livenessResult.isLive) {
        return {
          success: false,
          reason: 'spoof_detected',
          livenessScore: livenessResult.score,
          bbox: detResult.bbox,
          timestamp,
          executionMode: 'ONNX_LOCAL',
          inferenceLatencyMs: Date.now() - startTime,
        };
      }

      // Step 3: Compute 512-d ArcFace Face Embedding with 5-point landmark alignment
      const embeddingTensor = await this.recognizer.getEmbedding(frame, detResult.bbox, detResult.landmarks);
      embeddingArray = Array.from(embeddingTensor);
      trace?.mark('rec');
      trace?.set('rec', { align_mode: this.recognizer.lastAlignMode });
    } catch (onnxErr: any) {
      log.error('SCAN', 'On-device ONNX inference failed', errorToData(onnxErr), trace?.id);
      
      // If frame image URI and server URL exist, gracefully fallback to server check-in
      if (frame.uri && targetUrl) {
        log.warn('SCAN', 'Falling back to server image check-in after local ONNX failure', null, trace?.id);
        try {
          const resData = await postImageCheckin(targetUrl, frame.uri, deviceId);
          return {
            success: resData.success !== false,
            reason: resData.reason,
            employee_name: resData.employee_name,
            employee_id: resData.employee_id,
            confidence: resData.confidence,
            check_type: resData.check_type,
            timestamp,
            executionMode: 'SERVER_FALLBACK',
            inferenceLatencyMs: Date.now() - startTime,
          };
        } catch (_) {}
      }

      return {
        success: false,
        reason: 'ai_inference_error',
        errorMessage: onnxErr?.message || 'ONNX inference error',
        timestamp,
        executionMode: 'ONNX_LOCAL',
        inferenceLatencyMs: Date.now() - startTime,
      };
    }

    // Step 4: Autonomous On-Device Vector Matching via InMemVectorGallery
    if (vectorGallery.getGallerySize() > 0) {
      const MATCH_THRESHOLD = 0.65;
      const top = vectorGallery.searchTopK(embeddingArray, 2);
      const match = top.length > 0 && top[0].similarity >= MATCH_THRESHOLD ? top[0] : null;
      trace?.mark('match');
      trace?.set('match', {
        gallery_size: vectorGallery.getGallerySize(),
        threshold: MATCH_THRESHOLD,
        top: top.map((m) => ({ id: m.employee.id, name: m.employee.name, sim: m.similarity })),
        margin: top.length > 1 ? Math.round((top[0].similarity - top[1].similarity) * 1000) / 1000 : null,
      });
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
          trace?.mark('enqueue');

          // Non-blocking background flush to Render cloud database if online
          flushPendingAttendanceLogs(targetUrl).catch((syncErr) =>
            console.log('[EdgeAIPipeline] Background punch flush notice (offline or deferred):', syncErr?.message || syncErr)
          );
        } catch (dbErr) {
          log.error('DB', 'Failed to enqueue offline scan', errorToData(dbErr), trace?.id);
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
          executionMode: 'ONNX_LOCAL',
          inferenceLatencyMs: Date.now() - startTime,
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
          executionMode: 'ONNX_LOCAL',
          inferenceLatencyMs: Date.now() - startTime,
        };
      }
    }

    // Step 4b: Fallback mode if local gallery has not yet been populated
    trace?.set('match', { gallery_size: 0, note: 'empty local gallery -> server /checkin/embedding' });
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
        executionMode: 'ONNX_LOCAL',
        inferenceLatencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        reason: 'network_or_server_error',
        bbox: detResult.bbox,
        livenessScore: livenessResult.score,
        timestamp,
        executionMode: 'ONNX_LOCAL',
        inferenceLatencyMs: Date.now() - startTime,
      };
    }
  }
}
