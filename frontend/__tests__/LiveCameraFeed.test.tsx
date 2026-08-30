import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import LiveCameraFeed, { compressCanvasToBlob } from '../components/camera/LiveCameraFeed'

describe('LiveCameraFeed Component Tests', () => {
  let mockTrackStop: jest.Mock
  let mockStream: MediaStream

  beforeEach(() => {
    mockTrackStop = jest.fn()
    mockStream = {
      getTracks: () => [
        { stop: mockTrackStop, kind: 'video' } as unknown as MediaStreamTrack,
      ],
    } as unknown as MediaStream

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: jest.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('initializes getUserMedia camera stream on mount when active=true', async () => {
    render(<LiveCameraFeed active={true} />)

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      })
    })

    expect(screen.getByTestId('live-camera-video')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-canvas')).toBeInTheDocument()
  })

  it('stops video tracks and cancels animation frames on unmount', async () => {
    const { unmount } = render(<LiveCameraFeed active={true} />)

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()
    })

    unmount()

    expect(mockTrackStop).toHaveBeenCalled()
  })

  it('displays camera permission denied alert when getUserMedia throws NotAllowedError', async () => {
    const permissionError = new Error('Permission denied')
    permissionError.name = 'NotAllowedError'
    ;(navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValueOnce(permissionError)

    render(<LiveCameraFeed active={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('camera-error-alert')).toHaveTextContent(
        'Camera permission denied. Please allow camera access in your browser settings.'
      )
    })
  })

  it('compressCanvasToBlob helper scales video and resolves a JPEG Blob', async () => {
    const fakeVideo = document.createElement('video')
    Object.defineProperty(fakeVideo, 'videoWidth', { value: 1280, configurable: true })
    Object.defineProperty(fakeVideo, 'videoHeight', { value: 720, configurable: true })

    const blob = await compressCanvasToBlob(fakeVideo, 640, 480, 0.85)

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/jpeg')
  })
})
