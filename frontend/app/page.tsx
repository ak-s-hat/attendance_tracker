import Link from 'next/link'

const cards = [
  {
    href: '/register',
    emoji: '📸',
    title: 'Register Employee',
    desc: 'Register metadata and validate face quality with live feedback.',
    color: 'bg-indigo-600 hover:bg-indigo-700',
  },
  {
    href: '/employees',
    emoji: '📋',
    title: 'View Employees',
    desc: 'Browse all employees and check enrollment status.',
    color: 'bg-emerald-600 hover:bg-emerald-700',
  },
  {
    href: '/checkin',
    emoji: '🎯',
    title: 'Check-In Kiosk',
    desc: 'Launch the face recognition check-in terminal.',
    color: 'bg-violet-600 hover:bg-violet-700',
  },
]

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 mt-1">AI-powered face recognition attendance system</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`${card.color} rounded-2xl p-6 text-white shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 block`}
          >
            <div className="text-4xl mb-3">{card.emoji}</div>
            <h2 className="text-xl font-semibold mb-1">{card.title}</h2>
            <p className="text-sm opacity-80 leading-relaxed">{card.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
