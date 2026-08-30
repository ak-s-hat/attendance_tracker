import { EdgeAIPipeline } from '../../src/ai/pipeline';
import { FrameData } from '../../src/ai/types';
import * as apiModule from '../../src/services/api';

jest.mock('../../src/services/api');

describe('EdgeAIPipeline Unit Tests', () => {
  let mockDetSession: any;
  let mockRecSession: any;
  let mockLiveSession: any;
  const mockFrame: FrameData = {
    data: new Uint8Array(640 * 480 * 4).fill(128),
    width: 640,
    height: 480,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDetSession = {
      inputNames: ['input.1'],
      outputNames: ['score_8', 'bbox_8', 'kps_8'],
      run: jest.fn(),
    };

    mockRecSession = {
      inputNames: ['data'],
      outputNames: ['embedding'],
      run: jest.fn().mockResolvedValue({
        embedding: { data: new Float32Array(512).fill(0.1) },
      }),
    };

    mockLiveSession = {
      inputNames: ['input'],
      outputNames: ['logits'],
      run: jest.fn().mockResolvedValue({
        logits: { data: new Float32Array([0.0, 3.0]) }, // Real face
      }),
    };
  });

  it('should throw error if processFrame is called prior to initialization', async () => {
    const pipeline = new EdgeAIPipeline();
    await expect(pipeline.processFrame(mockFrame)).rejects.toThrow('EdgeAIPipeline not initialized');
  });

  it('should return no_face_detected if face detector finds no candidates', async () => {
    mockDetSession.run.mockResolvedValue({
      score_8: { data: new Float32Array(100).fill(0.0) },
      bbox_8: { data: new Float32Array(400).fill(0.0) },
      kps_8: { data: new Float32Array(1000).fill(0.0) },
    });

    const pipeline = new EdgeAIPipeline();
    pipeline.initialize(mockDetSession, mockRecSession, mockLiveSession);

    const result = await pipeline.processFrame(mockFrame);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_face_detected');
  });

  it('should return spoof_detected if liveness check fails', async () => {
    // Single high confidence face detection
    const scoreData = new Float32Array(80 * 80 * 2).fill(0.0);
    scoreData[0] = 0.95; // High detection score
    const bboxData = new Float32Array(80 * 80 * 2 * 4).fill(0.0);
    bboxData[0] = 1.0; bboxData[1] = 1.0; bboxData[2] = 5.0; bboxData[3] = 5.0;

    mockDetSession.run.mockResolvedValue({
      score_8: { data: scoreData },
      bbox_8: { data: bboxData },
      kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
    });

    // Mock spoof liveness output
    mockLiveSession.run.mockResolvedValue({
      logits: { data: new Float32Array([5.0, 0.0]) }, // Spoof logits
    });

    const pipeline = new EdgeAIPipeline();
    pipeline.initialize(mockDetSession, mockRecSession, mockLiveSession);

    const result = await pipeline.processFrame(mockFrame);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('spoof_detected');
  });

  it('should successfully complete pipeline and send embedding to API', async () => {
    // Single high confidence face detection
    const scoreData = new Float32Array(80 * 80 * 2).fill(0.0);
    scoreData[0] = 0.95;
    const bboxData = new Float32Array(80 * 80 * 2 * 4).fill(0.0);
    bboxData[0] = 1.0; bboxData[1] = 1.0; bboxData[2] = 5.0; bboxData[3] = 5.0;

    mockDetSession.run.mockResolvedValue({
      score_8: { data: scoreData },
      bbox_8: { data: bboxData },
      kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
    });

    (apiModule.postEmbeddingCheckin as jest.Mock).mockResolvedValue({
      success: true,
      employee_id: 'emp_123',
      employee_name: 'John Doe',
      confidence: 0.92,
      check_type: 'AUTO',
    });

    const pipeline = new EdgeAIPipeline('http://localhost:8000');
    pipeline.initialize(mockDetSession, mockRecSession, mockLiveSession);

    const result = await pipeline.processFrame(mockFrame);

    expect(result.success).toBe(true);
    expect(result.employee_name).toBe('John Doe');
    expect(result.employee_id).toBe('emp_123');
    expect(result.embedding?.length).toBe(512);
    expect(apiModule.postEmbeddingCheckin).toHaveBeenCalledTimes(1);
  });
});
