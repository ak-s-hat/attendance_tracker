import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Attendance Tracker',
  description: 'AI-powered face recognition attendance system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        <nav className="bg-indigo-700 text-white shadow-lg">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-8">
            <span className="font-bold text-lg tracking-tight">📋 Attendance Tracker</span>
            <a href="/" className="text-indigo-200 hover:text-white transition-colors text-sm">Dashboard</a>
            <a href="/register" className="text-indigo-200 hover:text-white transition-colors text-sm">Register</a>
            <a href="/employees" className="text-indigo-200 hover:text-white transition-colors text-sm">Employees</a>
            <a href="/enroll" className="text-indigo-200 hover:text-white transition-colors text-sm">Enroll (Legacy)</a>
            <a href="/checkin" className="text-indigo-200 hover:text-white transition-colors text-sm">Kiosk</a>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
