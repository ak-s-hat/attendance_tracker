'use client'

import { useState } from 'react'
import { enrollEmployee, enrollFace } from '../lib/api'

type Step = 'form' | 'capture' | 'done'

export default function EnrollPage() {
  const [step, setStep] = useState<Step>('form')
  const [form, setForm] = useState({ name: '', email: '', department: '', job_title: '' })
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const emp = await enrollEmployee(form)
      setEmployeeId(emp.id)
      setStep('capture')
      setStatus(`Employee "${emp.name}" created. Now capture their face.`)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create employee')
    } finally {
      setLoading(false)
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCapturedBlob(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  async function handleEnroll() {
    if (!capturedBlob || !employeeId) return
    setError('')
    setLoading(true)
    try {
      await enrollFace(employeeId, capturedBlob)
      setStep('done')
      setStatus('Face enrolled successfully! This employee can now check in.')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Face enrollment failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Enroll New Employee</h1>

      {/* Progress bar */}
      <div className="flex gap-2 mb-8">
        {(['form', 'capture', 'done'] as Step[]).map((s, i) => (
          <div key={s} className={`flex-1 h-1.5 rounded-full ${step === s || (i < ['form','capture','done'].indexOf(step)) ? 'bg-indigo-500' : 'bg-slate-200'}`} />
        ))}
      </div>

      {status && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-3 mb-4 text-sm">{status}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      {/* Step 1: Employee details */}
      {step === 'form' && (
        <form onSubmit={handleCreateEmployee} className="space-y-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-700 mb-2">Step 1: Employee Details</h2>
          {[
            { key: 'name', label: 'Full Name', required: true },
            { key: 'email', label: 'Email', required: true, type: 'email' },
            { key: 'department', label: 'Department', required: false },
            { key: 'job_title', label: 'Job Title', required: false },
          ].map(({ key, label, required, type }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-slate-600 mb-1">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
              <input
                type={type || 'text'}
                required={required}
                value={(form as any)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
          >
            {loading ? 'Creating…' : 'Create Employee →'}
          </button>
        </form>
      )}

      {/* Step 2: Face capture */}
      {step === 'capture' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <h2 className="font-semibold text-slate-700">Step 2: Capture Face Photo</h2>
          <p className="text-sm text-slate-500">Upload a clear, front-facing photo. The face should be well-lit with no obstructions.</p>

          <label className="block">
            <span className="sr-only">Choose photo</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              onChange={handleFileUpload}
              className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </label>

          {previewUrl && (
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <img src={previewUrl} alt="Face preview" className="w-full max-h-64 object-cover" />
            </div>
          )}

          <button
            onClick={handleEnroll}
            disabled={!capturedBlob || loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium py-2 rounded-lg transition-colors"
          >
            {loading ? 'Enrolling…' : 'Enroll Face ✓'}
          </button>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 'done' && (
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 p-8 text-center space-y-4">
          <div className="text-5xl">✅</div>
          <h2 className="text-xl font-bold text-slate-800">Enrollment Complete!</h2>
          <p className="text-slate-500 text-sm">The employee can now check in using the kiosk.</p>
          <div className="flex gap-3 justify-center pt-2">
            <a href="/employees" className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors">View Employees</a>
            <a href="/checkin" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors">Go to Kiosk</a>
          </div>
        </div>
      )}
    </div>
  )
}
