import { NativeModules } from 'react-native';
import { isNativeOrtAvailable, createHardwareAwareSession, loadAllEdgeSessions, getEngineDiagnostics } from '../../src/services/onnxEngine';

describe('ONNXEngine Native Module Guarding & Fallback Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects when NativeModules.Onnxruntime is missing and returns false', () => {
    // In test environment, NativeModules.Onnxruntime is undefined
    expect(isNativeOrtAvailable()).toBe(false);
  });

  it('throws NATIVE_ORT_UNAVAILABLE without attempting to require onnxruntime-react-native if unlinked', async () => {
    await expect(createHardwareAwareSession('test_path.onnx')).rejects.toThrow('NATIVE_ORT_UNAVAILABLE');
  });

  it('loadAllEdgeSessions gracefully returns managed-fallback sessions when NativeModules.Onnxruntime is missing', async () => {
    const result = await loadAllEdgeSessions();
    expect(result.detSession).toBeNull();
    expect(result.recSession).toBeNull();
    expect(result.liveSession).toBeNull();
    expect(result.hardwareProvider).toBe('managed-fallback');
    expect(result.isNativeAccelerated).toBe(false);

    const diags = getEngineDiagnostics();
    expect(diags.isNativeOrtAvailable).toBe(false);
    expect(diags.hardwareProvider).toBe('managed-fallback');
    expect(diags.fallbackReason).toContain('NativeModules.Onnxruntime missing');
  });

  it('returns true for isNativeOrtAvailable when NativeModules.Onnxruntime is defined', () => {
    (NativeModules as any).Onnxruntime = { install: jest.fn() };
    expect(isNativeOrtAvailable()).toBe(true);
    delete (NativeModules as any).Onnxruntime;
  });
});
