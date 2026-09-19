import { BoundingBox, FrameData, FacialLandmarks } from './types';
import { createOrtTensor } from './tensorUtils';

/**
 * ArcFace canonical 5-point facial landmark coordinates for 112x112 alignment.
 * These are the standard InsightFace arcface_dst coordinates:
 *   left_eye, right_eye, nose_tip, left_mouth_corner, right_mouth_corner
 */
const ARCFACE_DST: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export class ArcFaceRecognizer {
  private session: any;
  private readonly inputSize = 112;

  constructor(session: any) {
    this.session = session;
  }

  /**
   * Estimate 2x3 similarity transform matrix from source landmarks to ArcFace canonical landmarks.
   * Implements the Umeyama algorithm (same as skimage.transform.SimilarityTransform.estimate).
   */
  public static estimateSimilarityTransform(
    src: [number, number][],
    dst: [number, number][]
  ): [number, number, number, number, number, number] | null {
    const num = src.length;
    if (num < 2 || num !== dst.length) return null;

    // Compute means
    let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
    for (let i = 0; i < num; i++) {
      srcMeanX += src[i][0]; srcMeanY += src[i][1];
      dstMeanX += dst[i][0]; dstMeanY += dst[i][1];
    }
    srcMeanX /= num; srcMeanY /= num;
    dstMeanX /= num; dstMeanY /= num;

    // Compute A = (1/n) * dst_demean^T * src_demean
    let a00 = 0, a01 = 0, a10 = 0, a11 = 0;
    for (let i = 0; i < num; i++) {
      const sdx = src[i][0] - srcMeanX;
      const sdy = src[i][1] - srcMeanY;
      const ddx = dst[i][0] - dstMeanX;
      const ddy = dst[i][1] - dstMeanY;
      a00 += ddx * sdx; a01 += ddx * sdy;
      a10 += ddy * sdx; a11 += ddy * sdy;
    }
    a00 /= num; a01 /= num; a10 /= num; a11 /= num;

    // SVD of 2x2 matrix A using analytical formula
    // For 2x2: A = U * diag(S) * V^T
    const e = (a00 + a11) / 2;
    const f = (a00 - a11) / 2;
    const g = (a10 + a01) / 2;
    const h = (a10 - a01) / 2;

    const q = Math.sqrt(e * e + h * h);
    const r = Math.sqrt(f * f + g * g);

    const s1 = q + r;
    const s2 = q - r;

    const a1 = Math.atan2(g, f);
    const a2 = Math.atan2(h, e);

    const theta = (a2 - a1) / 2;
    const phi = (a2 + a1) / 2;

    // U and V
    const cosTheta = Math.cos(theta), sinTheta = Math.sin(theta);
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

    // d vector for sign handling
    const detA = a00 * a11 - a01 * a10;
    const d0 = 1;
    const d1 = detA < 0 ? -1 : 1;

    // Compute scale
    let srcVar = 0;
    for (let i = 0; i < num; i++) {
      const sdx = src[i][0] - srcMeanX;
      const sdy = src[i][1] - srcMeanY;
      srcVar += sdx * sdx + sdy * sdy;
    }
    srcVar /= num;
    if (srcVar < 1e-10) return null;

    const scale = (d0 * s1 + d1 * s2) / srcVar;

    // Compute rotation matrix R = U * diag(d) * V^T
    // U = [[cosPhi, -sinPhi], [sinPhi, cosPhi]]
    // V = [[cosTheta, -sinTheta], [sinTheta, cosTheta]]
    // R = U * diag(d) * V^T
    const u00 = cosPhi, u01 = -sinPhi, u10 = sinPhi, u11 = cosPhi;
    const v00 = cosTheta, v01 = sinTheta, v10 = -sinTheta, v11 = cosTheta;
    // diag(d) * V^T
    const dv00 = d0 * v00, dv01 = d0 * v01;
    const dv10 = d1 * v10, dv11 = d1 * v11;
    // R = U * (diag(d) * V^T)
    const r00 = u00 * dv00 + u01 * dv10;
    const r01 = u00 * dv01 + u01 * dv11;
    const r10 = u10 * dv00 + u11 * dv10;
    const r11 = u10 * dv01 + u11 * dv11;

    // M = scale * R, t = dstMean - M * srcMean
    const m00 = scale * r00;
    const m01 = scale * r01;
    const m10 = scale * r10;
    const m11 = scale * r11;
    const tx = dstMeanX - m00 * srcMeanX - m01 * srcMeanY;
    const ty = dstMeanY - m10 * srcMeanX - m11 * srcMeanY;

    // Return as [m00, m01, tx, m10, m11, ty]
    return [m00, m01, tx, m10, m11, ty];
  }

  /**
   * Warp-sample frame into aligned 112x112 using similarity transform matrix.
   * Returns BGR-ordered (1, 3, 112, 112) float32 NCHW tensor normalized by (pixel - 127.5) / 127.5.
   */
  public alignAndPreprocess(
    frame: FrameData,
    M: [number, number, number, number, number, number]
  ): Float32Array {
    const tensor = new Float32Array(1 * 3 * this.inputSize * this.inputSize);
    const planeSize = this.inputSize * this.inputSize;

    const numPixels = frame.width * frame.height;
    const channels = (numPixels > 0 && frame.data.length === numPixels * 3) ? 3 : 4;

    const [m00, m01, tx, m10, m11, ty] = M;

    // Compute inverse transform: M_inv = inverse of [[m00, m01, tx], [m10, m11, ty]]
    const det = m00 * m11 - m01 * m10;
    if (Math.abs(det) < 1e-10) {
      // Fallback to simple crop if transform is degenerate
      return this.cropAndPreprocess(frame, [0, 0, frame.width, frame.height]);
    }
    const invDet = 1.0 / det;
    const im00 = m11 * invDet;
    const im01 = -m01 * invDet;
    const im10 = -m10 * invDet;
    const im11 = m00 * invDet;
    const itx = -(im00 * tx + im01 * ty);
    const ity = -(im10 * tx + im11 * ty);

    for (let dy = 0; dy < this.inputSize; dy++) {
      for (let dx = 0; dx < this.inputSize; dx++) {
        // Inverse-map destination pixel to source pixel
        const sx = im00 * dx + im01 * dy + itx;
        const sy = im10 * dx + im11 * dy + ity;

        // Bilinear interpolation with nearest-neighbor fallback
        const sxi = Math.min(frame.width - 1, Math.max(0, Math.round(sx)));
        const syi = Math.min(frame.height - 1, Math.max(0, Math.round(sy)));
        const srcIdx = (syi * frame.width + sxi) * channels;

        // Input is RGB(A), ArcFace expects BGR channel order with (pixel - 127.5) / 127.5
        const r = ((frame.data[srcIdx] ?? 0) - 127.5) / 127.5;
        const g = ((frame.data[srcIdx + 1] ?? 0) - 127.5) / 127.5;
        const b = ((frame.data[srcIdx + 2] ?? 0) - 127.5) / 127.5;

        const spatialIdx = dy * this.inputSize + dx;
        tensor[spatialIdx] = b;                  // B channel (plane 0)
        tensor[planeSize + spatialIdx] = g;     // G channel (plane 1)
        tensor[planeSize * 2 + spatialIdx] = r; // R channel (plane 2)
      }
    }
    return tensor;
  }

  /**
   * Crop face bounding box and convert to (1, 3, 112, 112) float32 NCHW tensor
   * Normalization: (pixel - 127.5) / 127.5, BGR channel order
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

        // Input is RGB(A), ArcFace expects BGR channel order
        const r = ((frame.data[srcIdx] ?? 0) - 127.5) / 127.5;
        const g = ((frame.data[srcIdx + 1] ?? 0) - 127.5) / 127.5;
        const b = ((frame.data[srcIdx + 2] ?? 0) - 127.5) / 127.5;

        const spatialIdx = dy * this.inputSize + dx;
        tensor[spatialIdx] = b;                  // B channel (plane 0)
        tensor[planeSize + spatialIdx] = g;     // G channel (plane 1)
        tensor[planeSize * 2 + spatialIdx] = r; // R channel (plane 2)
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
   * Compute 512-dimensional face embedding vector using ArcFace ONNX model.
   * When 5-point facial landmarks are available, uses similarity transform alignment
   * (norm_crop) for much higher accuracy matching InsightFace backend enrollment.
   */
  public async getEmbedding(
    frame: FrameData,
    bbox: BoundingBox,
    landmarks?: FacialLandmarks
  ): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('ArcFaceRecognizer session not initialized');
    }

    let inputTensor: Float32Array;

    if (landmarks && landmarks.length === 5) {
      // Use 5-point landmark similarity transform alignment (matches InsightFace norm_crop)
      const srcPts: [number, number][] = landmarks.map(lm => [lm.x, lm.y]);
      const M = ArcFaceRecognizer.estimateSimilarityTransform(srcPts, ARCFACE_DST);
      if (M) {
        inputTensor = this.alignAndPreprocess(frame, M);
      } else {
        // Fallback to simple axis-aligned crop if transform estimation fails
        inputTensor = this.cropAndPreprocess(frame, bbox);
      }
    } else {
      // No landmarks available — use axis-aligned bounding box crop
      inputTensor = this.cropAndPreprocess(frame, bbox);
    }

    const inputName = this.session.inputNames ? this.session.inputNames[0] : 'data';

    const feeds: Record<string, any> = {};
    feeds[inputName] = createOrtTensor('float32', inputTensor, [1, 3, this.inputSize, this.inputSize]);

    const outputs = await this.session.run(feeds);
    const outputName = this.session.outputNames ? this.session.outputNames[0] : Object.keys(outputs)[0];
    const rawEmbedding: Float32Array = outputs[outputName].data;

    return ArcFaceRecognizer.l2Normalize(rawEmbedding);
  }
}
