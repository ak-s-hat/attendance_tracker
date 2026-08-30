import { BoundingBox, FrameData } from './types';

export class ArcFaceRecognizer {
  private session: any;
  private readonly inputSize = 112;

  constructor(session: any) {
    this.session = session;
  }

  /**
   * Crop face bounding box and convert to (1, 3, 112, 112) float32 NCHW tensor
   * Normalization: (pixel - 127.5) / 127.5
   */
  public cropAndPreprocess(frame: FrameData, bbox: BoundingBox): Float32Array {
    const [x1, y1, x2, y2] = bbox.map(Math.round);
    const cropW = Math.max(1, x2 - x1);
    const cropH = Math.max(1, y2 - y1);

    const tensor = new Float32Array(1 * 3 * this.inputSize * this.inputSize);
    const planeSize = this.inputSize * this.inputSize;

    const numPixels = frame.width * frame.height;
    const channels = (numPixels > 0 && frame.data.length === numPixels * 3) ? 3 : 4;

    for (let dy = 0; dy < this.inputSize; dy++) {
      for (let dx = 0; dx < this.inputSize; dx++) {
        const sx = Math.min(frame.width - 1, Math.max(0, x1 + Math.floor((dx / this.inputSize) * cropW)));
        const sy = Math.min(frame.height - 1, Math.max(0, y1 + Math.floor((dy / this.inputSize) * cropH)));
        const srcIdx = (sy * frame.width + sx) * channels;

        const r = ((frame.data[srcIdx] ?? 0) - 127.5) / 127.5;
        const g = ((frame.data[srcIdx + 1] ?? 0) - 127.5) / 127.5;
        const b = ((frame.data[srcIdx + 2] ?? 0) - 127.5) / 127.5;

        const spatialIdx = dy * this.inputSize + dx;
        tensor[spatialIdx] = r;
        tensor[planeSize + spatialIdx] = g;
        tensor[planeSize * 2 + spatialIdx] = b;
      }
    }
    return tensor;
  }

  /**
   * L2-Normalize vector: e = v / ||v||_2
   */
  public static l2Normalize(vector: Float32Array): Float32Array {
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0 || !isFinite(norm) || norm < 1e-12) {
      throw new Error('Zero norm encountered during ArcFace embedding normalization');
    }
    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / norm;
    }
    return normalized;
  }

  /**
   * Calculate Cosine Similarity between two L2-normalized vectors
   */
  public static cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length !== vecB.length) {
      throw new Error(`Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
    }
    let dot = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
    }
    return dot;
  }

  /**
   * Compute 512-dimensional face embedding vector using ArcFace ONNX model
   */
  public async getEmbedding(frame: FrameData, bbox: BoundingBox): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('ArcFaceRecognizer session not initialized');
    }

    const inputTensor = this.cropAndPreprocess(frame, bbox);
    const inputName = this.session.inputNames ? this.session.inputNames[0] : 'data';

    const feeds: Record<string, any> = {};
    feeds[inputName] = {
      data: inputTensor,
      dims: [1, 3, this.inputSize, this.inputSize],
      type: 'float32',
    };

    const outputs = await this.session.run(feeds);
    const outputName = this.session.outputNames ? this.session.outputNames[0] : Object.keys(outputs)[0];
    const rawEmbedding: Float32Array = outputs[outputName].data;

    return ArcFaceRecognizer.l2Normalize(rawEmbedding);
  }
}
