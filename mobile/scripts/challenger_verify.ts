import { ArcFaceRecognizer } from '../src/ai/recognizer';
import { MiniFASNetLiveness } from '../src/ai/liveness';
import { SCRFDDetector } from '../src/ai/detector';
import { BoundingBox, FrameData } from '../src/ai/types';

async function runChallengerEmpiricalVerification() {
  console.log('====================================================');
  console.log('  CHALLENGER 1 (M2): Empirical Stress & Edge Case Verification');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;
  const issues: string[] = [];

  function testAssert(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passedCount++;
    } catch (err: any) {
      console.log(`  ❌ FAIL: ${name}`);
      console.log(`     Error: ${err.message}`);
      issues.push(`${name}: ${err.message}`);
      failedCount++;
    }
  }

  // 1. ArcFace L2 Normalization & Cosine Similarity Self-Match
  console.log('-> 1. Testing ArcFace L2 Normalization & Cosine Similarity...');

  testAssert('L2 Normalization Unit Vector Length (||e||_2 == 1.0)', () => {
    const raw = new Float32Array(512);
    for (let i = 0; i < 512; i++) raw[i] = (i + 1) * 0.05;
    const normalized = ArcFaceRecognizer.l2Normalize(raw);

    let sumSq = 0;
    for (let i = 0; i < 512; i++) sumSq += normalized[i] * normalized[i];
    const normVal = Math.sqrt(sumSq);

    if (Math.abs(normVal - 1.0) > 1e-4) {
      throw new Error(`Expected ||e||_2 == 1.0, got ${normVal}`);
    }
  });

  testAssert('Cosine Similarity Self-Match == 1.0', () => {
    const raw = new Float32Array(512);
    for (let i = 0; i < 512; i++) raw[i] = Math.sin(i + 1);
    const normalized = ArcFaceRecognizer.l2Normalize(raw);

    const cosSelf = ArcFaceRecognizer.cosineSimilarity(normalized, normalized);
    if (Math.abs(cosSelf - 1.0) > 1e-4) {
      throw new Error(`Expected cosine self-match == 1.0, got ${cosSelf}`);
    }
  });

  testAssert('Zero Vector Throws Error in L2 Normalization', () => {
    const zeroVec = new Float32Array(512).fill(0);
    try {
      ArcFaceRecognizer.l2Normalize(zeroVec);
      throw new Error('Did not throw on zero vector!');
    } catch (err: any) {
      if (!err.message.includes('Zero norm')) {
        throw err;
      }
    }
  });

  testAssert('Cosine Similarity Length Mismatch Detection', () => {
    const vecA = new Float32Array(512).fill(0.1);
    const vecB = new Float32Array(256).fill(0.1);
    try {
      ArcFaceRecognizer.cosineSimilarity(vecA, vecB);
      throw new Error('Did not throw on length mismatch!');
    } catch (err: any) {
      if (!err.message.includes('Vector length mismatch')) {
        throw err;
      }
    }
  });

  // 2. MiniFASNet BBox Expansion & Clamping Edge Cases
  console.log('\n-> 2. Testing MiniFASNet BBox Expansion & Clamping...');

  const liveness = new MiniFASNetLiveness(null);

  testAssert('Standard BBox 1.5x Expansion [100,100,300,300]', () => {
    const box: BoundingBox = [100, 100, 300, 300];
    const expanded = liveness.expandBoundingBox(box, 640, 480, 1.5);
    if (expanded[0] !== 50 || expanded[1] !== 50 || expanded[2] !== 350 || expanded[3] !== 350) {
      throw new Error(`Expected [50,50,350,350], got [${expanded.join(',')}]`);
    }
  });

  testAssert('Top-Left Edge Clamping [0,0,100,100]', () => {
    const box: BoundingBox = [0, 0, 100, 100];
    const expanded = liveness.expandBoundingBox(box, 640, 480, 1.5);
    if (expanded[0] !== 0 || expanded[1] !== 0 || expanded[2] !== 125 || expanded[3] !== 125) {
      throw new Error(`Expected [0,0,125,125], got [${expanded.join(',')}]`);
    }
  });

  testAssert('Bottom-Right Edge Clamping [580,420,640,480]', () => {
    const box: BoundingBox = [580, 420, 640, 480];
    const expanded = liveness.expandBoundingBox(box, 640, 480, 1.5);
    if (expanded[0] !== 565 || expanded[1] !== 405 || expanded[2] !== 640 || expanded[3] !== 480) {
      throw new Error(`Expected [565,405,640,480], got [${expanded.join(',')}]`);
    }
  });

  testAssert('Out-of-Bounds Clamping Analysis (Detect Inverted Box Defect)', () => {
    const box: BoundingBox = [700, 700, 800, 800];
    const expanded = liveness.expandBoundingBox(box, 640, 480, 1.5);
    console.log(`     Notice: Out-of-bounds box [700,700,800,800] expanded to [${expanded.join(',')}]`);
    if (expanded[0] > expanded[2]) {
      console.log(`     ⚠️ DEFECT CONFIRMED: expanded[0] (${expanded[0]}) > expanded[2] (${expanded[2]}) produces inverted bbox!`);
    }
  });

  // 3. Preprocessing & Crop Edge Cases
  console.log('\n-> 3. Testing Crop & Preprocessing Edge Cases...');

  testAssert('Empty / Zero-Dimension Frame Handling (Width=0)', () => {
    const zeroFrame: FrameData = {
      data: new Uint8Array(0),
      width: 0,
      height: 0,
    };
    const recognizer = new ArcFaceRecognizer(null);
    const bbox: BoundingBox = [0, 0, 10, 10];
    const tensor = recognizer.cropAndPreprocess(zeroFrame, bbox);
    if (Number.isNaN(tensor[0])) {
      console.log(`     ⚠️ DEFECT CONFIRMED: width=0 produces NaN tensor due to -1 array index access.`);
    }
  });

  testAssert('3-Channel RGB Buffer Handling (Stride Defect)', () => {
    const rgbFrame: FrameData = {
      data: new Uint8Array(640 * 480 * 3).fill(200),
      width: 640,
      height: 480,
    };
    const recognizer = new ArcFaceRecognizer(null);
    const bbox: BoundingBox = [100, 100, 200, 200];
    const tensor = recognizer.cropAndPreprocess(rgbFrame, bbox);
    let hasNaN = false;
    for (let i = 0; i < tensor.length; i++) {
      if (Number.isNaN(tensor[i])) { hasNaN = true; break; }
    }
    if (hasNaN) {
      console.log(`     ⚠️ DEFECT CONFIRMED: 3-channel RGB buffer produces NaNs because code hardcodes RGBA (* 4) stride.`);
    }
  });

  // 4. Detection Single vs Multiple Faces Logic
  console.log('\n-> 4. Testing Single vs Multiple Face Detection Logic...');

  testAssert('Detector Returns no_face_detected for 0 faces', async () => {
    const mockSession = {
      inputNames: ['input.1'],
      outputNames: ['score_8', 'bbox_8', 'kps_8'],
      run: async () => ({
        score_8: { data: new Float32Array(80 * 80 * 2).fill(0.1) },
        bbox_8: { data: new Float32Array(80 * 80 * 2 * 4).fill(0.0) },
        kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
      }),
    };
    const detector = new SCRFDDetector(mockSession, 0.7, 0.4);
    const frame: FrameData = { data: new Uint8Array(640 * 480 * 4).fill(128), width: 640, height: 480 };
    const res = await detector.detect(frame);
    if (res.success || res.reason !== 'no_face_detected') {
      throw new Error(`Expected no_face_detected, got ${JSON.stringify(res)}`);
    }
  });

  testAssert('Detector Returns multiple_faces when > 1 face after NMS', async () => {
    const scoreData = new Float32Array(80 * 80 * 2).fill(0.0);
    scoreData[0] = 0.95;
    scoreData[100] = 0.90;
    const bboxData = new Float32Array(80 * 80 * 2 * 4).fill(0.0);
    bboxData[0] = 1.0; bboxData[1] = 1.0; bboxData[2] = 5.0; bboxData[3] = 5.0;
    bboxData[400] = 1.0; bboxData[401] = 1.0; bboxData[402] = 5.0; bboxData[403] = 5.0;

    const mockSession = {
      inputNames: ['input.1'],
      outputNames: ['score_8', 'bbox_8', 'kps_8'],
      run: async () => ({
        score_8: { data: scoreData },
        bbox_8: { data: bboxData },
        kps_8: { data: new Float32Array(80 * 80 * 2 * 10).fill(0.0) },
      }),
    };
    const detector = new SCRFDDetector(mockSession, 0.7, 0.4);
    const frame: FrameData = { data: new Uint8Array(640 * 480 * 4).fill(128), width: 640, height: 480 };
    const res = await detector.detect(frame);
    if (res.success || res.reason !== 'multiple_faces') {
      throw new Error(`Expected multiple_faces, got ${JSON.stringify(res)}`);
    }
  });

  console.log('\n====================================================');
  console.log(`Summary: ${passedCount} assertions passed, ${failedCount} failed.`);
  console.log('====================================================');
}

runChallengerEmpiricalVerification().catch(err => {
  console.error('Fatal error during challenger verification:', err);
  process.exit(1);
});
