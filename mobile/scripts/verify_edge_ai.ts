import { ArcFaceRecognizer } from '../src/ai/recognizer';
import { MiniFASNetLiveness } from '../src/ai/liveness';
import { SCRFDDetector } from '../src/ai/detector';
import { BoundingBox, FrameData } from '../src/ai/types';

async function verifyEdgeAI() {
  console.log('====================================================');
  console.log('  Edge AI Pipeline & Core Utilities Verification');
  console.log('====================================================');

  // 1. Test Mock Frame Data
  const mockFrame: FrameData = {
    data: new Uint8Array(640 * 480 * 4).fill(128),
    width: 640,
    height: 480,
  };
  const mockBbox: BoundingBox = [100, 100, 300, 300];

  // 2. ArcFace L2 Normalization & Cosine Similarity Verification
  console.log('-> Testing ArcFace Recognizer Math...');
  const dummyEmbedding = new Float32Array(512);
  for (let i = 0; i < 512; i++) dummyEmbedding[i] = (i + 1) * 0.01;
  const normalized = ArcFaceRecognizer.l2Normalize(dummyEmbedding);

  let normSq = 0;
  for (let i = 0; i < 512; i++) normSq += normalized[i] * normalized[i];
  const normVal = Math.sqrt(normSq);
  console.log(`   L2 Norm: ${normVal.toFixed(6)} (Expected: 1.000000)`);
  if (Math.abs(normVal - 1.0) > 1e-4) {
    throw new Error(`L2 Normalization check failed! Norm was ${normVal}`);
  }

  const cosSelf = ArcFaceRecognizer.cosineSimilarity(normalized, normalized);
  console.log(`   Cosine Similarity (Self): ${cosSelf.toFixed(6)} (Expected: 1.000000)`);
  if (Math.abs(cosSelf - 1.0) > 1e-4) {
    throw new Error(`Cosine similarity check failed! Similarity was ${cosSelf}`);
  }

  // 3. MiniFASNet Liveness BBox 1.5x Expansion Verification
  console.log('-> Testing MiniFASNet Liveness BBox Expansion...');
  const liveness = new MiniFASNetLiveness(null);
  const expanded = liveness.expandBoundingBox(mockBbox, 640, 480, 1.5);
  console.log(`   Original BBox: [${mockBbox.join(', ')}]`);
  console.log(`   Expanded BBox (1.5x): [${expanded.join(', ')}]`);
  if (expanded[0] !== 50 || expanded[1] !== 50 || expanded[2] !== 350 || expanded[3] !== 350) {
    throw new Error(`BBox expansion failed! Got [${expanded.join(', ')}]`);
  }

  // 4. Preprocessor Tensor Verification
  console.log('-> Testing SCRFD Preprocessing Tensor Shape & Scaling...');
  const detector = new SCRFDDetector(null);
  const detTensor = detector.preprocess(mockFrame);
  console.log(`   SCRFD Tensor Length: ${detTensor.length} (Expected: 1228800)`);
  if (detTensor.length !== 1 * 3 * 640 * 640) {
    throw new Error(`SCRFD Preprocessor shape error! Tensor length: ${detTensor.length}`);
  }

  console.log('----------------------------------------------------');
  console.log('✅ Edge AI Verification Passed Successfully!');
  console.log('====================================================');
}

verifyEdgeAI().catch(err => {
  console.error('❌ Edge AI Verification Failed:', err);
  process.exit(1);
});
