import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmployeeForm from '../components/registration/EmployeeForm'
import LiveCameraFeed from '../components/camera/LiveCameraFeed'
import QualityOverlay from '../components/camera/QualityOverlay'
import {
  QualityEngine,
  evaluateBrightness,
  evaluateCentering,
  evaluateProximity,
  evaluateSharpness,
} from '../components/quality/QualityEngine'
import * as api from '../app/lib/api'

// Mock api
jest.mock('../app/lib/api', () => ({
  createEmployee: jest.fn(),
  enrollEmployeeFace: jest.fn(),
  validateRegistrationToken: jest.fn(),
}))

// Helper to construct ImageData for unit testing engine
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

describe('Empirical Verification: Milestone 2 Optional Fields & Camera Quality Engine', () => {
  const mockOnSubmitSuccess = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // REQUIREMENT 1: Form submission with ONLY Full Name succeeds cleanly
  // --------------------------------------------------------------------------
  describe('Requirement 1: Minimal Form Submission (ONLY Full Name)', () => {
    it('submits form cleanly with only Full Name, sending undefined for all optional fields', async () => {
      const mockCreatedEmp: api.Employee = {
        id: 'emp-minimal-1',
        name: 'Jane Doe Minimal',
        email: null,
        phone: null,
        department: null,
        job_title: null,
        is_enrolled: false,
        is_active: true,
      }

      ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(mockCreatedEmp)

      render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

      // Enter ONLY full name
      const nameInput = screen.getByLabelText(/full name/i)
      await userEvent.type(nameInput, 'Jane Doe Minimal')

      // Ensure optional fields are untouched
      expect(screen.getByLabelText(/email address/i)).toHaveValue('')
      expect(screen.getByLabelText(/phone number/i)).toHaveValue('')
      expect(screen.getByLabelText(/department/i)).toHaveValue('')
      expect(screen.getByLabelText(/job title/i)).toHaveValue('')

      // Click submit
      const submitBtn = screen.getByRole('button', { name: /continue to camera setup/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        // Verify payload has name and undefined for all optional fields
        expect(api.createEmployee).toHaveBeenCalledTimes(1)
        expect(api.createEmployee).toHaveBeenCalledWith({
          name: 'Jane Doe Minimal',
          email: undefined,
          phone: undefined,
          department: undefined,
          job_title: undefined,
        })
        expect(mockOnSubmitSuccess).toHaveBeenCalledWith(mockCreatedEmp)
      })
    })

    it('trims whitespace from Full Name and succeeds cleanly without optional fields', async () => {
      const mockCreatedEmp: api.Employee = {
        id: 'emp-minimal-2',
        name: 'Padded Name',
        email: null,
        phone: null,
        department: null,
        job_title: null,
        is_enrolled: false,
        is_active: true,
      }

      ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(mockCreatedEmp)

      render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

      await userEvent.type(screen.getByLabelText(/full name/i), '  Padded Name  ')

      const submitBtn = screen.getByRole('button', { name: /continue to camera setup/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(api.createEmployee).toHaveBeenCalledWith({
          name: 'Padded Name',
          email: undefined,
          phone: undefined,
          department: undefined,
          job_title: undefined,
        })
        expect(mockOnSubmitSuccess).toHaveBeenCalledWith(mockCreatedEmp)
      })
    })
  })

  // --------------------------------------------------------------------------
  // REQUIREMENT 2: Optional phone field is included in payload when provided
  // --------------------------------------------------------------------------
  describe('Requirement 2: Optional Phone Field Inclusion', () => {
    it('includes phone field in payload when provided alongside Full Name', async () => {
      const mockCreatedEmp: api.Employee = {
        id: 'emp-phone-1',
        name: 'John PhoneUser',
        email: null,
        phone: '+1 (555) 987-6543',
        department: null,
        job_title: null,
        is_enrolled: false,
        is_active: true,
      }

      ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(mockCreatedEmp)

      render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

      await userEvent.type(screen.getByLabelText(/full name/i), 'John PhoneUser')
      await userEvent.type(screen.getByLabelText(/phone number/i), '+1 (555) 987-6543')

      const submitBtn = screen.getByRole('button', { name: /continue to camera setup/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(api.createEmployee).toHaveBeenCalledWith({
          name: 'John PhoneUser',
          email: undefined,
          phone: '+1 (555) 987-6543',
          department: undefined,
          job_title: undefined,
        })
        expect(mockOnSubmitSuccess).toHaveBeenCalledWith(mockCreatedEmp)
      })
    })

    it('includes trimmed phone number when entered with leading/trailing spaces', async () => {
      const mockCreatedEmp: api.Employee = {
        id: 'emp-phone-2',
        name: 'Alice Phone',
        email: null,
        phone: '555-0199',
        department: null,
        job_title: null,
        is_enrolled: false,
        is_active: true,
      }

      ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(mockCreatedEmp)

      render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

      await userEvent.type(screen.getByLabelText(/full name/i), 'Alice Phone')
      await userEvent.type(screen.getByLabelText(/phone number/i), '  555-0199  ')

      fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

      await waitFor(() => {
        expect(api.createEmployee).toHaveBeenCalledWith({
          name: 'Alice Phone',
          email: undefined,
          phone: '555-0199',
          department: undefined,
          job_title: undefined,
        })
      })
    })

    it('converts whitespace-only phone input to undefined payload', async () => {
      const mockCreatedEmp: api.Employee = {
        id: 'emp-phone-3',
        name: 'Bob SpacePhone',
        email: null,
        phone: null,
        department: null,
        job_title: null,
        is_enrolled: false,
        is_active: true,
      }

      ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(mockCreatedEmp)

      render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

      await userEvent.type(screen.getByLabelText(/full name/i), 'Bob SpacePhone')
      await userEvent.type(screen.getByLabelText(/phone number/i), '   ')

      fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

      await waitFor(() => {
        expect(api.createEmployee).toHaveBeenCalledWith({
          name: 'Bob SpacePhone',
          email: undefined,
          phone: undefined,
          department: undefined,
          job_title: undefined,
        })
      })
    })
  })

  // --------------------------------------------------------------------------
  // REQUIREMENT 3: Quality Engine (Centering, Brightness, Proximity, Sharpness, 5 Frames)
  // --------------------------------------------------------------------------
  describe('Requirement 3: Live Camera Feed Quality Engine', () => {
    describe('1. Centering Evaluation', () => {
      it('evaluates isCentered=true when face offset is within 15% threshold (|ΔX| <= 0.15, |ΔY| <= 0.15)', () => {
        // Frame: 400x400, Center: (200, 200)
        // Face rect center at (200, 200) -> ΔX=0, ΔY=0
        const result1 = evaluateCentering({ x: 150, y: 150, width: 100, height: 100 }, 400, 400)
        expect(result1.isCentered).toBe(true)
        expect(result1.centerOffsetX).toBe(0)
        expect(result1.centerOffsetY).toBe(0)

        // Face rect center at (230, 230) -> Cx=230, ΔX=(230-200)/200 = 0.15
        const result2 = evaluateCentering({ x: 180, y: 180, width: 100, height: 100 }, 400, 400)
        expect(result2.isCentered).toBe(true)
        expect(result2.centerOffsetX).toBe(0.15)
        expect(result2.centerOffsetY).toBe(0.15)
      })

      it('evaluates isCentered=false when face offset exceeds 15% threshold', () => {
        // Cx = 232 -> ΔX = 32/200 = 0.16 > 0.15
        const result = evaluateCentering({ x: 182, y: 150, width: 100, height: 100 }, 400, 400)
        expect(result.isCentered).toBe(false)
        expect(result.centerOffsetX).toBe(0.16)
      })
    })

    describe('2. Brightness Evaluation', () => {
      it('evaluates isLightingGood=false when brightness < 60 (Too Dark)', () => {
        const darkImg = createTestImageData(10, 10, () => [50, 50, 50, 255])
        const result = evaluateBrightness(darkImg)
        expect(result.isLightingGood).toBe(false)
        expect(result.brightnessScore).toBe(50)
      })

      it('evaluates isLightingGood=false when brightness > 210 (Too Bright)', () => {
        const brightImg = createTestImageData(10, 10, () => [220, 220, 220, 255])
        const result = evaluateBrightness(brightImg)
        expect(result.isLightingGood).toBe(false)
        expect(result.brightnessScore).toBe(220)
      })

      it('evaluates isLightingGood=true for brightness in boundary range [60, 210]', () => {
        const lowerBoundImg = createTestImageData(10, 10, () => [60, 60, 60, 255])
        expect(evaluateBrightness(lowerBoundImg).isLightingGood).toBe(true)

        const upperBoundImg = createTestImageData(10, 10, () => [210, 210, 210, 255])
        expect(evaluateBrightness(upperBoundImg).isLightingGood).toBe(true)
      })
    })

    describe('3. Proximity Evaluation', () => {
      it('evaluates isDistanceGood=false when face ratio < 0.25 (Too Far)', () => {
        const result = evaluateProximity({ x: 100, y: 100, width: 90, height: 90 }, 400)
        expect(result.isDistanceGood).toBe(false)
        expect(result.faceRatio).toBe(0.225)
      })

      it('evaluates isDistanceGood=false when face ratio > 0.55 (Too Close)', () => {
        const result = evaluateProximity({ x: 50, y: 50, width: 240, height: 240 }, 400)
        expect(result.isDistanceGood).toBe(false)
        expect(result.faceRatio).toBe(0.6)
      })

      it('evaluates isDistanceGood=true for ratio in boundary range [0.25, 0.55]', () => {
        const minResult = evaluateProximity({ x: 100, y: 100, width: 100, height: 100 }, 400)
        expect(minResult.isDistanceGood).toBe(true)
        expect(minResult.faceRatio).toBe(0.25)

        const maxResult = evaluateProximity({ x: 50, y: 50, width: 220, height: 220 }, 400)
        expect(maxResult.isDistanceGood).toBe(true)
        expect(maxResult.faceRatio).toBe(0.55)
      })
    })

    describe('4. Sharpness Evaluation', () => {
      it('evaluates isSharp=false for flat low-variance images (Blurry)', () => {
        const flatImg = createTestImageData(10, 10, () => [128, 128, 128, 255])
        const result = evaluateSharpness(flatImg)
        expect(result.isSharp).toBe(false)
        expect(result.sharpnessScore).toBe(0)
      })

      it('evaluates isSharp=true for high-contrast checkerboard image (Sharp)', () => {
        const checkerboardImg = createTestImageData(10, 10, (x, y) => {
          const val = (x + y) % 2 === 0 ? 0 : 255
          return [val, val, val, 255]
        })
        const result = evaluateSharpness(checkerboardImg)
        expect(result.isSharp).toBe(true)
        expect(result.sharpnessScore).toBeGreaterThanOrEqual(35.0)
      })
    })

    describe('5. 5-Consecutive Passing Frames Requirement & Counter Reset', () => {
      it('enforces exactly 5 consecutive passing frames before setting overallPassed=true', () => {
        const engine = new QualityEngine()

        const perfectImage = createTestImageData(20, 20, (x, y) => {
          const val = (x + y) % 2 === 0 ? 0 : 255
          return [val, val, val, 255]
        })
        const perfectRect = { x: 5, y: 5, width: 8, height: 8 } // ratio = 0.40, centered

        // Frames 1-4
        for (let frame = 1; frame <= 4; frame++) {
          const metrics = engine.evaluateFrame(perfectImage, perfectRect)
          expect(metrics.isCentered).toBe(true)
          expect(metrics.isLightingGood).toBe(true)
          expect(metrics.isDistanceGood).toBe(true)
          expect(metrics.isSharp).toBe(true)
          expect(metrics.overallPassed).toBe(false)
          expect(metrics.feedbackMessage).toBe('Hold still... verifying quality')
          expect(engine.getPassingFramesCount()).toBe(frame)
        }

        // Frame 5
        const frame5 = engine.evaluateFrame(perfectImage, perfectRect)
        expect(frame5.overallPassed).toBe(true)
        expect(frame5.feedbackMessage).toBe('Perfect! Face quality verified')
        expect(engine.getPassingFramesCount()).toBe(5)
      })

      it('resets counter to 0 if a single frame fails during countdown', () => {
        const engine = new QualityEngine()

        const perfectImage = createTestImageData(20, 20, (x, y) => {
          const val = (x + y) % 2 === 0 ? 0 : 255
          return [val, val, val, 255]
        })
        const darkImage = createTestImageData(20, 20, () => [20, 20, 20, 255])
        const perfectRect = { x: 5, y: 5, width: 8, height: 8 }

        // Pass 3 frames
        engine.evaluateFrame(perfectImage, perfectRect)
        engine.evaluateFrame(perfectImage, perfectRect)
        engine.evaluateFrame(perfectImage, perfectRect)
        expect(engine.getPassingFramesCount()).toBe(3)

        // Interrupted by dark frame
        const failedMetrics = engine.evaluateFrame(darkImage, perfectRect)
        expect(failedMetrics.overallPassed).toBe(false)
        expect(engine.getPassingFramesCount()).toBe(0)
        expect(failedMetrics.feedbackMessage).toBe('Too dark — move to better lighting')

        // Requires full 5 new consecutive frames to pass again
        for (let frame = 1; frame <= 4; frame++) {
          const res = engine.evaluateFrame(perfectImage, perfectRect)
          expect(res.overallPassed).toBe(false)
        }
        const finalFrame = engine.evaluateFrame(perfectImage, perfectRect)
        expect(finalFrame.overallPassed).toBe(true)
      })
    })

    describe('6. HUD Quality Overlay Rendering', () => {
      it('renders pills and feedback message based on metrics state', () => {
        const mockMetrics = {
          isCentered: true,
          isLightingGood: true,
          isDistanceGood: false,
          isSharp: true,
          overallPassed: false,
          brightnessScore: 120,
          sharpnessScore: 50,
          faceRatio: 0.20,
          centerOffsetX: 0,
          centerOffsetY: 0,
          feedbackMessage: 'Move closer to the camera',
        }

        render(<QualityOverlay metrics={mockMetrics} />)

        expect(screen.getByTestId('pill-centering')).toHaveTextContent('✓ Centered')
        expect(screen.getByTestId('pill-lighting')).toHaveTextContent('✓ Lighting OK')
        expect(screen.getByTestId('pill-distance')).toHaveTextContent('○ Move Closer')
        expect(screen.getByTestId('pill-sharpness')).toHaveTextContent('✓ Focus OK')
        expect(screen.getByTestId('feedback-message')).toHaveTextContent('Move closer to the camera')
      })
    })
  })
})
