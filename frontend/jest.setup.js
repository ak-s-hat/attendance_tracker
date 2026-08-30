import '@testing-library/jest-dom'

if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

if (typeof global.ImageData === 'undefined') {
  global.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth
        this.height = widthOrHeight || 0
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = dataOrWidth
        this.width = widthOrHeight || 0
        this.height = height || 0
      }
    }
  }
}

// Polyfill for HTMLCanvasElement.toBlob if missing or stubbed in JSDOM
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    const dummyData = new Uint8Array([137, 80, 78, 71])
    const blob = new Blob([dummyData], { type: type || 'image/jpeg' })
    if (callback) {
      callback(blob)
    }
  }

  HTMLCanvasElement.prototype.getContext = jest.fn().mockImplementation((contextType) => {
    if (contextType === '2d') {
      return {
        drawImage: jest.fn(),
        getImageData: jest.fn().mockReturnValue({
          data: new Uint8ClampedArray(640 * 480 * 4),
          width: 640,
          height: 480,
        }),
        putImageData: jest.fn(),
        createImageData: jest.fn(),
        setTransform: jest.fn(),
        save: jest.fn(),
        fillText: jest.fn(),
        restore: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        closePath: jest.fn(),
        stroke: jest.fn(),
        translate: jest.fn(),
        scale: jest.fn(),
        rotate: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        measureText: jest.fn().mockReturnValue({ width: 0 }),
        transform: jest.fn(),
        rect: jest.fn(),
        clip: jest.fn(),
      }
    }
    return null
  })
}

// Polyfill for HTMLMediaElement play/pause in JSDOM
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = jest.fn().mockImplementation(() => Promise.resolve())
  HTMLMediaElement.prototype.pause = jest.fn().mockImplementation(() => {})
}
