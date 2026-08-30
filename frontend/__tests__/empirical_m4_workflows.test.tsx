import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RegisterPage from '../app/register/page'
import EmployeeForm from '../components/registration/EmployeeForm'
import { QualityEngine } from '../components/quality/QualityEngine'
import * as api from '../app/lib/api'

jest.mock('../app/lib/api', () => ({
  createEmployee: jest.fn(),
  enrollEmployeeFace: jest.fn(),
  validateRegistrationToken: jest.fn(),
}))

const mockGetQueryParam = jest.fn()
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockGetQueryParam(key),
  }),
}))

describe('Milestone 4 Challenger Empirical Verification - Web Registration & Quality Engine', () => {
  let mockStream: MediaStream

  beforeEach(() => {
    jest.clearAllMocks()
    mockStream = {
      getTracks: () => [{ stop: jest.fn(), kind: 'video' } as unknown as MediaStreamTrack],
    } as unknown as MediaStream

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: jest.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    })
  })

  test('1. Web Registration Flow: 4-step wizard & state machine transition', async () => {
    mockGetQueryParam.mockReturnValue('valid-test-token')
    ;(api.validateRegistrationToken as jest.Mock).mockResolvedValueOnce({
      valid: true,
      message: 'Token is valid',
    })

    const createdEmp: api.Employee = {
      id: 'emp-uuid-m4',
      name: 'Empirical Tester',
      email: null,
      phone: null,
      department: null,
      job_title: null,
      is_enrolled: false,
      is_active: true,
    }

    ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(createdEmp)
    ;(api.enrollEmployeeFace as jest.Mock).mockResolvedValueOnce({
      success: true,
      message: 'Face enrolled successfully',
    })

    render(<RegisterPage />)

    // Step 1 Check
    await waitFor(() => {
      expect(screen.getByTestId('step-badge-1')).toBeInTheDocument()
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
    })

    // Fill only required name
    await userEvent.type(screen.getByLabelText(/full name/i), 'Empirical Tester')
    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

    // Step 2 Check (QUALITY_CHECK)
    await waitFor(() => {
      expect(screen.getByTestId('step-badge-2')).toBeInTheDocument()
      expect(screen.getByTestId('active-employee-name')).toHaveTextContent('Empirical Tester')
    })

    // Trigger capture
    const captureBtn = await screen.findByTestId('capture-button')
    captureBtn.removeAttribute('disabled')
    fireEvent.click(captureBtn)

    // Step 3 & 4 Check (SUCCESS Modal)
    await waitFor(() => {
      expect(screen.getByTestId('step-badge-3')).toBeInTheDocument()
      expect(screen.getByText(/registration complete!/i)).toBeInTheDocument()
      expect(screen.getByTestId('summary-name')).toHaveTextContent('Empirical Tester')
      expect(screen.getByTestId('summary-id')).toHaveTextContent('emp-uuid-m4')
    })

    // Auto Reset controller via button
    fireEvent.click(screen.getByTestId('reset-button'))
    await waitFor(() => {
      expect(screen.getByLabelText(/full name/i)).toHaveValue('')
    })
  })

  test('2. Web Registration Flow: Name required, email/phone/dept/job optional', async () => {
    const mockSuccess = jest.fn()
    const createdEmp: api.Employee = {
      id: 'emp-name-only',
      name: 'Name Only',
      email: null,
      phone: null,
      department: null,
      job_title: null,
      is_enrolled: false,
      is_active: true,
    }
    ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(createdEmp)

    render(<EmployeeForm onSubmitSuccess={mockSuccess} />)

    // Empty submit triggers name required error
    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))
    await waitFor(() => {
      expect(screen.getByTestId('error-name')).toHaveTextContent('Full name is required')
    })

    // Type name only and submit
    await userEvent.type(screen.getByLabelText(/full name/i), 'Name Only')
    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

    await waitFor(() => {
      expect(api.createEmployee).toHaveBeenCalledWith({
        name: 'Name Only',
        email: undefined,
        phone: undefined,
        department: undefined,
        job_title: undefined,
      })
      expect(mockSuccess).toHaveBeenCalledWith(createdEmp)
    })
  })

  test('3. Real-time Quality Feedback Engine before submission', () => {
    const engine = new QualityEngine()

    // Test dark image frame (brightness score < 60)
    const darkPixels = new Uint8ClampedArray(320 * 240 * 4)
    for (let i = 0; i < darkPixels.length; i += 4) {
      darkPixels[i] = 10     // R
      darkPixels[i + 1] = 10 // G
      darkPixels[i + 2] = 10 // B
      darkPixels[i + 3] = 255
    }
    const darkImageData = new ImageData(darkPixels, 320, 240)
    const darkMetrics = engine.evaluateFrame(darkImageData)

    expect(darkMetrics.isLightingGood).toBe(false)
    expect(darkMetrics.overallPassed).toBe(false)
    expect(darkMetrics.feedbackMessage).toContain('Too dark')

    // Test passing frame metrics sequence
    engine.reset()
    const validPixels = new Uint8ClampedArray(320 * 240 * 4)
    for (let i = 0; i < validPixels.length; i += 4) {
      // Add a grid pattern to create sharp edges for Laplacian score
      const pixelIdx = i / 4
      const x = pixelIdx % 320
      const y = Math.floor(pixelIdx / 320)
      const val = (x % 4 === 0 || y % 4 === 0) ? 200 : 80
      validPixels[i] = val
      validPixels[i + 1] = val
      validPixels[i + 2] = val
      validPixels[i + 3] = 255
    }
    const validImageData = new ImageData(validPixels, 320, 240)

    let metrics
    for (let f = 0; f < 5; f++) {
      metrics = engine.evaluateFrame(validImageData)
    }

    expect(metrics?.overallPassed).toBe(true)
    expect(metrics?.feedbackMessage).toBe('Perfect! Face quality verified')
  })
})
