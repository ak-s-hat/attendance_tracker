import React from 'react'
import { QualityMetrics } from '../quality/QualityEngine'

export interface QualityOverlayProps {
  metrics: QualityMetrics | null
  isCapturing?: boolean
}

export const QualityOverlay: React.FC<QualityOverlayProps> = ({
  metrics,
  isCapturing = false,
}) => {
  const overallPassed = metrics?.overallPassed ?? false

  const ovalBorderColor = overallPassed
    ? 'border-emerald-500 shadow-emerald-500/30'
    : metrics
    ? 'border-amber-400 shadow-amber-400/20'
    : 'border-white/60'

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 bg-gradient-to-b from-black/40 via-transparent to-black/60">
      {/* Top Status Pills Bar */}
      <div className="flex flex-wrap items-center justify-center gap-2 z-10">
        {/* Centering Pill */}
        <span
          data-testid="pill-centering"
          className={`px-3 py-1 text-xs font-semibold rounded-full backdrop-blur-md transition-colors ${
            metrics?.isCentered
              ? 'bg-emerald-500/80 text-white'
              : 'bg-slate-800/80 text-amber-300 border border-amber-400/40'
          }`}
        >
          {metrics?.isCentered ? '✓ Centered' : '○ Off Center'}
        </span>

        {/* Lighting Pill */}
        <span
          data-testid="pill-lighting"
          className={`px-3 py-1 text-xs font-semibold rounded-full backdrop-blur-md transition-colors ${
            metrics?.isLightingGood
              ? 'bg-emerald-500/80 text-white'
              : 'bg-slate-800/80 text-amber-300 border border-amber-400/40'
          }`}
        >
          {metrics?.isLightingGood
            ? '✓ Lighting OK'
            : metrics && metrics.brightnessScore < 60
            ? '○ Too Dark'
            : metrics && metrics.brightnessScore > 210
            ? '○ Too Bright'
            : '○ Lighting'}
        </span>

        {/* Distance Pill */}
        <span
          data-testid="pill-distance"
          className={`px-3 py-1 text-xs font-semibold rounded-full backdrop-blur-md transition-colors ${
            metrics?.isDistanceGood
              ? 'bg-emerald-500/80 text-white'
              : 'bg-slate-800/80 text-amber-300 border border-amber-400/40'
          }`}
        >
          {metrics?.isDistanceGood
            ? '✓ Distance OK'
            : metrics && metrics.faceRatio < 0.25
            ? '○ Move Closer'
            : metrics && metrics.faceRatio > 0.55
            ? '○ Move Back'
            : '○ Distance'}
        </span>

        {/* Sharpness / Focus Pill */}
        <span
          data-testid="pill-sharpness"
          className={`px-3 py-1 text-xs font-semibold rounded-full backdrop-blur-md transition-colors ${
            metrics?.isSharp
              ? 'bg-emerald-500/80 text-white'
              : 'bg-slate-800/80 text-amber-300 border border-amber-400/40'
          }`}
        >
          {metrics?.isSharp ? '✓ Focus OK' : '○ Blurry'}
        </span>
      </div>

      {/* Center Guide Oval & Bounding Box */}
      <div className="relative flex-1 flex items-center justify-center">
        {/* Guide Oval */}
        <div
          data-testid="guide-oval"
          className={`w-56 h-72 rounded-[50%] border-4 transition-all duration-300 flex items-center justify-center ${ovalBorderColor} shadow-2xl`}
        >
          {/* Inner Bounding Box Indicator */}
          <div
            data-testid="bounding-box-indicator"
            className={`w-40 h-52 border-2 border-dashed rounded-lg transition-colors ${
              overallPassed ? 'border-emerald-400/80' : 'border-white/30'
            }`}
          />
        </div>
      </div>

      {/* Bottom Feedback Banner */}
      <div className="z-10 text-center pb-2">
        <div
          data-testid="feedback-message"
          className={`inline-block px-5 py-2 rounded-xl text-sm font-semibold backdrop-blur-md shadow-lg transition-all ${
            isCapturing
              ? 'bg-indigo-600 text-white animate-pulse'
              : overallPassed
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-900/90 text-white border border-slate-700'
          }`}
        >
          {isCapturing
            ? 'Capturing snapshot...'
            : metrics?.feedbackMessage || 'Position your face inside the guide'}
        </div>
      </div>
    </div>
  )
}

export default QualityOverlay
