import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { EdgeAIPipeline } from '../ai/pipeline';
import { PipelineResult, FrameData } from '../ai/types';
import { FaceOverlay } from './FaceOverlay';
import { colors } from '../theme/colors';
import { initEdgeSyncService, runFullSyncCycle, subscribeSyncEvents, forceSyncAll } from '../services/syncService';
import { vectorGallery } from '../ai/vectorMatcher';
import { getOfflineDbStats, enqueueOfflineScan } from '../database/offlineDb';
import { decodeJpegBase64 } from '../services/imageDecoder';

export interface CameraKioskProps {
  pipeline?: EdgeAIPipeline;
  apiBaseUrl?: string;
  onCheckinComplete?: (result: PipelineResult) => void;
  mockPermissionGranted?: boolean; // For testing without native camera module
  initialResult?: PipelineResult | null;
  initialStatus?: KioskStatus;
}

export type KioskStatus = 'idle' | 'scanning' | 'success' | 'spoof' | 'unknown' | 'error';

export const CameraKiosk: React.FC<CameraKioskProps> = ({
  pipeline,
  apiBaseUrl = 'http://localhost:8000',
  onCheckinComplete,
  mockPermissionGranted,
  initialResult = null,
  initialStatus = 'idle',
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<KioskStatus>(initialStatus);
  const [result, setResult] = useState<PipelineResult | null>(initialResult);
  const [resetCountdown, setResetCountdown] = useState<number | null>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 360, height: 480 });
  const [frameDimensions, setFrameDimensions] = useState({ width: 1080, height: 1920 });
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(false);
  const [cachedEmployeeCount, setCachedEmployeeCount] = useState<number>(0);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const isEdgeMode = !!pipeline?.isEdgeMode?.();
  const diagnostics = pipeline?.getEngineDiagnostics?.();

  const isProcessingRef = useRef(false);
  const cameraRef = useRef<any>(null);
  const lastErrorTimeRef = useRef<number>(0);

  // Subscribe to real-time sync events from syncService
  useEffect(() => {
    const unsubscribe = subscribeSyncEvents((stats) => {
      setCachedEmployeeCount(stats.cachedCount);
      setPendingSyncCount(stats.pendingSyncCount);
    });
    return () => unsubscribe();
  }, []);

  const handleManualSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncFeedback('Syncing with server...');
    try {
      const res = await forceSyncAll(apiBaseUrl);
      setCachedEmployeeCount(res.cachedTotal);
      setPendingSyncCount(0);
      setSyncFeedback(`✅ Synced! ${res.cachedTotal} employees loaded.`);
      setTimeout(() => setSyncFeedback(null), 4000);
    } catch (err: any) {
      setSyncFeedback(`❌ Sync failed: ${err?.message || 'Server error'}`);
      setTimeout(() => setSyncFeedback(null), 5000);
    } finally {
      setIsSyncing(false);
    }
  }, [apiBaseUrl, isSyncing]);

  useEffect(() => {
    // Initialize Edge AI Vector Gallery & Offline Sync Service
    initEdgeSyncService(apiBaseUrl)
      .then(async () => {
        const stats = await getOfflineDbStats();
        setCachedEmployeeCount(stats.cachedCount);
        setPendingSyncCount(stats.pendingSyncCount);
      })
      .catch((err) => console.warn('[CameraKiosk] Edge sync init failed:', err));
  }, [apiBaseUrl]);

  useEffect(() => {
    if (initialResult) setResult(initialResult);
    if (initialStatus !== 'idle') setStatus(initialStatus);
  }, [initialResult, initialStatus]);

  const processCapturedFrame = useCallback(
    async (frame: FrameData) => {
      if (isProcessingRef.current || !pipeline) return;
      isProcessingRef.current = true;
      setStatus('scanning');

      try {
        const res = await pipeline.processFrame(frame, apiBaseUrl);
        setResult(res);

        if (!res.success) {
          if (res.reason === 'spoof_detected' || res.is_live === false) {
            setStatus('spoof');
          } else if (
            res.reason === 'unknown_face' ||
            res.reason === 'employee_not_recognized' ||
            res.reason === 'no_face_detected'
          ) {
            setStatus('unknown');
          } else if (
            res.reason === 'network_or_server_error'
          ) {
            console.warn('[CameraKiosk] Server error, URL:', apiBaseUrl);
            lastErrorTimeRef.current = Date.now();
            setStatus('error');
          } else {
            setStatus('error');
          }
        } else {
          setStatus('success');
        }

        if (onCheckinComplete) {
          onCheckinComplete(res);
        }
      } catch (err) {
        console.error('Frame processing failed:', err);
        lastErrorTimeRef.current = Date.now();
        setStatus('error');
      } finally {
        // Release processing lock so auto-capture interval can trigger next scan
        // after the 3s reset countdown completes and status returns to 'idle'
        isProcessingRef.current = false;
      }
    },
    [pipeline, apiBaseUrl, onCheckinComplete]
  );

  // Silent Frame Capture (shutterSound: false)
  const captureAndProcess = useCallback(async () => {
    if (isProcessingRef.current || status !== 'idle') return;
    if (!cameraRef.current) return;

    // Error backoff: if server error occurred within 5 seconds, don't spam
    if (Date.now() - lastErrorTimeRef.current < 5000) {
      return;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        skipProcessing: true,
        shutterSound: false,
        base64: true,
      });

      if (photo && (photo.uri || photo.base64)) {
        let bytes: Uint8Array = new Uint8Array(0);
        let decodedWidth = photo.width || 640;
        let decodedHeight = photo.height || 640;

        if (photo.base64) {
          const decoded = decodeJpegBase64(photo.base64);
          if (decoded) {
            bytes = decoded.data;
            decodedWidth = decoded.width;
            decodedHeight = decoded.height;
          }
        }

        if (decodedWidth && decodedHeight) {
          setFrameDimensions({ width: decodedWidth, height: decodedHeight });
        }

        const frame: FrameData = {
          width: decodedWidth,
          height: decodedHeight,
          data: bytes,
          uri: photo.uri,
        };

        await processCapturedFrame(frame);
      }
    } catch (e) {
      console.warn('Frame capture attempt failed:', e);
      isProcessingRef.current = false;
    }
  }, [status, processCapturedFrame]);

  // Frame Capture Interval (3.0 seconds when idle and autoCaptureEnabled)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'idle' && autoCaptureEnabled) {
      // Fire once immediately, then every 3 seconds
      captureAndProcess();
      interval = setInterval(() => {
        captureAndProcess();
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, autoCaptureEnabled, captureAndProcess]);

  // Auto-reset timer effect (3 seconds countdown)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    let isMounted = true;
    if (status === 'success' || status === 'spoof' || status === 'unknown' || status === 'error') {
      let count = 3;
      setResetCountdown(count);
      timer = setInterval(() => {
        if (!isMounted) {
          clearInterval(timer);
          return;
        }
        count -= 1;
        if (count <= 0) {
          clearInterval(timer);
          if (isMounted) {
            setResetCountdown(null);
            setStatus('idle');
            setResult(null);
            isProcessingRef.current = false;
          }
        } else {
          if (isMounted) {
            setResetCountdown(count);
          }
        }
      }, 1000);
    }
    return () => {
      isMounted = false;
      if (timer) clearInterval(timer);
    };
  }, [status]);

  const isGranted =
    mockPermissionGranted !== undefined ? mockPermissionGranted : permission?.granted;

  if (permission === undefined && mockPermissionGranted === undefined) {
    return (
      <View testID="camera-kiosk-container" style={styles.container}>
        <Text testID="permission-prompt" style={styles.promptText}>
          Requesting camera permission...
        </Text>
      </View>
    );
  }

  if (!isGranted) {
    return (
      <View testID="camera-kiosk-container" style={styles.container}>
        <Text testID="permission-prompt" style={styles.promptText}>
          Camera access is required for Kiosk Mode.
        </Text>
        <TouchableOpacity
          testID="grant-permission-button"
          style={styles.grantBtn}
          onPress={requestPermission}
        >
          <Text style={styles.grantBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      testID="camera-kiosk-container"
      style={styles.container}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setContainerDimensions({ width, height });
        }
      }}
    >
      <CameraView
        testID="camera-view"
        ref={cameraRef}
        style={StyleSheet.absoluteFillObject}
        facing="front"
      />

      {/* Top Header Controls */}
      <View style={styles.topControlRow}>
        <TouchableOpacity
          testID="engine-mode-pill"
          style={[
            styles.topStatusPill,
            status === 'error' && styles.topStatusPillError,
            !isEdgeMode && styles.topStatusPillFallback,
          ]}
          onPress={() => setShowDiagnosticsModal(true)}
        >
          <Text style={styles.topStatusText}>
            {status === 'idle'
              ? (isEdgeMode ? '⚡ ONNX LOCAL READY' : '🌐 SERVER FALLBACK')
              : status === 'scanning' ? '⏳ SCANNING...'
              : status === 'error' ? '🔴 SYNC OFFLINE'
              : status === 'spoof' ? '🔴 SPOOF DETECTED'
              : status === 'unknown' ? '🟡 UNKNOWN FACE'
              : status === 'success' ? '🟢 CHECK-IN' : '⚡ CHECK-IN'}
            {cachedEmployeeCount > 0 ? ` (${cachedEmployeeCount})` : ''}
            {pendingSyncCount > 0 ? ` [${pendingSyncCount}p]` : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="diagnostics-button"
          style={styles.diagBtn}
          onPress={() => setShowDiagnosticsModal(true)}
        >
          <Text style={styles.diagBtnText}>ℹ️ AI Info</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="manual-sync-button"
          style={[styles.diagBtn, isSyncing && { opacity: 0.6 }]}
          onPress={handleManualSync}
          disabled={isSyncing}
        >
          <Text style={styles.diagBtnText}>{isSyncing ? '⏳' : '🔄 Sync'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.autoToggleBtn, autoCaptureEnabled ? styles.autoToggleOn : styles.autoToggleOff]}
          onPress={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
        >
          <Text style={styles.autoToggleText}>
            {autoCaptureEnabled ? '⚡ Auto: ON' : '⏸️ Auto: OFF'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Face Bounding Box & Coordinates Overlay */}
      <FaceOverlay
        bbox={result?.bbox}
        status={status}
        containerWidth={containerDimensions.width}
        containerHeight={containerDimensions.height}
        frameWidth={frameDimensions.width}
        frameHeight={frameDimensions.height}
        detScore={result?.detScore ?? result?.det_score}
      />

      {/* Manual Trigger Scan Button (Always accessible when idle) */}
      {status === 'idle' && (
        <TouchableOpacity style={styles.scanBtn} onPress={captureAndProcess}>
          <Text style={styles.scanBtnText}>📸 Tap to Check In</Text>
        </TouchableOpacity>
      )}

      {/* Spoof Warning Overlay */}
      {status === 'spoof' && (
        <View testID="spoof-banner" style={styles.spoofBanner}>
          <Text style={styles.spoofTitle}>⚠️ SPOOF DETECTED</Text>
          <Text testID="spoof-message" style={styles.spoofSubtitle}>
            Spoof detected — use a real face
          </Text>
          {resetCountdown !== null && (
            <Text testID="reset-countdown" style={styles.resetBadge}>
              Resetting in {resetCountdown}s...
            </Text>
          )}
        </View>
      )}

      {/* Unknown / Unrecognized Face Banner */}
      {status === 'unknown' && (
        <View style={styles.unknownBanner}>
          <Text style={styles.unknownTitle}>👤 UNKNOWN FACE</Text>
          <Text style={styles.unknownSubtitle}>
            Face not recognized — enroll via Web Portal first
          </Text>
          {resetCountdown !== null && (
            <Text style={styles.resetBadge}>Resetting in {resetCountdown}s...</Text>
          )}
        </View>
      )}

      {/* Network or System Error Banner */}
      {status === 'error' && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>
            {result?.reason === 'ai_inference_error' ? '⚠️ AI ENGINE NOTICE' : '⚠️ CONNECTION / SERVER ERROR'}
          </Text>
          <Text style={styles.errorSubtitle}>
            {result?.errorMessage || (result?.reason === 'ai_inference_error'
              ? 'Local inference encountered an error, falling back to server'
              : `Cannot connect to ${apiBaseUrl} — check Wi-Fi connection`)}
          </Text>
          {resetCountdown !== null && (
            <Text style={styles.resetBadge}>Resetting in {resetCountdown}s...</Text>
          )}
        </View>
      )}

      {/* Recognition Result Success Overlay */}
      {status === 'success' && result && (
        <View testID="recognition-banner" style={styles.resultBanner}>
          <Text testID="employee-name" style={styles.employeeName}>
            {result.employee_name || 'Employee Identified'}
          </Text>

          {/* Visual Execution Mode Pill (Shows local ONNX vs cloud delegate) */}
          <View
            testID="execution-mode-badge"
            style={[
              styles.execModeBadge,
              result.executionMode === 'ONNX_LOCAL' ? styles.execModeLocal : styles.execModeFallback,
            ]}
          >
            <Text style={styles.execModeText}>
              {result.executionMode === 'ONNX_LOCAL'
                ? `⚡ 100% OFFLINE ONNX (${result.inferenceLatencyMs ?? 42}ms)`
                : `🌐 CLOUD DELEGATE (${result.inferenceLatencyMs ?? 450}ms)`}
            </Text>
          </View>

          <View style={styles.badgeRow}>
            <View
              testID="check-type-badge"
              style={[
                styles.checkTypeBadge,
                result.check_type === 'CHECK_OUT' ? styles.badgeOut : styles.badgeIn,
              ]}
            >
              <Text style={styles.checkTypeText}>{result.check_type || 'CHECK_IN'}</Text>
            </View>
            <Text testID="confidence-text" style={styles.confidenceText}>
              Confidence: {((result.confidence || 0) * 100).toFixed(1)}%
            </Text>
          </View>
          {resetCountdown !== null && (
            <Text testID="reset-countdown" style={styles.resetBadge}>
              Resetting in {resetCountdown}s...
            </Text>
          )}
        </View>
      )}

      {/* Interactive AI Engine Diagnostics Modal */}
      <Modal
        visible={showDiagnosticsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDiagnosticsModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalHeader}>Edge AI Engine Diagnostics</Text>

            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Active Pipeline:</Text>
              <Text
                testID="diag-active-mode"
                style={[styles.diagVal, isEdgeMode ? styles.textSuccess : styles.textWarning]}
              >
                {isEdgeMode ? '⚡ ONNX Local (100% Offline)' : '🌐 Cloud Server Fallback'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Native Runtime:</Text>
              <Text
                style={[
                  styles.diagVal,
                  diagnostics?.isNativeOrtAvailable ? styles.textSuccess : styles.textWarning,
                ]}
              >
                {diagnostics?.isNativeOrtAvailable
                  ? '✅ NativeModules.Onnxruntime Bound'
                  : '⚠️ Native Module Not Bound'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Execution Provider:</Text>
              <Text style={styles.diagVal}>
                {(diagnostics?.hardwareProvider || (isEdgeMode ? 'cpu' : 'managed-fallback')).toUpperCase()}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>SCRFD Face Detector:</Text>
              <Text style={[styles.diagVal, diagnostics?.detLoaded ? styles.textSuccess : styles.textDim]}>
                {diagnostics?.detLoaded ? '✅ det_10g_int8.onnx' : '— Server SCRFD'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>ArcFace Recognizer:</Text>
              <Text style={[styles.diagVal, diagnostics?.recLoaded ? styles.textSuccess : styles.textDim]}>
                {diagnostics?.recLoaded ? '✅ w600k_r50_int8.onnx' : '— Server ArcFace'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>MiniFASNet Liveness:</Text>
              <Text style={[styles.diagVal, diagnostics?.liveLoaded ? styles.textSuccess : styles.textDim]}>
                {diagnostics?.liveLoaded ? '✅ minifasnet_int8.onnx' : '— Server MiniFASNet'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Offline Biometric Cache:</Text>
              <Text style={styles.diagVal}>{cachedEmployeeCount} cached employees</Text>
            </View>

            {diagnostics?.fallbackReason && (
              <View style={styles.diagReasonBox}>
                <Text style={styles.diagReasonTitle}>Fallback Reason:</Text>
                <Text style={styles.diagReasonText}>{diagnostics.fallbackReason}</Text>
              </View>
            )}

            {/* Manual Sync Cloud Trigger Button */}
            <TouchableOpacity
              testID="modal-sync-button"
              style={[styles.modalSyncBtn, isSyncing && styles.modalSyncBtnDisabled]}
              onPress={handleManualSync}
              disabled={isSyncing}
            >
              <Text style={styles.modalSyncBtnText}>
                {isSyncing ? '⏳ Syncing...' : '🔄 Pull Employees from Cloud DB'}
              </Text>
            </TouchableOpacity>

            {syncFeedback && (
              <Text style={styles.syncFeedbackText}>{syncFeedback}</Text>
            )}

            <TouchableOpacity
              testID="close-diagnostics-button"
              style={styles.modalCloseBtn}
              onPress={() => setShowDiagnosticsModal(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  promptText: {
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  grantBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  grantBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  spoofBanner: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: colors.error,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  spoofTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  spoofSubtitle: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
  },
  resultBanner: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: colors.surface,
    borderColor: colors.success,
    borderWidth: 2,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 6,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  employeeName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  checkTypeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeIn: {
    backgroundColor: colors.success,
  },
  badgeOut: {
    backgroundColor: colors.warning,
  },
  checkTypeText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  confidenceText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600',
  },
  resetBadge: {
    color: colors.secondaryText,
    fontSize: 12,
    marginTop: 4,
  },
  topControlRow: {
    position: 'absolute',
    top: 16,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  topStatusPill: {
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.card,
    flexShrink: 1,
  },
  topStatusPillError: {
    backgroundColor: colors.errorBg,
    borderColor: colors.error,
  },
  topStatusText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  autoToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginLeft: 8,
  },
  autoToggleOn: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    borderColor: colors.success,
  },
  autoToggleOff: {
    backgroundColor: colors.surface,
    borderColor: colors.card,
  },
  autoToggleText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: 'bold',
  },
  scanBtn: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 30,
    elevation: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    zIndex: 10,
  },
  scanBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  unknownBanner: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: colors.warning,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 6,
  },
  unknownTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  unknownSubtitle: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
  },
  errorBanner: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 6,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  errorSubtitle: {
    color: colors.secondaryText,
    fontSize: 14,
    textAlign: 'center',
  },
  topStatusPillFallback: {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
    borderColor: colors.warning,
  },
  diagBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginLeft: 6,
    backgroundColor: colors.surface,
    borderColor: colors.primary,
  },
  diagBtnText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: 'bold',
  },
  execModeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginVertical: 4,
    alignSelf: 'center',
  },
  execModeLocal: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  execModeFallback: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  execModeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.card,
  },
  modalHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  diagLabel: {
    color: colors.secondaryText,
    fontSize: 13,
  },
  diagVal: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  textSuccess: {
    color: colors.success,
  },
  textWarning: {
    color: colors.warning,
  },
  textDanger: {
    color: colors.error,
  },
  textDim: {
    color: colors.secondaryText,
  },
  diagReasonBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  diagReasonTitle: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  diagReasonText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
  },
  modalSyncBtn: {
    marginTop: 14,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.5)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalSyncBtnDisabled: {
    opacity: 0.5,
  },
  modalSyncBtnText: {
    color: colors.success || '#10B981',
    fontWeight: 'bold',
    fontSize: 13,
  },
  syncFeedbackText: {
    marginTop: 6,
    color: '#E0E7FF',
    fontSize: 12,
    textAlign: 'center',
  },
  modalCloseBtn: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
