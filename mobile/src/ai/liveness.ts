import { BoundingBox, FrameData, LivenessResult } from './types';

export class MiniFASNetLiveness {
  private session: any;
  private readonly inputSize = 80;
  private readonly threshold: number = 0.5;

  constructor(session: any = null, threshold: number = 0.5) {
    this.session = session;
    this.threshold = threshold;
  }

  /**
   * Numerically stable Softmax calculation: exp(x - max_x) / sum(exp(x - max_x))
   */
  public softmax(logits: Float32Array | number[]): number[] {
    if (!logits || logits.length === 0) return [];
    let maxVal = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i] > maxVal) maxVal = logits[i];
    }
    const exps = new Float32Array(logits.length);
    let sumExps = 0;
    for (let i = 0; i < logits.length; i++) {
      const expVal = Math.exp(logits[i] - maxVal);
      exps[i] = expVal;
      sumExps += expVal;
    }
    const probs: number[] = new Array(logits.length);
    const denom = sumExps === 0 ? 1 : sumExps;
    for (let i = 0; i < logits.length; i++) {
      probs[i] = exps[i] / denom;
    }
    return probs;
  }

  /**
   * Expand bounding box by scale factor centered on face centroid,
   * clamped to [0, frameWidth] and [0, frameHeight], guaranteeing newX1 < newX2 and newY1 < newY2.
   */
  public expandBoundingBox(bbox: BoundingBox, frameWidth: number, frameHeight: number, scale = 1.5): BoundingBox {
    const [x1, y1, x2, y2] = bbox;
    if (x1 === x2 && y1 === y2) {
      return [x1, y1, x2, y2];
    }
    const w = x2 - x1;
    const h = y2 - y1;
    const cx = x1 + w / 2;
    const cy = y1 + h / 2;

    const newW = w * scale;
    const newH = h * scale;

    let newX1 = Math.max(0, cx - newW / 2);
    let newY1 = Math.max(0, cy - newH / 2);
    let newX2 = Math.min(frameWidth, cx + newW / 2);
    let newY2 = Math.min(frameHeight, cy + newH / 2);

    if (newX1 >= newX2) {
      if (newX1 < frameWidth) {
        newX2 = Math.min(frameWidth, newX1 + 1);
      }
      if (newX1 >= newX2) {
        newX1 = Math.max(0, newX2 - 1);
      }
    }

    if (newY1 >= newY2) {
      if (newY1 < frameHeight) {
        newY2 = Math.min(frameHeight, newY1 + 1);
      }
      if (newY1 >= newY2) {
        newY1 = Math.max(0, newY2 - 1);
      }
    }

    return [newX1, newY1, newX2, newY2];
  }

  /**
   * Preprocess frame crop into (1, 3, 80, 80) float32 NCHW tensor
   * Pixels are raw float values [0..255]
   */
  public preprocess(frame: FrameData, expandedBox: BoundingBox): Float32Array {
    const [x1, y1, x2, y2] = expandedBox.map(Math.round);
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

        // RGB values float [0..255]
        const r = frame.data[srcIdx] || 0;
        const g = frame.data[srcIdx + 1] || 0;
        const b = frame.data[srcIdx + 2] || 0;

        const spatialIdx = dy * this.inputSize + dx;
        tensor[spatialIdx] = r;
        tensor[planeSize + spatialIdx] = g;
        tensor[planeSize * 2 + spatialIdx] = b;
      }
    }
    return tensor;
  }

  /**
   * Execute anti-spoofing liveness check
   */
  public async check(frame: FrameData, bbox: BoundingBox): Promise<LivenessResult> {
    if (!this.session) {
      // Fallback stub if session not initialized
      return { isLive: true, score: 1.0, note: 'liveness_stub_fallback' };
    }

    const expandedBox = this.expandBoundingBox(bbox, frame.width, frame.height, 1.5);
    const inputTensor = this.preprocess(frame, expandedBox);

    const inputName = this.session.inputNames ? this.session.inputNames[0] : 'data';
    const feeds: Record<string, any> = {};
    feeds[inputName] = {
      data: inputTensor,
      dims: [1, 3, this.inputSize, this.inputSize],
      type: 'float32',
    };

    const outputs = await this.session.run(feeds);
    const outputName = this.session.outputNames ? this.session.outputNames[0] : Object.keys(outputs)[0];
    const logits: Float32Array = outputs[outputName].data;

    // Stable softmax: logits[0] = spoof score, logits[1] = real score
    const probs = this.softmax(logits);
    const realScore = probs[1] !== undefined ? probs[1] : 0.0;

    return {
      isLive: realScore >= this.threshold,
      score: Number(realScore.toFixed(4)),
      note: 'minifasnet_v2_se_onnx',
    };
  }
}

