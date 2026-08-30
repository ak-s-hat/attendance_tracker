import React from 'react'
import { Employee } from '../../app/lib/api'

export interface SuccessModalProps {
  employee: Employee
  onReset: () => void
}

export const SuccessModal: React.FC<SuccessModalProps> = ({
  employee,
  onReset,
}) => {
  return (
    <div className="w-full max-w-lg mx-auto bg-white rounded-2xl p-6 sm:p-8 shadow-2xl border border-slate-100 text-center animate-in fade-in zoom-in-95 duration-200">
      {/* Checkmark Icon Badge */}
      <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-4xl shadow-inner">
        ✓
      </div>

      <h2 className="text-2xl font-bold text-slate-800 mb-1">
        Registration Complete!
      </h2>
      <p className="text-sm text-slate-500 mb-6">
        Face quality verified and enrolled successfully in the attendance database.
      </p>

      {/* Employee Details Card */}
      <div className="bg-slate-50 rounded-xl p-5 border border-slate-200/80 text-left space-y-3 mb-6">
        <div className="flex justify-between items-center pb-2 border-b border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Employee Name
          </span>
          <span data-testid="summary-name" className="text-sm font-bold text-slate-800">
            {employee.name}
          </span>
        </div>

        <div className="flex justify-between items-center pb-2 border-b border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Email Address
          </span>
          <span data-testid="summary-email" className="text-sm font-medium text-slate-700">
            {employee.email}
          </span>
        </div>

        {employee.department && (
          <div className="flex justify-between items-center pb-2 border-b border-slate-200">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Department
            </span>
            <span data-testid="summary-department" className="text-sm font-medium text-slate-700">
              {employee.department}
            </span>
          </div>
        )}

        {employee.job_title && (
          <div className="flex justify-between items-center pb-2 border-b border-slate-200">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Job Title
            </span>
            <span data-testid="summary-job-title" className="text-sm font-medium text-slate-700">
              {employee.job_title}
            </span>
          </div>
        )}

        <div className="flex justify-between items-center pt-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Employee ID
          </span>
          <span data-testid="summary-id" className="text-xs font-mono text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded">
            {employee.id}
          </span>
        </div>
      </div>

      {/* Reset Action Button */}
      <button
        onClick={onReset}
        data-testid="reset-button"
        className="w-full py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-lg transition-all flex items-center justify-center gap-2"
      >
        <span>➕</span> Register Next Employee
      </button>
    </div>
  )
}

export default SuccessModal
