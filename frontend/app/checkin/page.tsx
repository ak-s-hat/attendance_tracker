'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { checkIn, getRecentLogs, CheckInResult, RecentLog } from '../lib/api'

export default function CheckinPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [result, setResult] = useState<CheckInResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([])

  // Poll recent logs every 5 seconds
  const fetchLogs = useCallback(async () => {
    try {
      const logs = await getRecentLogs()
      setRecentLogs(logs)
    } catch {}
  }, [])

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [fetchLogs])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCapturedBlob(file)
    setPreviewUrl(URL.createObjectURL(file))
    setResult(null)
  }

  async function handleCheckIn() {
    if (!capturedBlob) return
    setLoading(true)
    setResult(null)
    try {
      const res = await checkIn(capturedBlob)
      setResult(res)
      fetchLogs()
      // Auto-reset after 4 seconds
      setTimeout(() => {
        setResult(null)
        setPreviewUrl(null)
        setCapturedBlob(null)
        if (fileRef.current) fileRef.current.value = ''
      }, 4000)
    } catch (err: any) {
      setResult({ success: false, reason: err.message || 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left: Kiosk */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-6">🎯 Check-In Kiosk</h1>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          {/* Image preview or placeholder */}
          <div
            onClick={() => fileRef.current?.click()}
            className="w-full h-64 bg-slate-100 rounded-xl border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors overflow-hidden"
          >
            {previewUrl ? (
              <img src={previewUrl} alt="Face" className="w-full h-full object-cover rounded-xl" />
            ) : (
              <div className="text-center text-slate-400">
                <div className="text-4xl mb-2">📷</div>
                <p className="text-sm">Click to upload face photo</p>
              </div>
            )}
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

          <button
            onClick={handleCheckIn}
            disabled={!capturedBlob || loading}
            className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-semibold rounded-xl text-lg transition-colors"
          >
            {loading ? 'Processing…' : 'Check In'}
          </button>

          {/* Result card */}
          {result && (
            <div className={`rounded-xl p-4 border ${result.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              {result.success ? (
                <div>
                  <div className="text-2xl font-bold text-emerald-700">{result.employee_name}</div>
                  <div className="text-sm text-emerald-600 mt-1">
                    {result.check_type} • Confidence: {((result.confidence ?? 0) * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-emerald-500 mt-1">{result.timestamp ? formatTime(result.timestamp) : ''}</div>
                </div>
              ) : (
                <div>
                  <div className="text-lg font-semibold text-red-700">
                    {result.reason === 'too_soon' ? '⏱ Already checked in' : '❌ Not recognized'}
                  </div>
                  <div className="text-sm text-red-500 mt-1">{result.reason}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Recent logs */}
      <div>
        <h2 className="text-2xl font-bold text-slate-800 mb-6">📜 Recent Activity</h2>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {recentLogs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No recent activity</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Name', 'Type', 'Time', 'Confidence'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentLogs.slice(0, 10).map((log, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-700">{log.employee_name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${log.check_type === 'CHECK_IN' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                        {log.check_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{log.timestamp ? formatTime(log.timestamp) : '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {log.confidence_score !== null ? `${(log.confidence_score * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
