import { api } from '../lib/api'
import { useOnce } from '../hooks/usePolling'
import { CardHeader, Alert, KVRow, Spinner, Dot } from './ui'

const PATTERNS = [
  { label: 'Publish-Subscribe',    color: 'var(--blue)',   desc: 'HR events are published to Azure Service Bus queues. The transformer subscribes independently — decoupled from the publisher lifecycle.' },
  { label: 'Request-Reply',        color: 'var(--purple)', desc: 'Gateway REST calls to HR (XML) and Payroll (JSON) use synchronous request-reply for immediate employee lookups via GraphQL resolvers.' },
  { label: 'Dead-Letter Queue',    color: 'var(--red)',    desc: 'Messages failing after 3 retries are moved to Azure\'s /$DeadLetterQueue sub-queue automatically, then mirrored to PostgreSQL.' },
  { label: 'Content-Based Routing',color: 'var(--amber)',  desc: 'GraphQL resolvers route employee queries to the HR XML service and payroll queries to the JSON API, merging the result.' },
  { label: 'Message Transformation',color:'var(--green)',  desc: 'DB-driven field mappings convert XML to JSON. Add a row to field_mappings to handle new fields — no code change required.' },
  { label: 'PGP Payload Signing',  color: 'var(--purple)', desc: '2048-bit RSA keys. The transformer signs all outbound payloads. Subscribers verify the signature before processing.' },
]

export default function Security() {
  const { data: pgp, error, loading, refresh } = useOnce(() => api.pgpInfo())

  const isHealthy = pgp?.hasPublicKey && pgp?.hasPrivateKey

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {error && (
        <Alert type="warning">
          Transformer service is unreachable — PGP status unavailable. {error}
        </Alert>
      )}

      {/* PGP key status */}
      <div className="card fade-in">
        <CardHeader
          title="PGP key status"
          subtitle="2048-bit RSA key pair used for payload signing"
          right={<button className="btn btn-ghost btn-sm" onClick={refresh}>↻ Refresh</button>}
        />
        <div className="card-body">
          {loading ? (
            <div style={{ padding: '8px 0' }}><Spinner size={14} /></div>
          ) : pgp ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: 'var(--bg)', borderRadius: 6, border: `1px solid ${isHealthy ? 'var(--green-border)' : 'var(--red-border)'}` }}>
                  <Dot color={isHealthy ? 'var(--green)' : 'var(--red)'} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: isHealthy ? 'var(--green)' : 'var(--red)' }}>
                    {isHealthy ? 'Key pair active — signing operational' : 'Key pair incomplete'}
                  </span>
                </div>
                <KVRow label="Public key"   value={pgp.hasPublicKey  ? '✓ Present' : '✗ Missing'} />
                <KVRow label="Private key"  value={pgp.hasPrivateKey ? '✓ Present' : '✗ Missing'} />
                <KVRow label="Key email"    value={pgp.email} />
                <KVRow label="Expires"      value={pgp.expires || 'Never'} />
                <KVRow label="Fingerprint"  value={pgp.fingerprint ? pgp.fingerprint.slice(0, 16) + '...' : '—'} mono />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                  Signing flow
                </div>
                {[
                  ['Transformer', 'signs the outbound JSON payload', 'var(--blue)'],
                  ['Azure Service Bus', 'signed message travels through queues', 'var(--text-3)'],
                  ['Subscriber', 'verifies signature before processing', 'var(--green)'],
                  ['PostgreSQL', 'records pgp_signed = true in audit log', 'var(--purple)'],
                ].map(([label, note, c], i, arr) => (
                  <div key={label} style={{ display: 'flex', gap: 12, position: 'relative' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, border: `2px solid ${c}`, marginTop: 3 }} />
                      {i < arr.length - 1 && <div style={{ width: 1, height: 24, background: 'var(--border)', marginTop: 2 }} />}
                    </div>
                    <div style={{ paddingBottom: i < arr.length - 1 ? 16 : 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{label}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 8 }}>{note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>
              Unable to connect to transformer service. Ensure it is running.
            </div>
          )}
        </div>
      </div>

      {/* API key config */}
      <div className="card fade-in">
        <CardHeader title="API key authentication" subtitle="Gateway access control and rate limiting" />
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginTop: 0, marginBottom: 14 }}>
                All gateway endpoints except <Code>/health</Code> require an <Code>x-api-key</Code> header.
                Keys are loaded from the <Code>API_KEYS</Code> environment variable (comma-separated).
              </p>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.8 }}>
                <span style={{ color: 'var(--text-3)' }}># Example request</span><br />
                <span style={{ color: 'var(--text-2)' }}>curl</span>{' '}
                <span style={{ color: 'var(--green)' }}>-H "x-api-key: dev-key-1234"</span>{' \\\n  '}
                <span style={{ color: 'var(--blue)' }}>http://localhost:3000/api/employees</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Read endpoints', limit: '100 requests / minute', color: 'var(--green)' },
                { label: 'Write / sync endpoints', limit: '20 requests / minute', color: 'var(--amber)' },
              ].map(r => (
                <div key={r.label} style={{
                  padding: '12px 14px', background: 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: 6,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: r.color }}>{r.limit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Integration patterns */}
      <div className="card fade-in">
        <CardHeader title="Integration patterns" subtitle="Architectural patterns implemented in this project" />
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {PATTERNS.map(p => (
              <div key={p.label} style={{
                padding: '14px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 6,
                borderLeft: `3px solid ${p.color}`
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>{p.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  )
}

function Code({ children }) {
  return (
    <code style={{
      fontFamily: 'var(--mono)', fontSize: 11,
      background: 'var(--bg-hover)', color: 'var(--blue)',
      border: '1px solid var(--border)',
      borderRadius: 3, padding: '1px 5px'
    }}>{children}</code>
  )
}