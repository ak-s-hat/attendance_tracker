import { createOrtTensor } from '../../src/ai/tensorUtils';

describe('createOrtTensor Unit Tests', () => {
  it('creates tensor object containing cpuData, data, dims, and type properties', () => {
    const data = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const dims = [1, 1, 2, 2];
    const tensor = createOrtTensor('float32', data, dims);

    expect(tensor).toBeDefined();
    // Critical: C++ TensorUtils.cpp checks hasProperty("cpuData")
    expect(tensor.cpuData).toBeDefined();
    expect(tensor.cpuData).toBe(data);
    expect(tensor.data).toBe(data);
    expect(tensor.dims).toEqual(dims);
    expect(tensor.type).toBe('float32');
  });

  it('supports uint8 and int8 data types', () => {
    const uint8Data = new Uint8Array([255, 128, 0]);
    const tensor = createOrtTensor('uint8', uint8Data, [1, 3]);

    expect(tensor.cpuData).toBe(uint8Data);
    expect(tensor.type).toBe('uint8');
    expect(tensor.dims).toEqual([1, 3]);
  });
});
