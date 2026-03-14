import { useState } from 'react'
import { api } from '../lib/api'
import { useOnce } from '../hooks/usePolling'
import { CardHeader, PageSpinner, SkeletonRows, EmptyState, Alert, KVRow, Spinner } from './ui'

const DEPT_COLORS = {
  Engineering: 'var(--blue)',
  Product:     'var(--purple)',
  Finance:     'var(--amber)',
}

export default function Employees() {
  const { data, error, loading, refresh } = useOnce(() => api.employees())
  const [syncing, setSyncing] = useState({})
  const [toast, setToast]     = useState(null)
  const [selected, setSelected] = useState(null)
  const [search, setSearch]   = useState('')

  function notify(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function syncOne(id, e) {
    e.stopPropagation()
    setSyncing(s => ({ ...s, [id]: true }))
    try {
      const r = await api.syncEmployee(id)
      notify(`${id} synced — event published: ${r.published}`)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSyncing(s => ({ ...s, [id]: false }))
    }
  }

  async function syncAll() {
    setSyncing({ __all: true })
    try {
      await api.syncAll()
      notify('Full sync triggered in background')
      setTimeout(refresh, 1500)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSyncing({})
    }
  }

  const employees = (data?.data || []).filter(e =>
    !search || [e.name, e.department, e.id, e.location].join(' ').toLowerCase().includes(search)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {error && <Alert type="error">{error}</Alert>}
      {toast && <Alert type={toast.type}>{toast.msg}</Alert>}

      <div className="card fade-in">
        <CardHeader
          title="Employees"
          subtitle="HR records from mock-hr service (XML source)"
          right={
            <>
              <input
                className="input"
                placeholder="Search name, department, ID..."
                value={search}
                onChange={e => setSearch(e.target.value.toLowerCase())}
                style={{ width: 220 }}
              />
              <button className="btn btn-ghost btn-sm" onClick={refresh}>↻</button>
              <button className="btn btn-primary btn-sm" onClick={syncAll} disabled={syncing.__all}>
                {syncing.__all ? <><Spinner size={12} /> Syncing...</> : '↑ Sync all to payroll'}
              </button>
            </>
          }
        />

        <div className="table-wrap">
          <table className="data-table clickable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Department</th>
                <th>Location</th>
                <th>Status</th>
                <th>Base salary</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <SkeletonRows cols={7} rows={6} /> :
               employees.length === 0 ? (
                <tr><td colSpan={7}><EmptyState title="No employees found" desc="Try a different search term" /></td></tr>
               ) : employees.map(e => (
                <>
                  <tr key={e.id} onClick={() => setSelected(selected === e.id ? null : e.id)}
                    style={{ background: selected === e.id ? 'var(--bg-active)' : undefined }}>
                    <td><span className="mono" style={{ color: 'var(--blue)' }}>{e.id}</span></td>
                    <td style={{ fontWeight: 500 }}>{e.name}</td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 12, color: DEPT_COLORS[e.department] || 'var(--text-2)'
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: DEPT_COLORS[e.department] || 'var(--text-3)', flexShrink: 0 }} />
                        {e.department}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{e.location}</td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4,
                        background: e.status === 'active' ? 'var(--green-bg)' : 'var(--amber-bg)',
                        color: e.status === 'active' ? 'var(--green)' : 'var(--amber)',
                        border: `1px solid ${e.status === 'active' ? 'var(--green-border)' : 'var(--amber-border)'}`,
                      }}>{e.status}</span>
                    </td>
                    <td style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {e.salary ? `$${e.salary.toLocaleString()} CAD` : '—'}
                    </td>
                    <td onClick={ev => ev.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" onClick={ev => syncOne(e.id, ev)} disabled={syncing[e.id]}>
                        {syncing[e.id] ? <Spinner size={11} /> : '↑ Sync'}
                      </button>
                    </td>
                  </tr>
                  {selected === e.id && (
                    <tr key={`${e.id}-detail`}>
                      <td colSpan={7} style={{ padding: 0, background: 'var(--bg)' }}>
                        <EmployeeDetail id={e.id} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)' }}>
            {employees.length} employee{employees.length !== 1 ? 's' : ''}{search ? ' matching filter' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function EmployeeDetail({ id }) {
  const { data, loading } = useOnce(() => api.employee(id))

  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
      {loading ? (
        <div style={{ padding: '16px 0' }}><Spinner size={14} /></div>
      ) : data ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              HR record — XML source
            </div>
            {[['Employee ID', data.id, true], ['Full name', data.name], ['Department', data.department],
              ['Start date', data.startDate], ['Status', data.status], ['Location', data.location],
              ['Manager', data.manager]].map(([l, v, m]) => (
              <KVRow key={l} label={l} value={v} mono={m} />
            ))}
          </div>
          {data.payroll ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Payroll record — JSON source
              </div>
              {[['Base salary', data.payroll.baseSalary ? `$${data.payroll.baseSalary.toLocaleString()} ${data.payroll.currency}` : null],
                ['Pay frequency', data.payroll.payFrequency], ['Tax code', data.payroll.taxCode, true],
                ['Next pay date', data.payroll.nextPayDate], ['YTD gross', data.payroll.ytdGross ? `$${data.payroll.ytdGross.toLocaleString()}` : null],
                ['YTD tax', data.payroll.ytdTax ? `$${data.payroll.ytdTax.toLocaleString()}` : null]].map(([l, v, m]) => (
                <KVRow key={l} label={l} value={v} mono={m} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              No payroll record found for this employee
            </div>
          )}
        </div>
      ) : (
        <span style={{ color: 'var(--red)', fontSize: 12 }}>Failed to load employee detail</span>
      )}
    </div>
  )
}