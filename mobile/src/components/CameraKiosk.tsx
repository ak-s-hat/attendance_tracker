import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { EdgeAIPipeline } from '../ai/pipeline';
import { PipelineResult, FrameData } from '../ai/types';
import { FaceOverlay } from './FaceOverlay';
import { colors } from '../theme/colors';
import { initEdgeSyncService, runFullSyncCycle } from '../services/syncService';
import { vectorGallery } from '../ai/vectorMatcher';
import { getOfflineDbStats, enqueueOfflineScan } from '../database/offlineDb';

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

  const isProcessingRef = useRef(false);
  const cameraRef = useRef<any>(null);
  const lastErrorTimeRef = useRef<number>(0);

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
      });

      if (photo && (photo.uri || photo.base64)) {
        if (photo.width && photo.height) {
          setFrameDimensions({ width: photo.width, height: photo.height });
        }

        let bytes: Uint8Array = new Uint8Array(0);
        if (photo.base64) {
          try {
            const binaryStr = atob(photo.base64);
            bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
          } catch {}
        }

        const frame: FrameData = {
          width: photo.width || 640,
          height: photo.height || 640,
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
        <View style={[styles.topStatusPill, status === 'error' && styles.topStatusPillError]}>
          <Text style={styles.topStatusText}>
            {status === 'idle' ? '🟢 EDGE AI READY' :
             status === 'scanning' ? '⏳ SCANNING...' :
             status === 'error' ? '🔴 SYNC OFFLINE' :
             status === 'spoof' ? '🔴 SPOOF DETECTED' :
             status === 'unknown' ? '🟡 UNKNOWN FACE' :
             status === 'success' ? '🟢 CHECK-IN' : '⚡ CHECK-IN'}
            {cachedEmployeeCount > 0 ? ` (${cachedEmployeeCount} cached)` : ''}
            {pendingSyncCount > 0 ? ` [${pendingSyncCount} pending]` : ''}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.autoToggleBtn, autoCaptureEnabled ? styles.autoToggleOn : styles.autoToggleOff]}
          onPress={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
        >
          <Text style={styles.autoToggleText}>
            {autoCaptureEnabled ? '⚡ Auto-Scan: ON' : '⏸️ Auto: OFF'}
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
          <Text style={styles.errorTitle}>⚠️ CONNECTION / SERVER ERROR</Text>
          <Text style={styles.errorSubtitle}>
            Cannot connect to {apiBaseUrl} — check Wi-Fi connection
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
});
