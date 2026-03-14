export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>
}

export function StatCard({ label, value, sub, valueColor, icon }) {
  return (
    <div className="stat-card fade-in">
      <div className="stat-label">
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>
        {value ?? '—'}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function CardHeader({ title, subtitle, right }) {
  return (
    <div className="card-header">
      <div>
        <div className="card-title">{title}</div>
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>}
    </div>
  )
}

export function Spinner({ size = 16 }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}

export function PageSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64 }}>
      <Spinner size={22} />
    </div>
  )
}

export function SkeletonRows({ cols = 5, rows = 5 }) {
  const widths = [70, 110, 90, 60, 80]
  return Array(rows).fill(0).map((_, i) => (
    <tr key={i}>
      {Array(cols).fill(0).map((_, j) => (
        <td key={j} style={{ padding: '9px 14px' }}>
          <div className="skeleton" style={{ height: 11, width: widths[j % widths.length] }} />
        </td>
      ))}
    </tr>
  ))
}

export function EmptyState({ title = 'No data', desc }) {
  return (
    <div style={{ padding: '48px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{desc}</div>}
    </div>
  )
}

export function Alert({ type = 'info', children }) {
  return <div className={`alert alert-${type}`}>{children}</div>
}

export function Dot({ color = 'var(--green)' }) {
  return (
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
  )
}

export function KVRow({ label, value, mono }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderBottom: '1px solid var(--border)', gap: 24
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: mono ? 'var(--mono)' : undefined, textAlign: 'right', wordBreak: 'break-all' }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

export function SectionDivider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div className="divider" style={{ flex: 1 }} />
    </div>
  )
}