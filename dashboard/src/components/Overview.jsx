import { api } from '../lib/api'
import { usePolling } from '../hooks/usePolling'
import { StatCard, CardHeader, PageSpinner, SkeletonRows, StatusBadge, Alert, Dot } from './ui'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

function fmtHour(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:00`
}

export default function Overview() {
  const { data, error, loading, refresh } = usePolling(() => api.stats(), 8000)
  const { data: events, loading: evLoading } = usePolling(() => api.events(20), 8000)
  const { data: health } = usePolling(() => api.health(), 12000)

  const s = data?.stats || {}
  const total   = parseInt(s.total_count)   || 0
  const success = parseInt(s.success_count) || 0
  const rate    = total > 0 ? Math.round((success / total) * 100) : 0

  const timeline = (data?.timeline || []).map(t => ({
    hour:    fmtHour(t.hour),
    success: parseInt(t.success) || 0,
    failed:  parseInt(t.failed)  || 0,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {error && <Alert type="error">Failed to load stats: {error}</Alert>}

      {/* System health row */}
      <div className="card fade-in">
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            System status
          </span>
          <div className="divider" style={{ width: 1, height: 14, background: 'var(--border)' }} />
          {health?.checks ? Object.entries(health.checks).map(([svc, st]) => (
            <div key={svc} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color={st === 'ok' ? 'var(--green)' : 'var(--red)'} />
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {svc.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            </div>
          )) : (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>checking...</span>
          )}
          {health && (
            <>
              <div className="divider" style={{ width: 1, height: 14, background: 'var(--border)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Dot color={health.azureServiceBus ? 'var(--green)' : 'var(--amber)'} />
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  Azure Service Bus {health.azureServiceBus ? '— connected' : '— local mode'}
                </span>
              </div>
            </>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={refresh}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid fade-in">
        <StatCard label="Total events"  value={s.total_count ?? '—'} sub={`${s.last_24h || 0} in last 24 hours`} />
        <StatCard label="Success rate"  value={`${rate}%`} sub={`${success.toLocaleString()} succeeded`} valueColor={rate >= 90 ? 'var(--green)' : rate >= 70 ? 'var(--amber)' : 'var(--red)'} />
        <StatCard label="Failed"        value={s.failed_count ?? '—'} sub={`${s.dead_letter_count || 0} dead-lettered`} valueColor={parseInt(s.failed_count) > 0 ? 'var(--red)' : undefined} />
        <StatCard label="Last hour"     value={s.last_hour ?? '—'} sub="events processed" />
      </div>

      {/* Chart */}
      <div className="card fade-in">
        <CardHeader title="Event volume — last 24 hours"
          subtitle="Success and failure counts by hour"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {[['var(--green)','Success'],['var(--red)','Failed']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 10, height: 2, background: c, borderRadius: 1 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{l}</span>
                </div>
              ))}
            </div>
          }
        />
        <div className="card-body">
          {timeline.length === 0 ? (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              No data yet — trigger a sync to populate
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--green)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gF" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--red)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--red)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font)' }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="success" stroke="var(--green)" fill="url(#gS)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="failed"  stroke="var(--red)"   fill="url(#gF)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent events */}
      <div className="card fade-in">
        <CardHeader title="Recent events" subtitle="Latest integration activity" />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Target</th>
                <th>Event type</th>
                <th>Status</th>
                <th>PGP signed</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {evLoading ? <SkeletonRows cols={6} rows={5} /> :
               !(events?.length) ? (
                <tr><td colSpan={6} style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                  No events yet — run a sync to generate activity
                </td></tr>
               ) : events.map(e => (
                <tr key={e.id}>
                  <td><span className="mono" style={{ color: 'var(--blue)' }}>{e.source_service}</span></td>
                  <td style={{ color: 'var(--text-2)' }}>{e.target_service}</td>
                  <td style={{ color: 'var(--text-2)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.event_type}
                  </td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>
                    {e.pgp_signed
                      ? <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Yes</span>
                      : <span style={{ fontSize: 12, color: 'var(--text-3)' }}>No</span>}
                  </td>
                  <td style={{ color: 'var(--text-3)', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}