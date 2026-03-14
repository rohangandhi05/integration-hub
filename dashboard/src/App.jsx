import { useState } from 'react'
import { usePolling } from './hooks/usePolling'
import { api } from './lib/api'
import Overview    from './components/Overview'
import Employees   from './components/Employees'
import DeadLetters from './components/DeadLetters'
import Security    from './components/Security'

const NAV = [
  {
    label: 'Monitoring',
    items: [
      { id: 'overview',     label: 'Overview',     icon: '◈' },
      { id: 'employees',    label: 'Employees',    icon: '◉' },
    ]
  },
  {
    label: 'Operations',
    items: [
      { id: 'dead-letters', label: 'Dead Letters', icon: '⚠', badge: true },
      { id: 'security',     label: 'Security',     icon: '⬡' },
    ]
  },
]

const PAGES = {
  overview:      { component: Overview,    title: 'Overview',      desc: 'System health, event volume and recent activity' },
  employees:     { component: Employees,   title: 'Employees',     desc: 'Browse HR records and trigger sync to payroll' },
  'dead-letters':{ component: DeadLetters, title: 'Dead Letters',  desc: 'Review and resolve failed messages' },
  security:      { component: Security,    title: 'Security',      desc: 'PGP signing, API keys and integration patterns' },
}

export default function App() {
  const [tab, setTab] = useState('overview')
  const { data: deadLetters } = usePolling(() => api.deadLetters(), 30000)
  const dlCount = (deadLetters || []).length

  const { component: Page, title, desc } = PAGES[tab]

  return (
    <div className="app-shell">

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">IH</div>
          <div>
            <div className="brand-name">Integration Hub</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>HR ↔ Payroll Broker</div>
          </div>
        </div>

        <div style={{ flex: 1, padding: '8px 0' }}>
          {NAV.map(section => (
            <div key={section.label} className="nav-section" style={{ padding: '8px 8px 4px' }}>
              <div className="sidebar-label">{section.label}</div>
              {section.items.map(item => (
                <button
                  key={item.id}
                  className={`nav-item ${tab === item.id ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                  {item.badge && dlCount > 0 && (
                    <span className="nav-badge">{dlCount}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>v1.0.0</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Node.js · Python · Azure SB · PostgreSQL
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-scroll">

        {/* Page topbar */}
        <div style={{
          padding: '14px 28px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-raised)',
          position: 'sticky', top: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{desc}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LiveIndicator />
          </div>
        </div>

        {/* Page */}
        <div className="page">
          <Page />
        </div>
      </div>

    </div>
  )
}

function LiveIndicator() {
  const { data: health } = usePolling(() => api.health(), 15000)
  const allOk = health?.status === 'ok'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 99,
      background: allOk ? 'var(--green-bg)' : health ? 'var(--red-bg)' : 'var(--bg)',
      border: `1px solid ${allOk ? 'var(--green-border)' : health ? 'var(--red-border)' : 'var(--border)'}`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: allOk ? 'var(--green)' : health ? 'var(--red)' : 'var(--text-3)',
      }} />
      <span style={{ fontSize: 11, fontWeight: 500, color: allOk ? 'var(--green)' : health ? 'var(--red)' : 'var(--text-3)' }}>
        {!health ? 'Connecting...' : allOk ? 'All systems operational' : 'Degraded'}
      </span>
    </div>
  )
}