/**
 * tensorUtils.ts
 * Utility to create ONNX Runtime Tensors compatible with both JavaScript and C++ JSI.
 * 
 * Critical: onnxruntime-react-native's C++ binding (TensorUtils.cpp) specifically checks:
 *   bool isTensor(Runtime& runtime, const Object& obj) {
 *     return obj.hasProperty(runtime, "cpuData") &&
 *            obj.hasProperty(runtime, "dims") && obj.hasProperty(runtime, "type");
 *   }
 * If cpuData is absent, C++ throws:
 *   "Invalid tensor object: missing cpuData, dims, or type properties"
 */

export function createOrtTensor(
  type: 'float32' | 'uint8' | 'int8' | 'int32',
  data: Float32Array | Uint8Array | Int8Array | Int32Array,
  dims: number[]
): any {
  try {
    const ort = require('onnxruntime-react-native');
    if (ort && ort.Tensor) {
      const tensor = new ort.Tensor(type, data, dims);
      if (!tensor.cpuData) {
        tensor.cpuData = data;
      }
      return tensor;
    }
  } catch (_) {
    // onnxruntime-react-native not available or in test environment
  }

  // Pure JS duck-typed Tensor matching C++ JSI expectations exactly
  return {
    cpuData: data,
    data: data,
    dims: dims,
    type: type,
  };
}
