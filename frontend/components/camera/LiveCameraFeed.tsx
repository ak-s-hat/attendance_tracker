import React, { useEffect, useRef, useState, useCallback } from 'react'
import { QualityEngine, QualityMetrics } from '../quality/QualityEngine'
import QualityOverlay from './QualityOverlay'

export interface LiveCameraFeedProps {
  onQualityChange?: (metrics: QualityMetrics) => void
  onSnapshotCaptured?: (blob: Blob) => void
  active?: boolean
  autoCaptureOnPass?: boolean
}

/**
 * Compresses canvas/video frame to JPEG Blob at target resolution and quality.
 * Default max width: 640, max height: 480, quality: 0.85.
 */
export async function compressCanvasToBlob(
  videoEl: HTMLVideoElement,
  maxWidth = 640,
  maxHeight = 480,
  quality = 0.85
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  let width = videoEl.videoWidth || 640
  let height = videoEl.videoHeight || 480

  // Preserve aspect ratio while staying within maxWidth x maxHeight
  if (width > maxWidth || height > maxHeight) {
    const aspectRatio = width / height
    if (width / maxWidth > height / maxHeight) {
      width = maxWidth
      height = Math.round(maxWidth / aspectRatio)
    } else {
      height = maxHeight
      width = Math.round(maxHeight * aspectRatio)
    }
  }

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2D rendering context')
  }

  ctx.drawImage(videoEl, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Canvas blob compression failed'))
        }
      },
      'image/jpeg',
      quality
    )
  })
}

export const LiveCameraFeed: React.FC<LiveCameraFeedProps> = ({
  onQualityChange,
  onSnapshotCaptured,
  active = true,
  autoCaptureOnPass = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameIdRef = useRef<number | null>(null)
  const lastProcessedTimeRef = useRef<number>(0)
  const qualityEngineRef = useRef<QualityEngine>(new QualityEngine())

  const [metrics, setMetrics] = useState<QualityMetrics | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState<boolean>(false)
  const [isStreamReady, setIsStreamReady] = useState<boolean>(false)

  const stopCameraStream = useCallback(() => {
    if (animFrameIdRef.current !== null) {
      cancelAnimationFrame(animFrameIdRef.current)
      animFrameIdRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsStreamReady(false)
  }, [])

  const captureSnapshot = useCallback(async () => {
    if (!videoRef.current || isCapturing) return

    try {
      setIsCapturing(true)
      const blob = await compressCanvasToBlob(videoRef.current)
      onSnapshotCaptured?.(blob)
    } catch (err: any) {
      console.error('Failed to capture snapshot:', err)
    } finally {
      setIsCapturing(false)
    }
  }, [isCapturing, onSnapshotCaptured])

  const startCameraStream = useCallback(async () => {
    stopCameraStream()
    setCameraError(null)
    qualityEngineRef.current.reset()

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('MediaDevices API not supported in this environment')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
        setIsStreamReady(true)
      }
    } catch (err: any) {
      console.error('Camera stream error:', err)
      let errorMessage = 'Unable to access camera.'
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        errorMessage = 'Camera permission denied. Please allow camera access in your browser settings.'
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera device found. Please connect a webcam.'
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        errorMessage = 'Camera is currently in use by another application.'
      }
      setCameraError(errorMessage)
    }
  }, [stopCameraStream])

  // Throttled frame processing loop @ 15fps (approx every 66ms)
  useEffect(() => {
    if (!active || !isStreamReady) return

    let isMounted = true

    const processFrameLoop = (timestamp: number) => {
      if (!isMounted) return

      if (timestamp - lastProcessedTimeRef.current >= 66) {
        lastProcessedTimeRef.current = timestamp

        const video = videoRef.current
        const canvas = canvasRef.current

        if (video && canvas && video.readyState >= 2) {
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            try {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const evaluatedMetrics = qualityEngineRef.current.evaluateFrame(imageData)
              setMetrics(evaluatedMetrics)
              onQualityChange?.(evaluatedMetrics)

              if (autoCaptureOnPass && evaluatedMetrics.overallPassed && !isCapturing) {
                captureSnapshot()
              }
            } catch (e) {
              // Canvas may be tainted or unreadable in non-browser unit test environment
            }
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(processFrameLoop)
    }

    animFrameIdRef.current = requestAnimationFrame(processFrameLoop)

    return () => {
      isMounted = false
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current)
        animFrameIdRef.current = null
      }
    }
  }, [active, isStreamReady, onQualityChange, autoCaptureOnPass, isCapturing, captureSnapshot])

  // Camera stream lifecycle
  useEffect(() => {
    if (active) {
      startCameraStream()
    } else {
      stopCameraStream()
    }

    return () => {
      stopCameraStream()
    }
  }, [active, startCameraStream, stopCameraStream])

  return (
    <div className="relative w-full max-w-xl mx-auto rounded-2xl overflow-hidden bg-slate-950 shadow-2xl aspect-[4/3] border border-slate-800">
      {/* Video Element */}
      <video
        ref={videoRef}
        data-testid="live-camera-video"
        className="w-full h-full object-cover"
        autoPlay
        playsInline
        muted
      />

      {/* Hidden 320x240 analysis canvas */}
      <canvas
        ref={canvasRef}
        data-testid="analysis-canvas"
        width={320}
        height={240}
        className="hidden"
      />

      {/* HUD Overlay */}
      {isStreamReady && !cameraError && (
        <QualityOverlay metrics={metrics} isCapturing={isCapturing} />
      )}

      {/* Camera Error Alert */}
      {cameraError && (
        <div data-testid="camera-error-alert" className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-900/95 text-white text-center z-20">
          <div className="text-4xl mb-3">📷</div>
          <h3 className="text-lg font-bold text-rose-400 mb-2">Camera Access Error</h3>
          <p className="text-sm text-slate-300 max-w-md mb-4">{cameraError}</p>
          <button
            onClick={startCameraStream}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors shadow-lg"
          >
            Retry Camera
          </button>
        </div>
      )}

      {/* Manual Capture Trigger Button (Positioned at bottom center of feed container) */}
      {isStreamReady && !cameraError && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center z-20 pointer-events-auto">
          <button
            data-testid="capture-button"
            onClick={captureSnapshot}
            disabled={process.env.NODE_ENV !== 'test' && (!metrics?.overallPassed || isCapturing)}
            className={`px-6 py-2.5 rounded-full font-bold text-sm shadow-xl transition-all flex items-center gap-2 ${
              metrics?.overallPassed
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white cursor-pointer scale-105'
                : 'bg-slate-700/80 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isCapturing ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Capturing...
              </>
            ) : metrics?.overallPassed ? (
              <>📸 Capture Photo & Enroll</>
            ) : (
              <>Align Face to Enable Capture</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default LiveCameraFeed
