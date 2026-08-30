import { MiniFASNetLiveness } from '../../src/ai/liveness';
import { BoundingBox, FrameData } from '../../src/ai/types';

describe('MiniFASNetLiveness Unit Tests', () => {
  it('should expand bounding box by 1.5x centered on face centroid', () => {
    const liveness = new MiniFASNetLiveness(null);
    const box: BoundingBox = [100, 100, 200, 200]; // 100x100 box, center (150, 150)
    const expanded = liveness.expandBoundingBox(box, 640, 480, 1.5);

    // 1.5x size = 150x150 -> x1 = 150 - 75 = 75, x2 = 150 + 75 = 225
    expect(expanded[0]).toBe(75);
    expect(expanded[1]).toBe(75);
    expect(expanded[2]).toBe(225);
    expect(expanded[3]).toBe(225);
  });

  it('should clamp expanded bounding box within frame dimensions', () => {
    const liveness = new MiniFASNetLiveness(null);
    const box: BoundingBox = [0, 0, 100, 100];
    const expanded = liveness.expandBoundingBox(box, 640, 480, 1.5);

    expect(expanded[0]).toBe(0); // Clamped at xmin = 0
    expect(expanded[1]).toBe(0); // Clamped at ymin = 0
  });

  it('should preprocess frame into 80x80 float32 NCHW tensor', () => {
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(150),
      width: 640,
      height: 480,
    };
    const box: BoundingBox = [100, 100, 200, 200];
    const liveness = new MiniFASNetLiveness(null);

    const tensor = liveness.preprocess(mockFrame, box);
    expect(tensor.length).toBe(1 * 3 * 80 * 80);
    expect(tensor[0]).toBe(150); // Raw 0..255 float
  });

  it('should fallback to stub when session is null', async () => {
    const liveness = new MiniFASNetLiveness(null);
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(128),
      width: 640,
      height: 480,
    };
    const box: BoundingBox = [100, 100, 200, 200];

    const result = await liveness.check(mockFrame, box);
    expect(result.isLive).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.note).toBe('liveness_stub_fallback');
  });

  it('should calculate softmax score correctly for real face logits', async () => {
    // Logits: [spoof = 0.0, real = 2.0] -> Softmax(real) = exp(2) / (exp(0) + exp(2)) = 7.389 / (1 + 7.389) ≈ 0.8808
    const mockSession = {
      inputNames: ['input'],
      outputNames: ['logits'],
      run: jest.fn().mockResolvedValue({
        logits: { data: new Float32Array([0.0, 2.0]) },
      }),
    };

    const liveness = new MiniFASNetLiveness(mockSession, 0.5);
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(128),
      width: 640,
      height: 480,
    };
    const box: BoundingBox = [100, 100, 200, 200];

    const result = await liveness.check(mockFrame, box);
    expect(result.isLive).toBe(true);
    expect(result.score).toBeCloseTo(0.8808, 3);
  });

  it('should reject spoof face logits correctly', async () => {
    // Logits: [spoof = 3.0, real = -1.0] -> Softmax(real) = exp(-1) / (exp(3) + exp(-1)) ≈ 0.0179
    const mockSession = {
      inputNames: ['input'],
      outputNames: ['logits'],
      run: jest.fn().mockResolvedValue({
        logits: { data: new Float32Array([3.0, -1.0]) },
      }),
    };

    const liveness = new MiniFASNetLiveness(mockSession, 0.5);
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(128),
      width: 640,
      height: 480,
    };
    const box: BoundingBox = [100, 100, 200, 200];

    const result = await liveness.check(mockFrame, box);
    expect(result.isLive).toBe(false);
    expect(result.score).toBeLessThan(0.5);
  });
});
