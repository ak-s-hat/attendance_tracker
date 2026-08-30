import { BoundingBox, DetectionResult, FacialLandmarks, FrameData, Point2D } from './types';

export class SCRFDDetector {
  private session: any = null;
  private readonly inputWidth = 640;
  private readonly inputHeight = 640;
  private readonly detThreshold: number = 0.7;
  private readonly nmsThreshold: number = 0.4;
  private readonly strides = [8, 16, 32];
  private readonly numAnchors = 2;

  constructor(session: any, detThreshold: number = 0.7, nmsThreshold: number = 0.4) {
    this.session = session;
    this.detThreshold = detThreshold;
    this.nmsThreshold = nmsThreshold;
  }

  public hasSession(): boolean {
    return this.session !== null && this.session !== undefined;
  }

  /**
   * Preprocess camera frame into (1, 3, 640, 640) float32 NCHW tensor
   * Normalization: (pixel - 127.5) / 128.0
   */
  public preprocess(frame: FrameData): Float32Array {
    const { data, width, height } = frame;
    const inputTensor = new Float32Array(1 * 3 * this.inputHeight * this.inputWidth);
    const planeSize = this.inputWidth * this.inputHeight;

    const scaleX = width / this.inputWidth;
    const scaleY = height / this.inputHeight;

    const numPixels = width * height;
    const channels = (numPixels > 0 && data.length === numPixels * 3) ? 3 : 4;

    for (let y = 0; y < this.inputHeight; y++) {
      for (let x = 0; x < this.inputWidth; x++) {
        const srcX = Math.min(width - 1, Math.max(0, Math.floor(x * scaleX)));
        const srcY = Math.min(height - 1, Math.max(0, Math.floor(y * scaleY)));
        const srcIdx = (srcY * width + srcX) * channels;

        const r = ((data[srcIdx] ?? 0) - 127.5) / 128.0;
        const g = ((data[srcIdx + 1] ?? 0) - 127.5) / 128.0;
        const b = ((data[srcIdx + 2] ?? 0) - 127.5) / 128.0;

        const spatialIdx = y * this.inputWidth + x;
        inputTensor[spatialIdx] = r;                  // R channel
        inputTensor[planeSize + spatialIdx] = g;     // G channel
        inputTensor[planeSize * 2 + spatialIdx] = b; // B channel
      }
    }
    return inputTensor;
  }

  /**
   * Run Non-Maximum Suppression (NMS) over candidate bounding boxes
   */
  public nms(boxes: BoundingBox[], scores: number[], iouThreshold: number): number[] {
    const indices = scores
      .map((score, idx) => ({ score, idx }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.idx);

    const keep: number[] = [];
    const suppressed = new Set<number>();

    for (let i = 0; i < indices.length; i++) {
      const current = indices[i];
      if (suppressed.has(current)) continue;

      keep.push(current);
      const boxA = boxes[current];

      for (let j = i + 1; j < indices.length; j++) {
        const next = indices[j];
        if (suppressed.has(next)) continue;

        const boxB = boxes[next];
        const iou = this.computeIoU(boxA, boxB);
        if (iou >= iouThreshold) {
          suppressed.add(next);
        }
      }
    }
    return keep;
  }

  public computeIoU(boxA: BoundingBox, boxB: BoundingBox): number {
    const xA = Math.max(boxA[0], boxB[0]);
    const yA = Math.max(boxA[1], boxB[1]);
    const xB = Math.min(boxA[2], boxB[2]);
    const yB = Math.min(boxA[3], boxB[3]);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
    const boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);

    const unionArea = boxAArea + boxBArea - interArea;
    return unionArea > 0 ? interArea / unionArea : 0;
  }

