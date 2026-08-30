'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import EmployeeForm from '../../components/registration/EmployeeForm'
import LiveCameraFeed from '../../components/camera/LiveCameraFeed'
import SuccessModal from '../../components/registration/SuccessModal'
import { Employee, enrollEmployeeFace, validateRegistrationToken } from '../lib/api'
import { QualityMetrics } from '../../components/quality/QualityEngine'

export type TokenStatus = 'VALIDATING' | 'VALID' | 'INVALID'
export type RegisterStep = 'METADATA_INPUT' | 'QUALITY_CHECK' | 'ENROLLING' | 'SUCCESS'

function RegisterPageContent() {
  const searchParams = useSearchParams()
  const token = searchParams ? searchParams.get('token') : null

  const [tokenStatus, setTokenStatus] = useState<TokenStatus>('VALIDATING')
  const [tokenErrorMessage, setTokenErrorMessage] = useState<string | null>(null)

  const [step, setStep] = useState<RegisterStep>('METADATA_INPUT')
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null)
  const [currentMetrics, setCurrentMetrics] = useState<QualityMetrics | null>(null)
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null)
  const [isSubmittingEnrollment, setIsSubmittingEnrollment] = useState(false)

  // Validate Token on Mount
  useEffect(() => {
    let isMounted = true

    async function checkToken() {
      if (!token) {
        if (isMounted) {
          setTokenStatus('INVALID')
          setTokenErrorMessage('No invite token provided in URL.')
        }
        return
      }

      setTokenStatus('VALIDATING')
      const result = await validateRegistrationToken(token)

      if (!isMounted) return

      if (result.valid) {
        setTokenStatus('VALID')
      } else {
        setTokenStatus('INVALID')
        setTokenErrorMessage(result.message || 'Token is invalid or expired.')
      }
    }

    checkToken()

    return () => {
      isMounted = false
    }
  }, [token])

  // Step 1 Success Handler
  const handleMetadataSuccess = (employee: Employee) => {
    setCurrentEmployee(employee)
    setEnrollmentError(null)
    setStep('QUALITY_CHECK')
  }

  // Quality Change Callback
  const handleQualityChange = (metrics: QualityMetrics) => {
    setCurrentMetrics(metrics)
  }

  // Step 2 & 3 Snapshot Capture & Enrollment Handler
  const handleSnapshotCaptured = async (imageBlob: Blob) => {
    if (!currentEmployee) return

    try {
      setIsSubmittingEnrollment(true)
      setStep('ENROLLING')
      setEnrollmentError(null)

      const result = await enrollEmployeeFace(currentEmployee.id, imageBlob)

      if (result.success) {
        setCurrentEmployee({
          ...currentEmployee,
          is_enrolled: true,
        })
        setStep('SUCCESS')
      } else {
        setEnrollmentError(result.message || 'Face enrollment failed.')
        setStep('QUALITY_CHECK')
      }
    } catch (err: any) {
      console.error('Enrollment error:', err)
      let msg = 'Failed to enroll face image. Please ensure face is clearly visible.'
      if (err?.response?.data?.detail) {
        msg = typeof err.response.data.detail === 'string'
          ? err.response.data.detail
          : JSON.stringify(err.response.data.detail)
      } else if (err?.message) {
        msg = err.message
      }
      setEnrollmentError(msg)
      setStep('QUALITY_CHECK')
    } finally {
      setIsSubmittingEnrollment(false)
    }
  }

  // Reset State Controller (Step 4 -> Step 1)
  const handleReset = () => {
    setCurrentEmployee(null)
    setCurrentMetrics(null)
    setEnrollmentError(null)
    setIsSubmittingEnrollment(false)
    setStep('METADATA_INPUT')
  }

  // 1. Loading state during token validation
  if (tokenStatus === 'VALIDATING') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center py-12 px-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <h2 className="text-lg font-bold text-white">Validating Invite Link...</h2>
          <p className="text-xs text-slate-400">Verifying security token with server.</p>
        </div>
      </div>
    )
  }

  // 2. Invalid or Expired Token Dark-Mode Error Card
  if (tokenStatus === 'INVALID') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center py-12 px-4">
        <div
          data-testid="invalid-token-card"
          className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-lg w-full text-center shadow-2xl space-y-5"
        >
          <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-full flex items-center justify-center text-3xl mx-auto">
            🔒
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">
              Invalid or Expired Invite Link
            </h2>
            <p className="text-rose-400 text-sm mt-1 font-medium">
              Please ask an administrator for a new invite link.
            </p>
          </div>
          {tokenErrorMessage && (
            <div className="text-xs text-slate-400 bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 font-mono">
              Reason: {tokenErrorMessage}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 3. Token is VALID — Render Standard Registration Portal Flow
  return (
    <div className="min-h-[80vh] flex flex-col justify-center py-6">
      {/* Page Title Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight sm:text-4xl">
          Web Registration Portal
        </h1>
        <p className="text-slate-500 mt-2 text-sm sm:text-base max-w-xl mx-auto">
          Register new employee metadata and enroll face profile using real-time quality validation.
        </p>
      </div>

      {/* Progress Step Indicator */}
      <div className="max-w-md mx-auto w-full mb-8 px-4">
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-slate-200 -z-0" />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-indigo-600 transition-all duration-300 -z-0"
            style={{
              width:
                step === 'METADATA_INPUT'
                  ? '0%'
                  : step === 'QUALITY_CHECK' || step === 'ENROLLING'
                  ? '50%'
                  : '100%',
            }}
          />

          {/* Step 1 Badge */}
          <div
            data-testid="step-badge-1"
            className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shadow transition-all ${
              step === 'METADATA_INPUT'
                ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                : 'bg-indigo-600 text-white'
            }`}
          >
            1
          </div>

          {/* Step 2 Badge */}
          <div
            data-testid="step-badge-2"
            className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shadow transition-all ${
              step === 'QUALITY_CHECK' || step === 'ENROLLING'
                ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                : step === 'SUCCESS'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-200 text-slate-500'
            }`}
          >
            2
          </div>

          {/* Step 3 Badge */}
          <div
            data-testid="step-badge-3"
            className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shadow transition-all ${
              step === 'SUCCESS'
                ? 'bg-emerald-600 text-white ring-4 ring-emerald-100'
                : 'bg-slate-200 text-slate-500'
            }`}
          >
            ✓
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="w-full max-w-2xl mx-auto px-4">
        {/* Step 1: Employee Metadata Input */}
        {step === 'METADATA_INPUT' && (
          <EmployeeForm onSubmitSuccess={handleMetadataSuccess} />
        )}

        {/* Step 2 & 3: Camera Feed & Enrollment */}
        {(step === 'QUALITY_CHECK' || step === 'ENROLLING') && currentEmployee && (
          <div className="space-y-6">
            {/* Active Employee Info Card */}
            <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">
                  Enrolling Employee
                </div>
                <div data-testid="active-employee-name" className="text-base font-bold text-slate-800">
                  {currentEmployee.name} {currentEmployee.email ? `(${currentEmployee.email})` : ''}
                </div>
              </div>
              <button
                onClick={() => setStep('METADATA_INPUT')}
                disabled={isSubmittingEnrollment}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium underline"
              >
                Edit Info
              </button>
            </div>

            {/* Error Alert Banner */}
            {enrollmentError && (
              <div
                data-testid="enrollment-error-alert"
                className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium"
              >
                {enrollmentError}
              </div>
            )}

            {/* Enrolling Loader Overlay */}
            {step === 'ENROLLING' ? (
              <div className="bg-slate-900 rounded-2xl p-12 text-center text-white space-y-4 border border-slate-800 shadow-2xl">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <h3 className="text-lg font-bold">Uploading Face Profile...</h3>
                <p className="text-sm text-slate-400">
                  Transmitting compressed JPEG snapshot to AI recognition engine.
                </p>
              </div>
            ) : (
              <LiveCameraFeed
                active={step === 'QUALITY_CHECK'}
                onQualityChange={handleQualityChange}
                onSnapshotCaptured={handleSnapshotCaptured}
              />
            )}
          </div>
        )}

        {/* Step 4: Registration Success Dialog */}
        {step === 'SUCCESS' && currentEmployee && (
          <SuccessModal employee={currentEmployee} onReset={handleReset} />
        )}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <RegisterPageContent />
    </Suspense>
  )
}
