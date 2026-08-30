import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmployeeForm from '../components/registration/EmployeeForm'
import * as api from '../app/lib/api'

// Mock the api module
jest.mock('../app/lib/api', () => ({
  createEmployee: jest.fn(),
}))

describe('EmployeeForm Component Tests', () => {
  const mockOnSubmitSuccess = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders all 5 form input fields and submit button', () => {
    render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/department/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/job title/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /continue to camera setup/i })
    ).toBeInTheDocument()
  })

  it('displays inline validation error for name when submitting empty form', async () => {
    render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

    const submitBtn = screen.getByRole('button', { name: /continue to camera setup/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByTestId('error-name')).toHaveTextContent('Full name is required')
      expect(screen.queryByTestId('error-email')).not.toBeInTheDocument()
    })

    expect(api.createEmployee).not.toHaveBeenCalled()
    expect(mockOnSubmitSuccess).not.toHaveBeenCalled()
  })

  it('submits successfully with name ONLY when email, phone, department, job title are omitted', async () => {
    const createdEmployee: api.Employee = {
      id: 'emp-456',
      name: 'Jane OnlyName',
      email: null,
      phone: null,
      department: null,
      job_title: null,
      is_enrolled: false,
      is_active: true,
    }

    ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(createdEmployee)

    render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

    await userEvent.type(screen.getByLabelText(/full name/i), 'Jane OnlyName')

    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

    await waitFor(() => {
      expect(api.createEmployee).toHaveBeenCalledWith({
        name: 'Jane OnlyName',
        email: undefined,
        phone: undefined,
        department: undefined,
        job_title: undefined,
      })
      expect(mockOnSubmitSuccess).toHaveBeenCalledWith(createdEmployee)
    })
  })

  it('submits successfully with name and phone number', async () => {
    const createdEmployee: api.Employee = {
      id: 'emp-457',
      name: 'Jane WithPhone',
      email: null,
      phone: '+15550192834',
      department: null,
      job_title: null,
      is_enrolled: false,
      is_active: true,
    }

    ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(createdEmployee)

    render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

    await userEvent.type(screen.getByLabelText(/full name/i), 'Jane WithPhone')
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15550192834')

    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

    await waitFor(() => {
      expect(api.createEmployee).toHaveBeenCalledWith({
        name: 'Jane WithPhone',
        email: undefined,
        phone: '+15550192834',
        department: undefined,
        job_title: undefined,
      })
      expect(mockOnSubmitSuccess).toHaveBeenCalledWith(createdEmployee)
    })
  })

  it('displays inline error for invalid email format', async () => {
    render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

    const nameInput = screen.getByLabelText(/full name/i)
    const emailInput = screen.getByLabelText(/email address/i)
    const submitBtn = screen.getByRole('button', { name: /continue to camera setup/i })

    await userEvent.type(nameInput, 'John Doe')
    await userEvent.type(emailInput, 'invalid-email-format')
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByTestId('error-email')).toHaveTextContent('Valid email address is required')
    })

    expect(api.createEmployee).not.toHaveBeenCalled()
  })

  it('submits employee data to API and invokes onSubmitSuccess on success with all fields', async () => {
    const createdEmployee: api.Employee = {
      id: 'emp-123',
      name: 'John Doe',
      email: 'john.doe@company.com',
      phone: '+15550192834',
      department: 'Engineering',
      job_title: 'Software Architect',
      is_enrolled: false,
      is_active: true,
    }

    ;(api.createEmployee as jest.Mock).mockResolvedValueOnce(createdEmployee)

    render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

    await userEvent.type(screen.getByLabelText(/full name/i), 'John Doe')
    await userEvent.type(screen.getByLabelText(/email address/i), 'john.doe@company.com')
    await userEvent.type(screen.getByLabelText(/phone number/i), '+15550192834')
    await userEvent.type(screen.getByLabelText(/department/i), 'Engineering')
    await userEvent.type(screen.getByLabelText(/job title/i), 'Software Architect')

    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

    await waitFor(() => {
      expect(api.createEmployee).toHaveBeenCalledWith({
        name: 'John Doe',
        email: 'john.doe@company.com',
        phone: '+15550192834',
        department: 'Engineering',
        job_title: 'Software Architect',
      })
      expect(mockOnSubmitSuccess).toHaveBeenCalledWith(createdEmployee)
    })
  })

  it('displays API error alert when creation fails', async () => {
    ;(api.createEmployee as jest.Mock).mockRejectedValueOnce({
      response: {
        data: {
          detail: 'Employee with this email already exists',
        },
      },
    })

    render(<EmployeeForm onSubmitSuccess={mockOnSubmitSuccess} />)

    await userEvent.type(screen.getByLabelText(/full name/i), 'John Doe')
    await userEvent.type(screen.getByLabelText(/email address/i), 'existing@company.com')

    fireEvent.click(screen.getByRole('button', { name: /continue to camera setup/i }))

    await waitFor(() => {
      expect(screen.getByTestId('api-error-alert')).toHaveTextContent(
        'Employee with this email already exists'
      )
    })

    expect(mockOnSubmitSuccess).not.toHaveBeenCalled()
  })
})