  /**
   * Main detection execution
   */
  public async detect(frame: FrameData): Promise<DetectionResult> {
    if (!this.session) {
      throw new Error('SCRFDDetector session not initialized');
    }

    const inputTensor = this.preprocess(frame);
    const inputName = this.session.inputNames ? this.session.inputNames[0] : 'input.1';

    const feeds: Record<string, any> = {};
    feeds[inputName] = {
      data: inputTensor,
      dims: [1, 3, this.inputHeight, this.inputWidth],
      type: 'float32',
    };

    const outputs = await this.session.run(feeds);
    
    // Decode outputs
    const candidates = this.decodeOutputs(outputs);

    // Apply detThreshold filter
    const filteredBoxes: BoundingBox[] = [];
    const filteredScores: number[] = [];
    const filteredLandmarks: FacialLandmarks[] = [];

    for (let i = 0; i < candidates.scores.length; i++) {
      if (candidates.scores[i] >= this.detThreshold) {
        filteredBoxes.push(candidates.boxes[i]);
        filteredScores.push(candidates.scores[i]);
        if (candidates.landmarks[i]) {
          filteredLandmarks.push(candidates.landmarks[i]);
        }
      }
    }

    const keepIndices = this.nms(filteredBoxes, filteredScores, this.nmsThreshold);

    if (keepIndices.length === 0) {
      return { success: false, reason: 'no_face_detected' };
    }

    if (keepIndices.length > 1) {
      return { success: false, reason: 'multiple_faces' };
    }

    const bestIdx = keepIndices[0];
    const scaleX = frame.width / this.inputWidth;
    const scaleY = frame.height / this.inputHeight;

    const rawBox = filteredBoxes[bestIdx];
    const scaledBox: BoundingBox = [
      rawBox[0] * scaleX,
      rawBox[1] * scaleY,
      rawBox[2] * scaleX,
      rawBox[3] * scaleY,
    ];

    let scaledLandmarks: FacialLandmarks | undefined;
    if (filteredLandmarks[bestIdx]) {
      const lm = filteredLandmarks[bestIdx];
      scaledLandmarks = [
        { x: lm[0].x * scaleX, y: lm[0].y * scaleY },
        { x: lm[1].x * scaleX, y: lm[1].y * scaleY },
        { x: lm[2].x * scaleX, y: lm[2].y * scaleY },
        { x: lm[3].x * scaleX, y: lm[3].y * scaleY },
        { x: lm[4].x * scaleX, y: lm[4].y * scaleY },
      ];
    }

    return {
      success: true,
      bbox: scaledBox,
      detScore: filteredScores[bestIdx],
      landmarks: scaledLandmarks,
    };
  }

  /**
   * Helper to decode ONNX model outputs into boxes, scores, and landmarks
   */
  private decodeOutputs(outputs: Record<string, any>): {
    boxes: BoundingBox[];
    scores: number[];
    landmarks: FacialLandmarks[];
  } {
    const candidateBoxes: BoundingBox[] = [];
    const candidateScores: number[] = [];
    const candidateLandmarks: FacialLandmarks[] = [];

    const keys = Object.keys(outputs);
    
    for (const stride of this.strides) {
      const featH = Math.floor(this.inputHeight / stride);
      const featW = Math.floor(this.inputWidth / stride);
      const numAnchorsPerCell = this.numAnchors;

      let scoreTensor: any = null;
      let bboxTensor: any = null;
      let kpsTensor: any = null;

      for (const k of keys) {
        if (k.includes(`_${stride}`) || k.includes(`stride_${stride}`)) {
          if (k.includes('score') || k.includes('cls')) scoreTensor = outputs[k];
          else if (k.includes('bbox') || k.includes('box') || k.includes('reg')) bboxTensor = outputs[k];
          else if (k.includes('kps') || k.includes('pts') || k.includes('landmark')) kpsTensor = outputs[k];
        }
      }

      if (!scoreTensor && keys.length >= 9) {
        const strideIdx = this.strides.indexOf(stride);
        scoreTensor = outputs[keys[strideIdx * 3]];
        bboxTensor = outputs[keys[strideIdx * 3 + 1]];
        kpsTensor = outputs[keys[strideIdx * 3 + 2]];
      }

      if (!scoreTensor || !bboxTensor) continue;

      const scoresData = scoreTensor.data as Float32Array;
      const bboxData = bboxTensor.data as Float32Array;
      const kpsData = kpsTensor ? (kpsTensor.data as Float32Array) : null;

      let idx = 0;
      for (let y = 0; y < featH; y++) {
        for (let x = 0; x < featW; x++) {
          for (let a = 0; a < numAnchorsPerCell; a++) {
            const score = scoresData[idx];
            
            if (score >= this.detThreshold) {
              const anchorCx = (x + 0.5) * stride;
              const anchorCy = (y + 0.5) * stride;

              const dx1 = bboxData[idx * 4] * stride;
              const dy1 = bboxData[idx * 4 + 1] * stride;
              const dx2 = bboxData[idx * 4 + 2] * stride;
              const dy2 = bboxData[idx * 4 + 3] * stride;

              const x1 = anchorCx - dx1;
              const y1 = anchorCy - dy1;
              const x2 = anchorCx + dx2;
              const y2 = anchorCy + dy2;

              candidateBoxes.push([x1, y1, x2, y2]);
              candidateScores.push(score);

              if (kpsData) {
                const lm: Point2D[] = [];
                for (let k = 0; k < 5; k++) {
                  const lx = anchorCx + kpsData[idx * 10 + k * 2] * stride;
                  const ly = anchorCy + kpsData[idx * 10 + k * 2 + 1] * stride;
                  lm.push({ x: lx, y: ly });
                }
                candidateLandmarks.push(lm as FacialLandmarks);
              }
            }

            idx++;
          }
        }
      }
    }

    return {
      boxes: candidateBoxes,
      scores: candidateScores,
      landmarks: candidateLandmarks,
    };
  }
}
