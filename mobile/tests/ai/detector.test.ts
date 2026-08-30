import { SCRFDDetector } from '../../src/ai/detector';
import { BoundingBox, FrameData } from '../../src/ai/types';

describe('SCRFDDetector Unit Tests', () => {
  it('should preprocess 640x480 frame to 640x640 float32 NCHW tensor', () => {
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(255),
      width: 640,
      height: 480,
    };
    const detector = new SCRFDDetector(null);

    const tensor = detector.preprocess(mockFrame);
    expect(tensor.length).toBe(1 * 3 * 640 * 640);
    // (255 - 127.5) / 128.0 = 127.5 / 128.0 = 0.99609375
    expect(tensor[0]).toBeCloseTo(0.9961, 4);
  });

  it('should compute correct Intersection over Union (IoU)', () => {
    const detector = new SCRFDDetector(null);
    const boxA: BoundingBox = [0, 0, 10, 10];
    const boxB: BoundingBox = [0, 0, 10, 10];
    const boxC: BoundingBox = [100, 100, 110, 110];
    const boxD: BoundingBox = [5, 0, 15, 10]; // 50% overlap

    expect(detector.computeIoU(boxA, boxB)).toBeCloseTo(1.0, 5);
    expect(detector.computeIoU(boxA, boxC)).toBeCloseTo(0.0, 5);
    expect(detector.computeIoU(boxA, boxD)).toBeCloseTo(0.3333, 3);
  });

  it('should apply NMS to filter overlapping candidate bounding boxes', () => {
    const detector = new SCRFDDetector(null);
    const boxes: BoundingBox[] = [
      [10, 10, 50, 50],
      [12, 12, 52, 52], // Heavy overlap with box 0
      [200, 200, 250, 250], // Separate box
    ];
    const scores = [0.95, 0.85, 0.90];

    const keep = detector.nms(boxes, scores, 0.4);
    expect(keep).toEqual([0, 2]); // Box 1 suppressed by Box 0
  });

  it('should handle detect result when no faces are detected', async () => {
    const mockSession = {
      inputNames: ['input.1'],
      outputNames: ['score_8', 'bbox_8', 'kps_8'],
      run: jest.fn().mockResolvedValue({
        score_8: { data: new Float32Array(100).fill(0.1) }, // Below 0.7 threshold
        bbox_8: { data: new Float32Array(400).fill(0.0) },
        kps_8: { data: new Float32Array(1000).fill(0.0) },
      }),
    };

    const detector = new SCRFDDetector(mockSession, 0.7, 0.4);
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(128),
      width: 640,
      height: 480,
    };

    const result = await detector.detect(mockFrame);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_face_detected');
  });
});
