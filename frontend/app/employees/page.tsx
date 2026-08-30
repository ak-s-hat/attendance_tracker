'use client'

import { useEffect, useState } from 'react'
import { getEmployees, Employee } from '../lib/api'
import Link from 'next/link'

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getEmployees()
      .then(setEmployees)
      .catch(() => setError('Failed to load employees. Is the backend running?'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Employees</h1>
          <p className="text-slate-500 text-sm mt-0.5">{employees.length} active employee{employees.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/enroll" className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          + Enroll New
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400">Loading…</div>
      ) : employees.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <div className="text-4xl mb-3">👥</div>
          <p className="text-slate-500">No employees yet.</p>
          <Link href="/enroll" className="mt-4 inline-block text-indigo-600 hover:underline text-sm">Enroll the first employee →</Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Email', 'Department', 'Job Title', 'Enrolled', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map(emp => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{emp.name}</td>
                  <td className="px-4 py-3 text-slate-500">{emp.email}</td>
                  <td className="px-4 py-3 text-slate-500">{emp.department || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{emp.job_title || '—'}</td>
                  <td className="px-4 py-3">
                    {emp.is_enrolled ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">✓ Yes</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">⚠ No</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!emp.is_enrolled && (
                      <Link href="/enroll" className="text-indigo-600 hover:underline text-xs">Enroll Face</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
