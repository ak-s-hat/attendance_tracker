import {
  QualityEngine,
  evaluateBrightness,
  evaluateCentering,
  evaluateProximity,
  evaluateSharpness,
} from '../components/quality/QualityEngine'

// Helper to create ImageData object in test environment
function createTestImageData(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => [number, number, number, number]
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const [r, g, b, a] = fillFn(x, y)
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = a
    }
  }
  return {
    width,
    height,
    data,
    colorSpace: 'srgb',
  } as ImageData
}

describe('QualityEngine Unit Tests', () => {
  describe('evaluateBrightness', () => {
    it('returns isLightingGood=false for dark images (Y < 60)', () => {
      const darkImage = createTestImageData(20, 20, () => [30, 30, 30, 255])
      const result = evaluateBrightness(darkImage)
      expect(result.isLightingGood).toBe(false)
      expect(result.brightnessScore).toBe(30)
    })

    it('returns isLightingGood=false for bright images (Y > 210)', () => {
      const brightImage = createTestImageData(20, 20, () => [230, 230, 230, 255])
      const result = evaluateBrightness(brightImage)
      expect(result.isLightingGood).toBe(false)
      expect(result.brightnessScore).toBe(230)
    })

    it('returns isLightingGood=true for ideal lighting (60 <= Y <= 210)', () => {
      const idealImage = createTestImageData(20, 20, () => [128, 128, 128, 255])
      const result = evaluateBrightness(idealImage)
      expect(result.isLightingGood).toBe(true)
      expect(result.brightnessScore).toBe(128)
    })
  })

  describe('evaluateCentering', () => {
    it('returns isCentered=true when center offsets |ΔX| <= 0.15 and |ΔY| <= 0.15', () => {
      const faceRect = { x: 100, y: 100, width: 200, height: 200 }
      const result = evaluateCentering(faceRect, 400, 400)
      expect(result.isCentered).toBe(true)
      expect(result.centerOffsetX).toBe(0)
      expect(result.centerOffsetY).toBe(0)
    })

    it('returns isCentered=false when face is horizontally off-center (|ΔX| > 0.15)', () => {
      const faceRect = { x: 260, y: 100, width: 100, height: 100 } // Cx = 310, ΔX = (310-200)/200 = 0.55
      const result = evaluateCentering(faceRect, 400, 400)
      expect(result.isCentered).toBe(false)
      expect(result.centerOffsetX).toBeGreaterThan(0.15)
    })

    it('returns isCentered=false when face is vertically off-center (|ΔY| > 0.15)', () => {
      const faceRect = { x: 100, y: 260, width: 100, height: 100 } // Cy = 310, ΔY = (310-200)/200 = 0.55
      const result = evaluateCentering(faceRect, 400, 400)
      expect(result.isCentered).toBe(false)
      expect(result.centerOffsetY).toBeGreaterThan(0.15)
    })
  })

  describe('evaluateProximity', () => {
    it('returns isDistanceGood=false when face ratio is too small (< 0.25)', () => {
      const faceRect = { x: 175, y: 175, width: 50, height: 50 } // ratio = 50 / 400 = 0.125
      const result = evaluateProximity(faceRect, 400)
      expect(result.isDistanceGood).toBe(false)
      expect(result.faceRatio).toBe(0.125)
    })

    it('returns isDistanceGood=false when face ratio is too large (> 0.55)', () => {
      const faceRect = { x: 50, y: 50, width: 260, height: 260 } // ratio = 260 / 400 = 0.65
      const result = evaluateProximity(faceRect, 400)
      expect(result.isDistanceGood).toBe(false)
      expect(result.faceRatio).toBe(0.65)
    })

    it('returns isDistanceGood=true for optimal face ratio (0.25 <= ratio <= 0.55)', () => {
      const faceRect = { x: 120, y: 120, width: 160, height: 160 } // ratio = 160 / 400 = 0.4
      const result = evaluateProximity(faceRect, 400)
      expect(result.isDistanceGood).toBe(true)
      expect(result.faceRatio).toBe(0.4)
    })
  })

  describe('evaluateSharpness', () => {
    it('returns isSharp=false for uniform smooth (blurry) images', () => {
      const smoothImage = createTestImageData(20, 20, () => [128, 128, 128, 255])
      const result = evaluateSharpness(smoothImage)
      expect(result.isSharp).toBe(false)
      expect(result.sharpnessScore).toBe(0)
    })

    it('returns isSharp=true for high-contrast edge matrices (sharp images)', () => {
      const sharpImage = createTestImageData(20, 20, (x, y) => {
        // High frequency checkerboard pattern creates high Laplacian variance
        const val = (x + y) % 2 === 0 ? 0 : 255
        return [val, val, val, 255]
      })
      const result = evaluateSharpness(sharpImage)
      expect(result.isSharp).toBe(true)
      expect(result.sharpnessScore).toBeGreaterThanOrEqual(35.0)
    })
  })

  describe('QualityEngine 5-frame stability guard', () => {
    it('requires 5 consecutive passing frames before setting overallPassed=true', () => {
      const engine = new QualityEngine()
      const sharpImage = createTestImageData(20, 20, (x, y) => {
        const val = (x + y) % 2 === 0 ? 0 : 255
        return [val, val, val, 255]
      })
      const centeredRect = { x: 5, y: 5, width: 8, height: 8 } // ratio = 8 / 20 = 0.40, Cx=9, Cy=9, ΔX=0, ΔY=0

      // Frames 1 to 4: overallPassed should be false
      for (let i = 1; i <= 4; i++) {
        const metrics = engine.evaluateFrame(sharpImage, centeredRect)
        expect(metrics.isCentered).toBe(true)
        expect(metrics.isLightingGood).toBe(true)
        expect(metrics.isDistanceGood).toBe(true)
        expect(metrics.isSharp).toBe(true)
        expect(metrics.overallPassed).toBe(false)
        expect(engine.getPassingFramesCount()).toBe(i)
      }

      // Frame 5: overallPassed should become true
      const frame5Metrics = engine.evaluateFrame(sharpImage, centeredRect)
      expect(frame5Metrics.overallPassed).toBe(true)
      expect(engine.getPassingFramesCount()).toBe(5)
      expect(frame5Metrics.feedbackMessage).toBe('Perfect! Face quality verified')
    })

    it('resets consecutive passing counter if a frame fails quality checks', () => {
      const engine = new QualityEngine()
      const sharpImage = createTestImageData(20, 20, (x, y) => {
        const val = (x + y) % 2 === 0 ? 0 : 255
        return [val, val, val, 255]
      })
      const darkImage = createTestImageData(20, 20, () => [10, 10, 10, 255])
      const centeredRect = { x: 5, y: 5, width: 8, height: 8 }

      // Pass 3 frames
      for (let i = 0; i < 3; i++) {
        engine.evaluateFrame(sharpImage, centeredRect)
      }
      expect(engine.getPassingFramesCount()).toBe(3)

      // Fail 1 frame (dark image)
      const failedMetrics = engine.evaluateFrame(darkImage, centeredRect)
      expect(failedMetrics.overallPassed).toBe(false)
      expect(engine.getPassingFramesCount()).toBe(0)
      expect(failedMetrics.feedbackMessage).toBe('Too dark — move to better lighting')
    })
  })
})
