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
});
