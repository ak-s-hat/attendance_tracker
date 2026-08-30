export interface FaceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface QualityMetrics {
  isCentered: boolean
  isLightingGood: boolean
  isDistanceGood: boolean
  isSharp: boolean
  overallPassed: boolean
  brightnessScore: number       // Luminance 0..255
  sharpnessScore: number        // Laplacian Variance score
  faceRatio: number             // Face width / Frame width ratio
  centerOffsetX: number         // Normalized offset from frame center (-1..1)
  centerOffsetY: number         // Normalized offset from frame center (-1..1)
  feedbackMessage: string       // Human-readable status hint
}

/**
 * Centering evaluation: checks if face center offset |ΔX| <= 0.15 and |ΔY| <= 0.15
 */
export function evaluateCentering(
  faceRect: FaceRect,
  frameWidth: number,
  frameHeight: number
): { isCentered: boolean; centerOffsetX: number; centerOffsetY: number } {
  if (frameWidth <= 0 || frameHeight <= 0) {
    return { isCentered: false, centerOffsetX: 0, centerOffsetY: 0 }
  }

  const cx = faceRect.x + faceRect.width / 2
  const cy = faceRect.y + faceRect.height / 2

  const halfW = frameWidth / 2
  const halfH = frameHeight / 2

  const centerOffsetX = (cx - halfW) / halfW
  const centerOffsetY = (cy - halfH) / halfH

  const isCentered = Math.abs(centerOffsetX) <= 0.15 && Math.abs(centerOffsetY) <= 0.15

  return {
    isCentered,
    centerOffsetX: Math.round(centerOffsetX * 1000) / 1000,
    centerOffsetY: Math.round(centerOffsetY * 1000) / 1000,
  }
}

/**
 * Brightness evaluation: computes average luminance Y = 0.299R + 0.587G + 0.114B bounded in [60, 210]
 */
export function evaluateBrightness(
  imageData: ImageData
): { isLightingGood: boolean; brightnessScore: number } {
  const data = imageData.data
  const totalPixels = imageData.width * imageData.height

  if (totalPixels === 0 || data.length === 0) {
    return { isLightingGood: false, brightnessScore: 0 }
  }

  let totalLuminance = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    totalLuminance += luminance
  }

  const brightnessScore = Math.round((totalLuminance / totalPixels) * 100) / 100
  const isLightingGood = brightnessScore >= 60 && brightnessScore <= 210

  return { isLightingGood, brightnessScore }
}

/**
 * Proximity / Distance evaluation: face width ratio faceRatio = faceRect.width / frameWidth bounded in [0.25, 0.55]
 */
export function evaluateProximity(
  faceRect: FaceRect,
  frameWidth: number
): { isDistanceGood: boolean; faceRatio: number } {
  if (frameWidth <= 0) {
    return { isDistanceGood: false, faceRatio: 0 }
  }

  const faceRatio = Math.round((faceRect.width / frameWidth) * 1000) / 1000
  const isDistanceGood = faceRatio >= 0.25 && faceRatio <= 0.55

  return { isDistanceGood, faceRatio }
}

/**
 * Sharpness / Blur metric: computes Laplacian variance Var(L) across grayscale matrix. Threshold: Var(L) >= 35.0
 */
