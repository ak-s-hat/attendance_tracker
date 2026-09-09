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
    // Add 10-second timeout to downloadAsync
    const downloadPromise = asset.downloadAsync();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Asset download timed out')), 10000)
    );
    await Promise.race([downloadPromise, timeoutPromise]);
  }
  return asset.localUri || asset.uri;
}

/**
 * Hardware-aware session creator. Uses stable optimized CPU vector kernels (ARM NEON)
 * on Android to prevent NNAPI native driver segfaults across varied hardware/firmware,
 * while still supporting CoreML on iOS and Web WASM.
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
      // Use CPU (ARM NEON) directly: NNAPI causes vendor driver segfaults on many devices
      const session = await ortNative.InferenceSession.create(modelPathOrUri, {
        executionProviders: ['cpu'],
      });
      return { session, provider: 'cpu' };
    } else if (Platform.OS === 'ios') {
      try {
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
      '[ONNXEngine] Native onnxruntime-react-native module not linked. Fallback mode active:',
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
    let detAsset: any, recAsset: any, liveAsset: any;
    try {
      detAsset = require('../../assets/models/det_10g_int8.onnx');
      recAsset = require('../../assets/models/w600k_r50_int8.onnx');
      liveAsset = require('../../assets/models/minifasnet_int8.onnx');
    } catch (reqErr: any) {
      console.warn('[ONNXEngine] Could not require model assets:', reqErr?.message || reqErr);
      throw new Error('MODEL_ASSETS_UNAVAILABLE');
    }

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
    if (err?.message === 'NATIVE_ORT_UNAVAILABLE' || err?.message === 'MODEL_ASSETS_UNAVAILABLE') {
      console.log('[ONNXEngine] Operating in managed mode (server delegate).');
    } else {
      console.warn('[ONNXEngine] Error loading edge ONNX models, falling back to server mode:', err?.message || err);
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
