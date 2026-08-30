import { ArcFaceRecognizer } from '../../src/ai/recognizer';
import { MiniFASNetLiveness } from '../../src/ai/liveness';
import { SCRFDDetector } from '../../src/ai/detector';
import { EdgeAIPipeline } from '../../src/ai/pipeline';
import { BoundingBox, FrameData } from '../../src/ai/types';
import * as apiModule from '../../src/services/api';

jest.mock('../../src/services/api');

describe('Challenger M2-1: Edge AI Empirical Stress & Edge Case Suite', () => {

  describe('1. Vector Math & L2 Normalization Edge Cases (ArcFaceRecognizer)', () => {
    it('empirical test: L2 normalization outputs exact unit vector (||e||2 = 1.0)', () => {
      const raw = new Float32Array(512);
      for (let i = 0; i < 512; i++) raw[i] = (i + 1) * 0.0314;

      const normVec = ArcFaceRecognizer.l2Normalize(raw);
      let sumSq = 0;
      for (let i = 0; i < 512; i++) sumSq += normVec[i] * normVec[i];
      const normVal = Math.sqrt(sumSq);

      expect(normVal).toBeCloseTo(1.0, 5);
      expect(Math.abs(normVal - 1.0)).toBeLessThan(1e-4);
    });

    it('empirical test: cosine similarity self-match equals 1.0', () => {
      const raw = new Float32Array(512);
      for (let i = 0; i < 512; i++) raw[i] = Math.cos(i);

      const normVec = ArcFaceRecognizer.l2Normalize(raw);
      const cosSelf = ArcFaceRecognizer.cosineSimilarity(normVec, normVec);

      expect(cosSelf).toBeCloseTo(1.0, 5);
      expect(Math.abs(cosSelf - 1.0)).toBeLessThan(1e-4);
    });

    it('empirical edge case: zero vector throws zero norm error', () => {
      const zeroVec = new Float32Array(512).fill(0);
      expect(() => ArcFaceRecognizer.l2Normalize(zeroVec)).toThrow('Zero norm encountered');
    });

    it('empirical edge case: near-zero vector underflow causes zero norm error', () => {
      const tinyVec = new Float32Array(512).fill(1e-25);
      // 512 * 1e-50 in float32 precision underflows to 0
      expect(() => ArcFaceRecognizer.l2Normalize(tinyVec)).toThrow('Zero norm encountered');
    });

    it('empirical edge case: cosine similarity mismatch vector lengths', () => {
      const vecA = new Float32Array(512).fill(0.1);
      const vecB = new Float32Array(256).fill(0.1);
      expect(() => ArcFaceRecognizer.cosineSimilarity(vecA, vecB)).toThrow('Vector length mismatch');
    });

    it('empirical edge case: orthogonal and opposite vectors cosine similarity', () => {
      const vecA = new Float32Array([1, 0, 0, 0]);
      const vecB = new Float32Array([0, 1, 0, 0]);
      const vecC = new Float32Array([-1, 0, 0, 0]);

      expect(ArcFaceRecognizer.cosineSimilarity(vecA, vecB)).toBeCloseTo(0.0, 5);
      expect(ArcFaceRecognizer.cosineSimilarity(vecA, vecC)).toBeCloseTo(-1.0, 5);
    });
  });

  describe('2. Bounding Box Expansion & Frame Boundary Clamping (MiniFASNetLiveness)', () => {
    const liveness = new MiniFASNetLiveness(null);
    const frameW = 640;
    const frameH = 480;

    it('empirical test: standard 1.5x bbox expansion centered on face', () => {
      const box: BoundingBox = [100, 100, 300, 300]; // 200x200 centered at (200, 200)
      const expanded = liveness.expandBoundingBox(box, frameW, frameH, 1.5);
      // 1.5x = 300x300 -> [50, 50, 350, 350]
      expect(expanded).toEqual([50, 50, 350, 350]);
    });

    it('empirical edge case: top-left frame boundary clamping', () => {
      const box: BoundingBox = [0, 0, 100, 100]; // centered at (50, 50), 1.5x = 150x150
      const expanded = liveness.expandBoundingBox(box, frameW, frameH, 1.5);
      // raw bounds [-25, -25, 125, 125] -> clamped [0, 0, 125, 125]
      expect(expanded[0]).toBe(0);
      expect(expanded[1]).toBe(0);
      expect(expanded[2]).toBe(125);
      expect(expanded[3]).toBe(125);
    });

    it('empirical edge case: bottom-right frame boundary clamping', () => {
      const box: BoundingBox = [580, 420, 640, 480]; // 60x60 centered at (610, 450), 1.5x = 90x90
      const expanded = liveness.expandBoundingBox(box, frameW, frameH, 1.5);
      // raw bounds [565, 405, 655, 495] -> clamped [565, 405, 640, 480]
      expect(expanded[0]).toBe(565);
      expect(expanded[1]).toBe(405);
      expect(expanded[2]).toBe(640);
      expect(expanded[3]).toBe(480);
    });

    it('empirical fix test: out-of-bounds bbox guarantees valid box (x1 < x2)', () => {
      const outOfBoundsBox: BoundingBox = [700, 700, 800, 800]; // off-screen
      const expanded = liveness.expandBoundingBox(outOfBoundsBox, frameW, frameH, 1.5);
      // Verified fix: expandBoundingBox guarantees newX1 < newX2 and newY1 < newY2
      expect(expanded[0]).toBeLessThan(expanded[2]);
      expect(expanded[1]).toBeLessThan(expanded[3]);
    });

    it('empirical edge case: zero-area bbox expansion', () => {
      const zeroBox: BoundingBox = [100, 100, 100, 100];
      const expanded = liveness.expandBoundingBox(zeroBox, frameW, frameH, 1.5);
      expect(expanded).toEqual([100, 100, 100, 100]);
    });
  });

  describe('3. Image Crop & Frame Buffer Preprocessing Edge Cases', () => {
    it('empirical edge case: cropAndPreprocess with inverted bbox (x1 > x2)', () => {
      const mockFrame: FrameData = {
        data: new Uint8Array(640 * 480 * 4).fill(128),
        width: 640,
        height: 480,
      };
      const recognizer = new ArcFaceRecognizer(null);
      const invertedBbox: BoundingBox = [300, 300, 100, 100];

      // cropW = Math.max(1, -200) = 1 -> does not crash, processes tensor
      const tensor = recognizer.cropAndPreprocess(mockFrame, invertedBbox);
      expect(tensor.length).toBe(1 * 3 * 112 * 112);
      expect(Number.isNaN(tensor[0])).toBe(false);
    });

    it('empirical fix test: 3-channel RGB buffer (instead of 4-channel RGBA) handles channels dynamically without NaN', () => {
      const width = 640;
      const height = 480;
      // 3 channels per pixel instead of 4
      const rgbFrame: FrameData = {
        data: new Uint8Array(width * height * 3).fill(200),
        width,
        height,
      };
      const recognizer = new ArcFaceRecognizer(null);
      const bbox: BoundingBox = [100, 100, 200, 200];

      const tensor = recognizer.cropAndPreprocess(rgbFrame, bbox);
      let hasNaN = false;
      for (let i = 0; i < tensor.length; i++) {
        if (Number.isNaN(tensor[i])) {
          hasNaN = true;
          break;
        }
      }
      expect(hasNaN).toBe(false);
    });

    it('empirical fix test: zero-width frame is safely handled without NaN', () => {
      const zeroFrame: FrameData = {
        data: new Uint8Array(0),
        width: 0,
        height: 0,
      };
      const recognizer = new ArcFaceRecognizer(null);
      const bbox: BoundingBox = [0, 0, 10, 10];

      const tensor = recognizer.cropAndPreprocess(zeroFrame, bbox);
      expect(Number.isNaN(tensor[0])).toBe(false);
    });
  });

  describe('4. Detection Logic & Single vs Multiple Faces (SCRFDDetector)', () => {
    it('empirical test: single face detected passes detection', async () => {
      const scoreData = new Float32Array(80 * 80 * 2).fill(0.0);
      scoreData[0] = 0.92;
      const bboxData = new Float32Array(80 * 80 * 2 * 4).fill(0.0);
      bboxData[0] = 1.0; bboxData[1] = 1.0; bboxData[2] = 5.0; bboxData[3] = 5.0;

      const mockSession = {
        inputNames: ['input.1'],
        outputNames: ['score_8', 'bbox_8', 'kps_8'],
        run: jest.fn().mockResolvedValue({
          score_8: { data: scoreData },
          bbox_8: { data: bboxData },
          kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
        }),
      };

      const detector = new SCRFDDetector(mockSession, 0.7, 0.4);
      const mockFrame: FrameData = {
        data: new Uint8Array(640 * 480 * 4).fill(128),
        width: 640,
        height: 480,
      };

      const result = await detector.detect(mockFrame);
      expect(result.success).toBe(true);
      expect(result.bbox).toBeDefined();
      expect(result.detScore).toBeCloseTo(0.92, 2);
    });

    it('empirical test: multiple distinct faces rejected with multiple_faces reason', async () => {
      const scoreData = new Float32Array(80 * 80 * 2).fill(0.0);
      scoreData[0] = 0.95; // Face 1 at anchor 0
      scoreData[100] = 0.88; // Face 2 at anchor 100 (far away, zero IoU)

      const bboxData = new Float32Array(80 * 80 * 2 * 4).fill(0.0);
      // Face 1 bbox
      bboxData[0] = 1.0; bboxData[1] = 1.0; bboxData[2] = 5.0; bboxData[3] = 5.0;
      // Face 2 bbox
      bboxData[400] = 1.0; bboxData[401] = 1.0; bboxData[402] = 5.0; bboxData[403] = 5.0;

      const mockSession = {
        inputNames: ['input.1'],
        outputNames: ['score_8', 'bbox_8', 'kps_8'],
        run: jest.fn().mockResolvedValue({
          score_8: { data: scoreData },
          bbox_8: { data: bboxData },
          kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
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
      expect(result.reason).toBe('multiple_faces');
    });

    it('empirical test: overlapping candidate boxes for SAME face suppressed by NMS', async () => {
      const scoreData = new Float32Array(80 * 80 * 2).fill(0.0);
      scoreData[0] = 0.95; // Candidate 1
      scoreData[1] = 0.85; // Candidate 2 (almost identical position -> high IoU)

      const bboxData = new Float32Array(80 * 80 * 2 * 4).fill(0.0);
      bboxData[0] = 1.0; bboxData[1] = 1.0; bboxData[2] = 5.0; bboxData[3] = 5.0;
      bboxData[4] = 1.0; bboxData[5] = 1.0; bboxData[6] = 5.0; bboxData[7] = 5.0;

      const mockSession = {
        inputNames: ['input.1'],
        outputNames: ['score_8', 'bbox_8', 'kps_8'],
        run: jest.fn().mockResolvedValue({
          score_8: { data: scoreData },
          bbox_8: { data: bboxData },
          kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
        }),
      };

      const detector = new SCRFDDetector(mockSession, 0.7, 0.4);
      const mockFrame: FrameData = {
        data: new Uint8Array(640 * 480 * 4).fill(128),
        width: 640,
        height: 480,
      };

      const result = await detector.detect(mockFrame);
      expect(result.success).toBe(true);
      expect(result.detScore).toBeCloseTo(0.95, 2);
    });

    it('empirical test: zero faces detected returns no_face_detected', async () => {
      const mockSession = {
        inputNames: ['input.1'],
        outputNames: ['score_8', 'bbox_8', 'kps_8'],
        run: jest.fn().mockResolvedValue({
          score_8: { data: new Float32Array(80 * 80 * 2).fill(0.1) }, // all below 0.7
          bbox_8: { data: new Float32Array(80 * 80 * 2 * 4).fill(0.0) },
          kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
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
});
