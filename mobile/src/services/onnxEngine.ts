import { Platform } from 'react-native';
import { Asset } from 'expo-asset';

export interface LoadedEdgeSessions {
  detSession: any | null;
  recSession: any | null;
  liveSession: any | null;
  hardwareProvider: 'nnapi' | 'coreml' | 'cpu' | 'wasm' | 'managed-fallback';
  isNativeAccelerated: boolean;
}

/**
 * Resolves a packaged bundled asset into a readable local filesystem path.
 */
export async function getLocalModelPath(assetModule: any): Promise<string> {
  const asset = Asset.fromModule(assetModule);
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  return asset.localUri || asset.uri;
}

/**
 * Hardware-aware session creator. Probes NPU/GPU accelerator drivers (NNAPI on Android,
 * CoreML on iOS), falling back to optimized CPU vector kernels (ARM NEON) if unavailable.
 */
export async function createHardwareAwareSession(modelPathOrUri: string): Promise<{ session: any; provider: string }> {
  if (Platform.OS === 'web') {
    try {
      const ortWeb = require('onnxruntime-web');
      const session = await ortWeb.InferenceSession.create(modelPathOrUri, {
        executionProviders: ['wasm'],
      });
      return { session, provider: 'wasm' };
    } catch (err: any) {
      console.warn('[ONNXEngine] Web WASM session creation failed:', err?.message || err);
      throw err;
    }
  }

  // Native Mobile: onnxruntime-react-native
  try {
    const ortNative = require('onnxruntime-react-native');

    if (Platform.OS === 'android') {
      try {
        // Attempt 1: Try NNAPI hardware acceleration (Qualcomm Hexagon / MediaTek APU / Google Tensor)
        const session = await ortNative.InferenceSession.create(modelPathOrUri, {
          executionProviders: ['nnapi', 'cpu'],
        });
        return { session, provider: 'nnapi' };
      } catch (nnapiErr) {
        console.log('[ONNXEngine] NNAPI unavailable on this device, falling back to ARM NEON CPU...');
        const session = await ortNative.InferenceSession.create(modelPathOrUri, {
          executionProviders: ['cpu'],
        });
        return { session, provider: 'cpu' };
      }
    } else if (Platform.OS === 'ios') {
      try {
        // Attempt 1: Try Apple Neural Engine (CoreML)
        const session = await ortNative.InferenceSession.create(modelPathOrUri, {
          executionProviders: ['coreml', 'cpu'],
        });
        return { session, provider: 'coreml' };
      } catch (coreMlErr) {
        console.log('[ONNXEngine] CoreML unavailable, falling back to ARM CPU...');
        const session = await ortNative.InferenceSession.create(modelPathOrUri, {
          executionProviders: ['cpu'],
        });
        return { session, provider: 'cpu' };
      }
    } else {
      const session = await ortNative.InferenceSession.create(modelPathOrUri, {
        executionProviders: ['cpu'],
      });
      return { session, provider: 'cpu' };
    }
  } catch (nativeErr: any) {
    // Graceful fallback for Expo Go where native C++ libraries cannot be loaded
    console.warn(
      '[ONNXEngine] Native onnxruntime-react-native module not linked (running in Expo Go). Fallback mode active:',
      nativeErr?.message || nativeErr
    );
    throw new Error('NATIVE_ORT_UNAVAILABLE');
  }
}

/**
 * Loads all packaged INT8 models (SCRFD detector, ArcFace recognizer, MiniFASNet liveness)
 * and returns initialized sessions with hardware acceleration metrics.
 */
export async function loadAllEdgeSessions(): Promise<LoadedEdgeSessions> {
  console.log('[ONNXEngine] Initializing Edge AI Inference Sessions with packaged INT8 models...');

  try {
    const detAsset = require('../../assets/models/det_10g_int8.onnx');
    const recAsset = require('../../assets/models/w600k_r50_int8.onnx');
    const liveAsset = require('../../assets/models/minifasnet_int8.onnx');

    const [detPath, recPath, livePath] = await Promise.all([
      getLocalModelPath(detAsset),
      getLocalModelPath(recAsset),
      getLocalModelPath(liveAsset),
    ]);

    const [detRes, recRes, liveRes] = await Promise.all([
      createHardwareAwareSession(detPath),
      createHardwareAwareSession(recPath),
      createHardwareAwareSession(livePath),
    ]);

    const activeProvider = detRes.provider as any;
    console.log(`[ONNXEngine] All 3 Edge models loaded successfully on [${activeProvider.toUpperCase()}] backend.`);

    return {
      detSession: detRes.session,
      recSession: recRes.session,
      liveSession: liveRes.session,
      hardwareProvider: activeProvider,
      isNativeAccelerated: activeProvider === 'nnapi' || activeProvider === 'coreml',
    };
  } catch (err: any) {
    if (err?.message === 'NATIVE_ORT_UNAVAILABLE') {
      console.log('[ONNXEngine] Operating in managed mode (server delegate). Build APK with eas build for native edge speed.');
    } else {
      console.warn('[ONNXEngine] Error loading edge ONNX models:', err?.message || err);
    }
    return {
      detSession: null,
      recSession: null,
      liveSession: null,
      hardwareProvider: 'managed-fallback',
      isNativeAccelerated: false,
    };
  }
}
