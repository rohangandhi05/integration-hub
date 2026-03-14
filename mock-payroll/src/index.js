const express = require('express');
const app = express();
app.use(express.json());

// ─── Seed payroll data ────────────────────────────────────────────────────────
const PAYROLL = {
  'EMP001': { employeeId: 'EMP001', baseSalary: 115000, currency: 'CAD', payFrequency: 'biweekly', taxCode: 'BC-T1', bankLast4: '4521', nextPayDate: '2025-06-13', ytdGross: 52291, ytdTax: 13072 },
  'EMP002': { employeeId: 'EMP002', baseSalary: 108000, currency: 'CAD', payFrequency: 'biweekly', taxCode: 'ON-T1', bankLast4: '8834', nextPayDate: '2025-06-13', ytdGross: 49000, ytdTax: 12250 },
  'EMP003': { employeeId: 'EMP003', baseSalary: 95000,  currency: 'CAD', payFrequency: 'biweekly', taxCode: 'BC-T1', bankLast4: '2277', nextPayDate: '2025-06-13', ytdGross: 43125, ytdTax: 10781 },
  'EMP004': { employeeId: 'EMP004', baseSalary: 99000,  currency: 'CAD', payFrequency: 'biweekly', taxCode: 'FED',   bankLast4: '9901', nextPayDate: '2025-06-13', ytdGross: 44990, ytdTax: 11247 },
  'EMP005': { employeeId: 'EMP005', baseSalary: 145000, currency: 'CAD', payFrequency: 'biweekly', taxCode: 'BC-T1', bankLast4: '3312', nextPayDate: '2025-06-13', ytdGross: 65875, ytdTax: 19762 },
  'EMP006': { employeeId: 'EMP006', baseSalary: 140000, currency: 'CAD', payFrequency: 'biweekly', taxCode: 'ON-T1', bankLast4: '7744', nextPayDate: '2025-06-13', ytdGross: 63583, ytdTax: 19075 },
  'EMP007': { employeeId: 'EMP007', baseSalary: 135000, currency: 'CAD', payFrequency: 'biweekly', taxCode: 'BC-T1', bankLast4: '5566', nextPayDate: '2025-06-13', ytdGross: 0, ytdTax: 0 },
};

const PAY_RUNS = [
  { runId: 'RUN-2025-11', date: '2025-05-30', status: 'completed', totalGross: 362364, employeeCount: 7 },
  { runId: 'RUN-2025-10', date: '2025-05-16', status: 'completed', totalGross: 362364, employeeCount: 7 },
  { runId: 'RUN-2025-09', date: '2025-05-02', status: 'completed', totalGross: 355000, employeeCount: 6 },
  { runId: 'RUN-2025-12', date: '2025-06-13', status: 'scheduled', totalGross: 362364, employeeCount: 7 },
];

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mock-payroll', employees: Object.keys(PAYROLL).length });
});

// GET /salary/:employeeId
app.get('/salary/:employeeId', (req, res) => {
  const record = PAYROLL[req.params.employeeId.toUpperCase()];
  if (!record) {
    return res.status(404).json({ error: 'Employee not found in payroll', code: 'NOT_FOUND' });
  }
  res.json(record);
});

// GET /salary — list all
app.get('/salary', (req, res) => {
  res.json({ data: Object.values(PAYROLL), count: Object.keys(PAYROLL).length });
});

// POST /salary — add new employee to payroll
app.post('/salary', (req, res) => {
  const { employeeId, baseSalary, taxCode, payFrequency } = req.body;
  if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

  const newRecord = {
    employeeId,
    baseSalary: baseSalary || 80000,
    currency: 'CAD',
    payFrequency: payFrequency || 'biweekly',
    taxCode: taxCode || 'FED',
    bankLast4: '0000',
    nextPayDate: PAY_RUNS.find(r => r.status === 'scheduled')?.date || '',
    ytdGross: 0,
    ytdTax: 0,
  };
  PAYROLL[employeeId] = newRecord;
  res.status(201).json(newRecord);
});

// PUT /salary/:employeeId — update salary
app.put('/salary/:employeeId', (req, res) => {
  const record = PAYROLL[req.params.employeeId.toUpperCase()];
  if (!record) return res.status(404).json({ error: 'Not found' });
  Object.assign(record, req.body);
  res.json(record);
});

// GET /pay-runs — list pay runs
app.get('/pay-runs', (req, res) => {
  res.json({ data: PAY_RUNS, count: PAY_RUNS.length });
});

// GET /pay-runs/:runId
app.get('/pay-runs/:runId', (req, res) => {
  const run = PAY_RUNS.find(r => r.runId === req.params.runId);
  if (!run) return res.status(404).json({ error: 'Pay run not found' });

  // Include per-employee breakdown
  const breakdown = Object.values(PAYROLL).map(p => ({
    employeeId: p.employeeId,
    gross: (p.baseSalary / 26).toFixed(2),
    tax: (p.baseSalary / 26 * 0.25).toFixed(2),
    net: (p.baseSalary / 26 * 0.75).toFixed(2),
  }));

  res.json({ ...run, breakdown });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`[mock-payroll] Listening on port ${PORT}`);
  console.log(`[mock-payroll] Serving ${Object.keys(PAYROLL).length} payroll records as JSON`);
});
