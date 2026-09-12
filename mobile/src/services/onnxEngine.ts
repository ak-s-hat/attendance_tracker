import { NativeModules, Platform } from 'react-native';
import { Asset } from 'expo-asset';

export interface LoadedEdgeSessions {
  detSession: any | null;
  recSession: any | null;
  liveSession: any | null;
  hardwareProvider: 'nnapi' | 'coreml' | 'cpu' | 'wasm' | 'managed-fallback';
  isNativeAccelerated: boolean;
}

export interface EngineDiagnostics {
  isNativeOrtAvailable: boolean;
  hardwareProvider: 'nnapi' | 'coreml' | 'cpu' | 'wasm' | 'managed-fallback' | 'uninitialized';
  detLoaded: boolean;
  recLoaded: boolean;
  liveLoaded: boolean;
  fallbackReason: string | null;
  timestamp: string;
}

let diagnosticsState: EngineDiagnostics = {
  isNativeOrtAvailable: false,
  hardwareProvider: 'uninitialized',
  detLoaded: false,
  recLoaded: false,
  liveLoaded: false,
  fallbackReason: null,
  timestamp: new Date().toISOString(),
};

export function getEngineDiagnostics(): EngineDiagnostics {
  return { ...diagnosticsState };
}

/**
 * Helper to safely check if the onnxruntime-react-native native module is bound in the binary.
 */
export function isNativeOrtAvailable(): boolean {
  try {
    return Platform.OS !== 'web' && !!NativeModules?.Onnxruntime;
  } catch {
    return false;
  }
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

  // Native Mobile: verify NativeModules.Onnxruntime exists BEFORE requiring onnxruntime-react-native.
  // When NativeModules.Onnxruntime is missing, onnxruntime-react-native/lib/binding.ts executes
  // Module.install() which throws: TypeError: Cannot read property 'install' of null / undefined.
  if (!isNativeOrtAvailable()) {
    console.warn('[ONNXEngine] NativeModules.Onnxruntime not found in binary. Using server fallback.');
    throw new Error('NATIVE_ORT_UNAVAILABLE');
  }

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
    console.warn(
      '[ONNXEngine] Native onnxruntime-react-native session creation failed:',
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

  const nativeAvailable = isNativeOrtAvailable();
  diagnosticsState.isNativeOrtAvailable = nativeAvailable;
  diagnosticsState.timestamp = new Date().toISOString();

  // Fast check: if native module is not linked in binary, immediately return managed-fallback
  if (Platform.OS !== 'web' && !nativeAvailable) {
    const reason = 'NativeModules.Onnxruntime missing in APK binary (autolinking issue)';
    console.log(`[ONNXEngine] ${reason}. Operating in managed mode (server delegate).`);
    diagnosticsState.hardwareProvider = 'managed-fallback';
    diagnosticsState.detLoaded = false;
    diagnosticsState.recLoaded = false;
    diagnosticsState.liveLoaded = false;
    diagnosticsState.fallbackReason = reason;

    return {
      detSession: null,
      recSession: null,
      liveSession: null,
      hardwareProvider: 'managed-fallback',
      isNativeAccelerated: false,
    };
  }

  try {
    let detAsset: any, recAsset: any, liveAsset: any;
    try {
      detAsset = require('../../assets/models/det_10g_int8.onnx');
      recAsset = require('../../assets/models/w600k_r50_int8.onnx');
      liveAsset = require('../../assets/models/minifasnet_int8.onnx');
    } catch (reqErr: any) {
      const reason = `Model asset files unavailable: ${reqErr?.message || reqErr}`;
      diagnosticsState.fallbackReason = reason;
      console.warn('[ONNXEngine] Could not require model assets:', reqErr?.message || reqErr);
      throw new Error('MODEL_ASSETS_UNAVAILABLE');
    }

    const [detPath, recPath, livePath] = await Promise.all([
      getLocalModelPath(detAsset),
      getLocalModelPath(recAsset),
      getLocalModelPath(liveAsset),
    ]);

    // Load sequentially to minimize peak native C++ heap allocations
    const detRes = await createHardwareAwareSession(detPath);
    const recRes = await createHardwareAwareSession(recPath);
    const liveRes = await createHardwareAwareSession(livePath);

    const activeProvider = detRes.provider as any;
    console.log(`[ONNXEngine] All 3 Edge models loaded successfully on [${activeProvider.toUpperCase()}] backend.`);

    diagnosticsState.hardwareProvider = activeProvider;
    diagnosticsState.detLoaded = true;
    diagnosticsState.recLoaded = true;
    diagnosticsState.liveLoaded = true;
    diagnosticsState.fallbackReason = null;

    return {
      detSession: detRes.session,
      recSession: recRes.session,
      liveSession: liveRes.session,
      hardwareProvider: activeProvider,
      isNativeAccelerated: activeProvider === 'nnapi' || activeProvider === 'coreml',
    };
  } catch (err: any) {
    const reason = err?.message || String(err);
    diagnosticsState.hardwareProvider = 'managed-fallback';
    diagnosticsState.detLoaded = false;
    diagnosticsState.recLoaded = false;
    diagnosticsState.liveLoaded = false;
    diagnosticsState.fallbackReason = diagnosticsState.fallbackReason || reason;

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
