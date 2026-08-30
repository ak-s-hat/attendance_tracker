import React, { useState } from 'react'
import { createEmployee, Employee } from '../../app/lib/api'

export interface EmployeeFormProps {
  onSubmitSuccess: (employee: Employee) => void
  isLoading?: boolean
}

export const EmployeeForm: React.FC<EmployeeFormProps> = ({
  onSubmitSuccess,
  isLoading = false,
}) => {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [department, setDepartment] = useState('')
  const [jobTitle, setJobTitle] = useState('')

  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validateForm = (): boolean => {
    const newErrors: { name?: string; email?: string } = {}

    if (!name.trim()) {
      newErrors.name = 'Full name is required'
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (email.trim().length > 0 && !emailRegex.test(email.trim())) {
      newErrors.email = 'Valid email address is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setApiError(null)

    if (!validateForm()) {
      return
    }

    try {
      setIsSubmitting(true)
      const newEmployee = await createEmployee({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        department: department.trim() || undefined,
        job_title: jobTitle.trim() || undefined,
      })
      onSubmitSuccess(newEmployee)
    } catch (err: any) {
      console.error('Employee creation error:', err)
      let msg = 'Failed to create employee. Please try again.'
      if (err?.response?.data?.detail) {
        msg = typeof err.response.data.detail === 'string'
          ? err.response.data.detail
          : JSON.stringify(err.response.data.detail)
      } else if (err?.message) {
        msg = err.message
      }
      setApiError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto bg-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-100">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Employee Details</h2>
        <p className="text-sm text-slate-500 mt-1">
          Enter employee information to start the face enrollment process.
        </p>
      </div>

      {apiError && (
        <div
          data-testid="api-error-alert"
          className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium"
        >
          {apiError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Name Input */}
        <div>
          <label htmlFor="employee-name" className="block text-sm font-medium text-slate-700 mb-1">
            Full Name <span className="text-rose-500">*</span>
          </label>
          <input
            id="employee-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jane Doe"
            disabled={isSubmitting || isLoading}
            className={`w-full px-4 py-2.5 rounded-xl border text-slate-800 text-sm outline-none transition-all ${
              errors.name
                ? 'border-rose-400 focus:ring-2 focus:ring-rose-200'
                : 'border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
            }`}
          />
          {errors.name && (
            <p data-testid="error-name" className="mt-1 text-xs text-rose-500 font-medium">
              {errors.name}
            </p>
          )}
        </div>

        {/* Email Input */}
        <div>
          <label htmlFor="employee-email" className="block text-sm font-medium text-slate-700 mb-1">
            Email Address <span className="text-xs text-slate-400 font-normal">(Optional)</span>
          </label>
          <input
            id="employee-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. jane.doe@company.com"
            disabled={isSubmitting || isLoading}
            className={`w-full px-4 py-2.5 rounded-xl border text-slate-800 text-sm outline-none transition-all ${
              errors.email
                ? 'border-rose-400 focus:ring-2 focus:ring-rose-200'
                : 'border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
            }`}
          />
          {errors.email && (
            <p data-testid="error-email" className="mt-1 text-xs text-rose-500 font-medium">
              {errors.email}
            </p>
          )}
        </div>

        {/* Phone Input */}
        <div>
          <label htmlFor="employee-phone" className="block text-sm font-medium text-slate-700 mb-1">
            Phone Number <span className="text-xs text-slate-400 font-normal">(Optional)</span>
          </label>
          <input
            id="employee-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. +1 (555) 019-2834"
            disabled={isSubmitting || isLoading}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </div>

        {/* Department Input */}
        <div>
          <label htmlFor="employee-department" className="block text-sm font-medium text-slate-700 mb-1">
            Department <span className="text-xs text-slate-400 font-normal">(Optional)</span>
          </label>
          <input
            id="employee-department"
            type="text"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. Engineering"
            disabled={isSubmitting || isLoading}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </div>

        {/* Job Title Input */}
        <div>
          <label htmlFor="employee-job-title" className="block text-sm font-medium text-slate-700 mb-1">
            Job Title <span className="text-xs text-slate-400 font-normal">(Optional)</span>
          </label>
          <input
            id="employee-job-title"
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="e.g. Software Engineer"
            disabled={isSubmitting || isLoading}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || isLoading}
          className="w-full py-3 px-6 mt-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2"
        >
          {isSubmitting || isLoading ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating Record...
            </>
          ) : (
            'Continue to Camera Setup →'
          )}
        </button>
      </form>
    </div>
  )
}

export default EmployeeForm
