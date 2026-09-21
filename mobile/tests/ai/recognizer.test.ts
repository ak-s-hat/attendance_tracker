import { ArcFaceRecognizer } from '../../src/ai/recognizer';
import { FrameData, BoundingBox } from '../../src/ai/types';

describe('ArcFaceRecognizer Unit Tests', () => {
  it('should L2-normalize vectors to unit length (norm == 1.0)', () => {
    const raw = new Float32Array(512);
    for (let i = 0; i < 512; i++) raw[i] = Math.sin(i + 1);

    const normVec = ArcFaceRecognizer.l2Normalize(raw);
    let sumSq = 0;
    for (let i = 0; i < 512; i++) sumSq += normVec[i] * normVec[i];

    expect(Math.sqrt(sumSq)).toBeCloseTo(1.0, 5);
  });

  it('should throw an error when attempting to L2-normalize a zero vector', () => {
    const zeroVec = new Float32Array(512);
    expect(() => ArcFaceRecognizer.l2Normalize(zeroVec)).toThrow('Zero norm');
  });

  it('should calculate correct cosine similarity values', () => {
    const vecA = Float32Array.from([1, 0, 0]);
    const vecB = Float32Array.from([1, 0, 0]);
    const vecC = Float32Array.from([0, 1, 0]);
    const vecD = Float32Array.from([-1, 0, 0]);

    expect(ArcFaceRecognizer.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
    expect(ArcFaceRecognizer.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 5);
    expect(ArcFaceRecognizer.cosineSimilarity(vecA, vecD)).toBeCloseTo(-1.0, 5);
  });

  it('should throw an error on vector length mismatch during cosine similarity', () => {
    const vecA = Float32Array.from([1, 0]);
    const vecB = Float32Array.from([1, 0, 0]);

    expect(() => ArcFaceRecognizer.cosineSimilarity(vecA, vecB)).toThrow('Vector length mismatch');
  });

  it('should crop and preprocess image frame to 112x112 NCHW tensor', () => {
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(128),
      width: 640,
      height: 480,
    };
    const bbox: BoundingBox = [100, 100, 200, 200];
    const recognizer = new ArcFaceRecognizer(null);

    const tensor = recognizer.cropAndPreprocess(mockFrame, bbox);
    expect(tensor.length).toBe(1 * 3 * 112 * 112);

    // Pixel (128 - 127.5) / 127.5 = 0.5 / 127.5 ≈ 0.00392
    expect(tensor[0]).toBeCloseTo(0.00392, 4);
  });

  it('should execute getEmbedding using ONNX session mock', async () => {
    const mockEmbeddingData = new Float32Array(512);
    for (let i = 0; i < 512; i++) mockEmbeddingData[i] = i + 1;

    const mockSession = {
      inputNames: ['data'],
      outputNames: ['embedding'],
      run: jest.fn().mockResolvedValue({
        embedding: { data: mockEmbeddingData },
      }),
    };

    const recognizer = new ArcFaceRecognizer(mockSession);
    const mockFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 4).fill(200),
      width: 640,
      height: 480,
    };
    const bbox: BoundingBox = [50, 50, 250, 250];

    const result = await recognizer.getEmbedding(mockFrame, bbox);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(512);

    // Check normalization
    let sumSq = 0;
    for (let i = 0; i < 512; i++) sumSq += result[i] * result[i];
    expect(Math.sqrt(sumSq)).toBeCloseTo(1.0, 5);

    expect(mockSession.run).toHaveBeenCalledTimes(1);
  });

  it('should accurately compute 2D Umeyama similarity transform matrix for rotated face landmarks', () => {
    // Canonical ArcFace 112x112 target landmarks
    const dstLandmarks: [number, number][] = [
      [38.2946, 51.6963],
      [73.5318, 51.5014],
      [56.0252, 71.7366],
      [41.5493, 92.3655],
      [70.7299, 92.2041],
    ];

    // Create rotated (15 deg) and scaled (1.2x) source landmarks
    const angle = (15 * Math.PI) / 180;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const scale = 1.2;
    const tx = 25;
    const ty = 35;

    const srcLandmarks: [number, number][] = dstLandmarks.map(([x, y]) => {
      // Inverse rotation to simulate detected face landmarks
      const rx = (x * cosA - y * sinA) * scale + tx;
      const ry = (x * sinA + y * cosA) * scale + ty;
      return [rx, ry];
    });

    const M = ArcFaceRecognizer.estimateSimilarityTransform(srcLandmarks, dstLandmarks);
    expect(M).not.toBeNull();
    if (!M) return;

    const [m00, m01, mTx, m10, m11, mTy] = M;

    // Verify rotation matrix det > 0
    const detR = m00 * m11 - m01 * m10;
    expect(detR).toBeGreaterThan(0);

    // Verify mapping of transformed landmarks closely matches destination landmarks
    for (let i = 0; i < srcLandmarks.length; i++) {
      const [sx, sy] = srcLandmarks[i];
      const mappedX = m00 * sx + m01 * sy + mTx;
      const mappedY = m10 * sx + m11 * sy + mTy;
      expect(mappedX).toBeCloseTo(dstLandmarks[i][0], 1);
      expect(mappedY).toBeCloseTo(dstLandmarks[i][1], 1);
    }
  });

  it('should maintain RGB channel order in cropAndPreprocess and alignAndPreprocess', () => {
    const recognizer = new ArcFaceRecognizer(null);
    const width = 112;
    const height = 112;
    const data = new Uint8Array(width * height * 4);

    // Fill image with pure RED: R=255, G=0, B=0, A=255
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 255;     // R
      data[i * 4 + 1] = 0;   // G
      data[i * 4 + 2] = 0;   // B
      data[i * 4 + 3] = 255; // A
    }

    const frame: FrameData = { data, width, height };
    const planeSize = 112 * 112;

    // Test cropAndPreprocess
    const cropTensor = recognizer.cropAndPreprocess(frame, [0, 0, 112, 112]);
    // Plane 0 (R) should be (255 - 127.5)/127.5 = 1.0
    expect(cropTensor[0]).toBeCloseTo(1.0, 4);
    // Plane 1 (G) should be (0 - 127.5)/127.5 = -1.0
    expect(cropTensor[planeSize]).toBeCloseTo(-1.0, 4);
    // Plane 2 (B) should be (0 - 127.5)/127.5 = -1.0
    expect(cropTensor[planeSize * 2]).toBeCloseTo(-1.0, 4);

    // Test alignAndPreprocess with identity transform
    const alignTensor = recognizer.alignAndPreprocess(frame, [1, 0, 0, 0, 1, 0]);
    expect(alignTensor[0]).toBeCloseTo(1.0, 4);
    expect(alignTensor[planeSize]).toBeCloseTo(-1.0, 4);
    expect(alignTensor[planeSize * 2]).toBeCloseTo(-1.0, 4);
  });
});

