const express = require('express');
const cors = require('cors');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { json } = require('body-parser');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

const { typeDefs, resolvers } = require('./schema');
const { apiKeyAuth, rateLimiter, writeRateLimiter } = require('./auth');
const { publishHREvent, publishPayrollEvent } = require('./servicebus');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HR_URL = process.env.MOCK_HR_URL || 'http://mock-hr:3001';
const PAYROLL_URL = process.env.MOCK_PAYROLL_URL || 'http://mock-payroll:3002';
const TRANSFORMER_URL = process.env.TRANSFORMER_URL || 'http://transformer:8000';

app.use(cors());
app.use(rateLimiter);

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const checks = {};
  try { await db.query('SELECT 1'); checks.postgres = 'ok'; }
  catch { checks.postgres = 'error'; }

  try {
    const r = await fetch(`${HR_URL}/health`, { timeout: 3000 });
    checks.mockHr = r.ok ? 'ok' : 'error';
  } catch { checks.mockHr = 'error'; }

  try {
    const r = await fetch(`${PAYROLL_URL}/health`, { timeout: 3000 });
    checks.mockPayroll = r.ok ? 'ok' : 'error';
  } catch { checks.mockPayroll = 'error'; }

  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 207).json({
    status: allOk ? 'ok' : 'degraded',
    service: 'integration-gateway',
    checks,
    azureServiceBus: !!process.env.AZURE_SB_CONNECTION_STRING,
    timestamp: new Date().toISOString(),
  });
});

// ─── Apply auth to all routes below ──────────────────────────────────────────
app.use(apiKeyAuth);

// ─── REST: Employees ──────────────────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    const hrRes = await fetch(`${HR_URL}/employees?${params}`);
    const xml = await hrRes.text();
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const employees = parsed.employees?.employee || [];
    const list = Array.isArray(employees) ? employees : [employees];
    res.json({ data: list.map(normalizeEmployee), count: list.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/employees/:id', async (req, res) => {
  try {
    const hrRes = await fetch(`${HR_URL}/employees/${req.params.id}`);
    if (!hrRes.ok) { res.status(404).json({ error: 'Employee not found' }); return; }
    const xml = await hrRes.text();
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const emp = normalizeEmployee(parsed.employee);

    // Enrich with payroll data
    try {
      const prRes = await fetch(`${PAYROLL_URL}/salary/${req.params.id}`);
      if (prRes.ok) emp.payroll = await prRes.json();
    } catch { /* payroll enrichment optional */ }

    res.json(emp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REST: Payroll ────────────────────────────────────────────────────────────
app.get('/api/payroll', async (req, res) => {
  try {
    const r = await fetch(`${PAYROLL_URL}/salary`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/payroll/:id', async (req, res) => {
  try {
    const r = await fetch(`${PAYROLL_URL}/salary/${req.params.id}`);
    if (!r.ok) { res.status(404).json({ error: 'Payroll record not found' }); return; }
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pay-runs', async (req, res) => {
  try {
    const r = await fetch(`${PAYROLL_URL}/pay-runs`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── REST: Integration monitoring ─────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await db.getRecentEvents(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
    res.json(event);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [stats, timeline] = await Promise.all([db.getStats(), db.getEventTimeline(24)]);
    res.json({ stats, timeline });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dead-letters', async (req, res) => {
  try { res.json(await db.getDeadLetters(false)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dead-letters/:id/resolve', writeRateLimiter, async (req, res) => {
  try {
    await db.resolveDeadLetter(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── REST: Sync operations ─────────────────────────────────────────────────────
app.post('/api/sync/employee/:id', writeRateLimiter, async (req, res) => {
  try {
    const empRes = await fetch(`${HR_URL}/employees/${req.params.id}`);
    if (!empRes.ok) { res.status(404).json({ error: 'Employee not found' }); return; }
    const xml = await empRes.text();
    const result = await publishHREvent(req.params.id, xml, 'employee.sync');
    res.json({ success: true, employeeId: req.params.id, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sync/all', writeRateLimiter, async (req, res) => {
  try {
    const r = await fetch(`${TRANSFORMER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_sync: true }),
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── REST: PGP ────────────────────────────────────────────────────────────────
app.get('/api/pgp/info', async (req, res) => {
  try {
    const r = await fetch(`${TRANSFORMER_URL}/pgp/info`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GraphQL ──────────────────────────────────────────────────────────────────
async function startApollo() {
  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();
  app.use('/graphql', json(), expressMiddleware(server, {
    context: async ({ req }) => ({ apiKey: req.apiKey }),
  }));
  console.log('[gateway] GraphQL available at /graphql');
}

// ─── Normalizer ───────────────────────────────────────────────────────────────
function normalizeEmployee(e) {
  return {
    id: e.id,
    name: e.n || e.name,
    department: e.department,
    startDate: e.startDate,
    salary: parseFloat(e.salary) || null,
    status: e.status,
    manager: e.manager || null,
    location: e.location,
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────
startApollo().then(() => {
  app.listen(PORT, () => {
    console.log(`[gateway] REST  → http://localhost:${PORT}/api`);
    console.log(`[gateway] Graph → http://localhost:${PORT}/graphql`);
    console.log(`[gateway] Health→ http://localhost:${PORT}/health`);
    console.log(`[gateway] Azure SB: ${process.env.AZURE_SB_CONNECTION_STRING ? 'configured' : 'NOT configured (running in local mode)'}`);
  });
});