export function evaluateSharpness(
  imageData: ImageData
): { isSharp: boolean; sharpnessScore: number } {
  const width = imageData.width
  const height = imageData.height
  const data = imageData.data

  if (width < 3 || height < 3 || data.length === 0) {
    return { isSharp: false, sharpnessScore: 0 }
  }

  // Convert to grayscale 2D array or typed array
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }

  // Compute 2D Laplacian operator L(x,y) = I(x+1,y) + I(x-1,y) + I(x,y+1) + I(x,y-1) - 4*I(x,y)
  let laplacianSum = 0
  let laplacianCount = 0

  // First pass: compute mean of Laplacian
  // We process inner pixels
  const innerW = width - 2
  const innerH = height - 2
  const laplacianValues = new Float32Array(innerW * innerH)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const val =
        gray[idx + 1] +
        gray[idx - 1] +
        gray[idx + width] +
        gray[idx - width] -
        4 * gray[idx]

      laplacianValues[laplacianCount] = val
      laplacianSum += val
      laplacianCount++
    }
  }

  if (laplacianCount === 0) {
    return { isSharp: false, sharpnessScore: 0 }
  }

  const laplacianMean = laplacianSum / laplacianCount

  // Second pass: compute variance
  let varSum = 0
  for (let i = 0; i < laplacianCount; i++) {
    const diff = laplacianValues[i] - laplacianMean
    varSum += diff * diff
  }

  const sharpnessScore = Math.round((varSum / laplacianCount) * 100) / 100
  const isSharp = sharpnessScore >= 35.0

  return { isSharp, sharpnessScore }
}

export class QualityEngine {
  private passingFramesCount: number = 0

  public reset(): void {
    this.passingFramesCount = 0
  }

  public getPassingFramesCount(): number {
    return this.passingFramesCount
  }

  public static evaluateCentering = evaluateCentering
  public static evaluateBrightness = evaluateBrightness
  public static evaluateProximity = evaluateProximity
  public static evaluateSharpness = evaluateSharpness

  public evaluateFrame(
    imageData: ImageData,
    faceRect?: FaceRect
  ): QualityMetrics {
    const frameWidth = imageData.width
    const frameHeight = imageData.height

    const effectiveRect: FaceRect = faceRect ?? {
      x: frameWidth * 0.3,
      y: frameHeight * 0.2,
      width: frameWidth * 0.4,
      height: frameHeight * 0.6,
    }

    const centering = evaluateCentering(effectiveRect, frameWidth, frameHeight)
    const brightness = evaluateBrightness(imageData)
    const proximity = evaluateProximity(effectiveRect, frameWidth)
    const sharpness = evaluateSharpness(imageData)

    const allMetricsPassed =
      centering.isCentered &&
      brightness.isLightingGood &&
      proximity.isDistanceGood &&
      sharpness.isSharp

    if (allMetricsPassed) {
      this.passingFramesCount += 1
    } else {
      this.passingFramesCount = 0
    }

    const overallPassed = this.passingFramesCount >= 5

    let feedbackMessage = ''
    if (!centering.isCentered) {
      feedbackMessage = 'Center your face in the oval guide'
    } else if (brightness.brightnessScore < 60) {
      feedbackMessage = 'Too dark — move to better lighting'
    } else if (brightness.brightnessScore > 210) {
      feedbackMessage = 'Too bright — avoid harsh background glare'
    } else if (proximity.faceRatio < 0.25) {
      feedbackMessage = 'Move closer to the camera'
    } else if (proximity.faceRatio > 0.55) {
      feedbackMessage = 'Move further back'
    } else if (!sharpness.isSharp) {
      feedbackMessage = 'Camera blurry or moving — hold still'
    } else if (!overallPassed) {
      feedbackMessage = 'Hold still... verifying quality'
    } else {
      feedbackMessage = 'Perfect! Face quality verified'
    }

    return {
      isCentered: centering.isCentered,
      isLightingGood: brightness.isLightingGood,
      isDistanceGood: proximity.isDistanceGood,
      isSharp: sharpness.isSharp,
      overallPassed,
      brightnessScore: brightness.brightnessScore,
      sharpnessScore: sharpness.sharpnessScore,
      faceRatio: proximity.faceRatio,
      centerOffsetX: centering.centerOffsetX,
      centerOffsetY: centering.centerOffsetY,
      feedbackMessage,
    }
  }
}

export const qualityEngineInstance = new QualityEngine()

export function evaluateFrame(
  imageData: ImageData,
  faceRect?: FaceRect,
  engine: QualityEngine = qualityEngineInstance
): QualityMetrics {
  return engine.evaluateFrame(imageData, faceRect)
}
