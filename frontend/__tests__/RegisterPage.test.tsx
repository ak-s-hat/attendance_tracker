import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RegisterPage from '../app/register/page'
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

describe('RegisterPage Integration Tests with Token Validation', () => {
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

  it('displays dark-mode error card when token query param is missing', async () => {
    mockGetQueryParam.mockReturnValue(null)

    render(<RegisterPage />)

    await waitFor(() => {
      expect(screen.getByTestId('invalid-token-card')).toBeInTheDocument()
      expect(screen.getByText(/Invalid or Expired Invite Link/i)).toBeInTheDocument()
      expect(
        screen.getByText(/Please ask an administrator for a new invite link/i)
      ).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument()
  })

  it('displays dark-mode error card when token is expired or invalid', async () => {
    mockGetQueryParam.mockReturnValue('expired-token-123')
    ;(api.validateRegistrationToken as jest.Mock).mockResolvedValueOnce({
      valid: false,
      message: 'Registration token has expired',
    })

    render(<RegisterPage />)

    await waitFor(() => {
      expect(screen.getByTestId('invalid-token-card')).toBeInTheDocument()
      expect(screen.getByText(/Invalid or Expired Invite Link/i)).toBeInTheDocument()
      expect(screen.getByText(/Reason: Registration token has expired/i)).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument()
  })

  it('orchestrates 4-step registration wizard when token is valid', async () => {
    mockGetQueryParam.mockReturnValue('valid-token-xyz')
    ;(api.validateRegistrationToken as jest.Mock).mockResolvedValueOnce({
      valid: true,
      message: 'Token is valid',
    })

    const mockEmployee: api.Employee = {
      id: 'emp-uuid-999',
      name: 'Alice Smith',
      email: 'alice.smith@company.com',
      phone: '+15550192834',
      department: 'AI Research',
      job_title: 'Lead Scientist',
      is_enrolled: false,
      is_active: true,
    }

    ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(mockEmployee)
    ;(api.enrollEmployeeFace as jest.Mock).mockResolvedValueOnce({
      success: true,
      message: 'Face enrolled successfully',
      employee_id: 'emp-uuid-999',
    })

    render(<RegisterPage />)

    // Step 1: Check initial step state after token validation
    await waitFor(() => {
      expect(screen.getByTestId('step-badge-1')).toBeInTheDocument()
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
    })

    // Fill form and submit
    await userEvent.type(screen.getByLabelText(/full name/i), 'Alice Smith')
    await userEvent.type(screen.getByLabelText(/email address/i), 'alice.smith@company.com')
    await userEvent.type(screen.getByLabelText(/department/i), 'AI Research')
    await userEvent.type(screen.getByLabelText(/job title/i), 'Lead Scientist')

    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

    // Step 2: Transitions to QUALITY_CHECK
    await waitFor(() => {
      expect(screen.getByTestId('active-employee-name')).toHaveTextContent('Alice Smith')
      expect(screen.getByTestId('live-camera-video')).toBeInTheDocument()
    })

    // Trigger capture snapshot button in LiveCameraFeed (mocking pass)
    await waitFor(() => {
      expect(screen.getByTestId('capture-button')).toBeInTheDocument()
    })
    const captureButton = screen.getByTestId('capture-button')
    captureButton.removeAttribute('disabled')

    fireEvent.click(captureButton)

    // Step 3 & 4: Transitions to SUCCESS modal
    await waitFor(() => {
      expect(api.enrollEmployeeFace).toHaveBeenCalledWith('emp-uuid-999', expect.any(Blob))
      expect(screen.getByText(/registration complete!/i)).toBeInTheDocument()
      expect(screen.getByTestId('summary-name')).toHaveTextContent('Alice Smith')
      expect(screen.getByTestId('summary-email')).toHaveTextContent('alice.smith@company.com')
      expect(screen.getByTestId('summary-id')).toHaveTextContent('emp-uuid-999')
    })

    // Reset button resets state back to Step 1
    const resetBtn = screen.getByTestId('reset-button')
    fireEvent.click(resetBtn)

    await waitFor(() => {
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/full name/i)).toHaveValue('')
    })
  })
})
