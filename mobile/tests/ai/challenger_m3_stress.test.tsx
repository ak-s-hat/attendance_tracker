import React from 'react';
import render from 'react-test-renderer';
import { MiniFASNetLiveness } from '../../src/ai/liveness';
import { SCRFDDetector } from '../../src/ai/detector';
import { ArcFaceRecognizer } from '../../src/ai/recognizer';
import { BoundingBox, FrameData } from '../../src/ai/types';
import { FaceOverlay } from '../../src/components/FaceOverlay';

describe('Challenger M3 Empirical Verification & Stress Test Suite', () => {

  describe('1. Softmax Extreme Values & Numerical Stability (liveness.ts)', () => {
    const liveness = new MiniFASNetLiveness(null);

    it('stress test: [1000.0, -1000.0] produces [1.0, 0.0] without NaN or Infinity', () => {
      const logits = [1000.0, -1000.0];
      const probs = liveness.softmax(logits);
      expect(probs.length).toBe(2);
      expect(probs[0]).toBe(1.0);
      expect(probs[1]).toBe(0.0);
      expect(Number.isNaN(probs[0])).toBe(false);
      expect(Number.isNaN(probs[1])).toBe(false);
    });

    it('stress test: [-1000.0, 1000.0] produces [0.0, 1.0] without NaN or Infinity', () => {
      const logits = [-1000.0, 1000.0];
      const probs = liveness.softmax(logits);
      expect(probs.length).toBe(2);
      expect(probs[0]).toBe(0.0);
      expect(probs[1]).toBe(1.0);
      expect(Number.isNaN(probs[0])).toBe(false);
      expect(Number.isNaN(probs[1])).toBe(false);
    });

    it('stress test: symmetric extreme logits [5000.0, 5000.0] produces [0.5, 0.5]', () => {
      const logits = [5000.0, 5000.0];
      const probs = liveness.softmax(logits);
      expect(probs[0]).toBeCloseTo(0.5, 5);
      expect(probs[1]).toBeCloseTo(0.5, 5);
    });

    it('stress test: symmetric extreme negative logits [-5000.0, -5000.0] produces [0.5, 0.5]', () => {
      const logits = [-5000.0, -5000.0];
      const probs = liveness.softmax(logits);
      expect(probs[0]).toBeCloseTo(0.5, 5);
      expect(probs[1]).toBeCloseTo(0.5, 5);
    });

    it('edge case: empty logits array returns []', () => {
      expect(liveness.softmax([])).toEqual([]);
      expect(liveness.softmax(null as any)).toEqual([]);
    });

    it('stress test: large logits array with 100 elements from -1e5 to +1e5 sums to 1.0', () => {
      const logits = new Float32Array(100);
      for (let i = 0; i < 100; i++) logits[i] = (i - 50) * 2000;
      const probs = liveness.softmax(logits);
      let sum = 0;
      for (let p of probs) {
        expect(Number.isNaN(p)).toBe(false);
        sum += p;
      }
      expect(sum).toBeCloseTo(1.0, 4);
    });
  });

  describe('2. Bounding Box Scaling Math & Color Tag Rendering Logic (FaceOverlay.tsx)', () => {
    it('empirical test: scales bounding box correctly from 640x480 frame to 320x240 UI container', () => {
      const bbox: BoundingBox = [100, 150, 300, 350];
      const component = render.create(
        <FaceOverlay
          bbox={bbox}
          status="scanning"
          containerWidth={320}
          containerHeight={240}
          frameWidth={640}
          frameHeight={480}
        />
      );
      const root = component.root;
      const boxView = root.findByProps({ testID: 'bbox-rect' });
      const style = boxView.props.style;

      // Flatten styles if array
      const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;

      // scaleX = 320/640 = 0.5 -> left = 50, width = 200 * 0.5 = 100
      // scaleY = 240/480 = 0.5 -> top = 75, height = 200 * 0.5 = 100
      expect(flatStyle.left).toBe(50);
      expect(flatStyle.top).toBe(75);
      expect(flatStyle.width).toBe(100);
      expect(flatStyle.height).toBe(100);
    });

    it('empirical test: status color tags rendering', () => {
      const statuses: Array<{ status: 'success' | 'spoof' | 'unknown' | 'scanning'; expectedColor: string }> = [
        { status: 'success', expectedColor: '#00FF88' },
        { status: 'spoof', expectedColor: '#FF3B30' },
        { status: 'unknown', expectedColor: '#FF9500' },
        { status: 'scanning', expectedColor: '#FFCC00' },
      ];

      for (const { status, expectedColor } of statuses) {
        const component = render.create(
          <FaceOverlay
            bbox={[10, 10, 50, 50]}
            status={status}
            containerWidth={100}
            containerHeight={100}
          />
        );
        const boxView = component.root.findByProps({ testID: 'bbox-rect' });
        const flatStyle = Array.isArray(boxView.props.style) ? Object.assign({}, ...boxView.props.style) : boxView.props.style;
        expect(flatStyle.borderColor).toBe(expectedColor);
      }
    });

    it('empirical edge case: null or undefined bbox renders null', () => {
      const component = render.create(
        <FaceOverlay
          bbox={undefined}
          status="scanning"
          containerWidth={320}
          containerHeight={240}
        />
      );
      expect(component.toJSON()).toBeNull();
    });
  });

  describe('3. 3-Channel (RGB) vs 4-Channel (RGBA) Frame Handling across AI Modules', () => {
    const width = 640;
    const height = 480;
    const bbox: BoundingBox = [100, 100, 200, 200];

    it('empirical test: SCRFDDetector handles 3-channel RGB frame without NaN', () => {
      const detector = new SCRFDDetector(null);
      const rgbFrame: FrameData = {
        data: new Uint8Array(width * height * 3).fill(128),
        width,
        height,
      };
      const tensor = detector.preprocess(rgbFrame);
      expect(tensor.length).toBe(1 * 3 * 640 * 640);
      expect(Number.isNaN(tensor[0])).toBe(false);
      expect(Number.isNaN(tensor[tensor.length - 1])).toBe(false);
    });

    it('empirical test: SCRFDDetector handles 4-channel RGBA frame without NaN', () => {
      const detector = new SCRFDDetector(null);
      const rgbaFrame: FrameData = {
        data: new Uint8Array(width * height * 4).fill(128),
        width,
        height,
      };
      const tensor = detector.preprocess(rgbaFrame);
      expect(tensor.length).toBe(1 * 3 * 640 * 640);
      expect(Number.isNaN(tensor[0])).toBe(false);
      expect(Number.isNaN(tensor[tensor.length - 1])).toBe(false);
    });

    it('empirical test: ArcFaceRecognizer handles 3-channel RGB frame without NaN', () => {
      const recognizer = new ArcFaceRecognizer(null);
      const rgbFrame: FrameData = {
        data: new Uint8Array(width * height * 3).fill(128),
        width,
        height,
      };
      const tensor = recognizer.cropAndPreprocess(rgbFrame, bbox);
      expect(tensor.length).toBe(1 * 3 * 112 * 112);
      expect(Number.isNaN(tensor[0])).toBe(false);
      expect(Number.isNaN(tensor[tensor.length - 1])).toBe(false);
    });

    it('empirical test: ArcFaceRecognizer handles 4-channel RGBA frame without NaN', () => {
      const recognizer = new ArcFaceRecognizer(null);
      const rgbaFrame: FrameData = {
        data: new Uint8Array(width * height * 4).fill(128),
        width,
        height,
      };
      const tensor = recognizer.cropAndPreprocess(rgbaFrame, bbox);
      expect(tensor.length).toBe(1 * 3 * 112 * 112);
      expect(Number.isNaN(tensor[0])).toBe(false);
      expect(Number.isNaN(tensor[tensor.length - 1])).toBe(false);
    });

    it('empirical test: MiniFASNetLiveness handles 3-channel RGB frame without NaN', () => {
      const liveness = new MiniFASNetLiveness(null);
      const rgbFrame: FrameData = {
        data: new Uint8Array(width * height * 3).fill(128),
        width,
        height,
      };
      const tensor = liveness.preprocess(rgbFrame, bbox);
      expect(tensor.length).toBe(1 * 3 * 80 * 80);
      expect(Number.isNaN(tensor[0])).toBe(false);
      expect(Number.isNaN(tensor[tensor.length - 1])).toBe(false);
    });

    it('empirical test: MiniFASNetLiveness handles 4-channel RGBA frame without NaN', () => {
      const liveness = new MiniFASNetLiveness(null);
      const rgbaFrame: FrameData = {
        data: new Uint8Array(width * height * 4).fill(128),
        width,
        height,
      };
      const tensor = liveness.preprocess(rgbaFrame, bbox);
      expect(tensor.length).toBe(1 * 3 * 80 * 80);
      expect(Number.isNaN(tensor[0])).toBe(false);
      expect(Number.isNaN(tensor[tensor.length - 1])).toBe(false);
    });
  });
});
