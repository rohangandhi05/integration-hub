const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.text({ type: 'application/xml' }));

// ─── Seed data ────────────────────────────────────────────────────────────────
const EMPLOYEES = {
  'EMP001': {
    id: 'EMP001', name: 'Alice Chen', department: 'Engineering',
    startDate: '2022-03-01', salary: 115000, status: 'active',
    manager: 'EMP005', location: 'Vancouver'
  },
  'EMP002': {
    id: 'EMP002', name: 'Marcus Thompson', department: 'Product',
    startDate: '2021-07-15', salary: 108000, status: 'active',
    manager: 'EMP006', location: 'Toronto'
  },
  'EMP003': {
    id: 'EMP003', name: 'Priya Sharma', department: 'Finance',
    startDate: '2020-01-10', salary: 95000, status: 'active',
    manager: 'EMP007', location: 'Vancouver'
  },
  'EMP004': {
    id: 'EMP004', name: 'Jordan Lee', department: 'Engineering',
    startDate: '2023-05-20', salary: 99000, status: 'active',
    manager: 'EMP005', location: 'Remote'
  },
  'EMP005': {
    id: 'EMP005', name: 'Sarah Okafor', department: 'Engineering',
    startDate: '2019-11-01', salary: 145000, status: 'active',
    manager: null, location: 'Vancouver'
  },
  'EMP006': {
    id: 'EMP006', name: 'David Park', department: 'Product',
    startDate: '2018-06-01', salary: 140000, status: 'active',
    manager: null, location: 'Toronto'
  },
  'EMP007': {
    id: 'EMP007', name: 'Linda Osei', department: 'Finance',
    startDate: '2017-09-15', salary: 135000, status: 'on_leave',
    manager: null, location: 'Vancouver'
  },
};

// ─── XML helpers ─────────────────────────────────────────────────────────────
function employeeToXml(emp) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<employee>
  <id>${emp.id}</id>
  <name>${emp.name}</name>
  <department>${emp.department}</department>
  <startDate>${emp.startDate}</startDate>
  <salary>${emp.salary}</salary>
  <status>${emp.status}</status>
  <manager>${emp.manager || ''}</manager>
  <location>${emp.location}</location>
</employee>`;
}

function employeeListToXml(employees) {
  const items = employees.map(e => `
  <employee>
    <id>${e.id}</id>
    <name>${e.name}</name>
    <department>${e.department}</department>
    <startDate>${e.startDate}</startDate>
    <salary>${e.salary}</salary>
    <status>${e.status}</status>
    <manager>${e.manager || ''}</manager>
    <location>${e.location}</location>
  </employee>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<employees total="${employees.length}">${items}
</employees>`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mock-hr', employees: Object.keys(EMPLOYEES).length });
});

// GET /employees — list all
app.get('/employees', (req, res) => {
  const { department, status } = req.query;
  let list = Object.values(EMPLOYEES);

  if (department) list = list.filter(e => e.department.toLowerCase() === department.toLowerCase());
  if (status)     list = list.filter(e => e.status === status);

  res.set('Content-Type', 'application/xml');
  res.send(employeeListToXml(list));
});

// GET /employees/:id
app.get('/employees/:id', (req, res) => {
  const emp = EMPLOYEES[req.params.id.toUpperCase()];
  if (!emp) {
    res.status(404).set('Content-Type', 'application/xml')
      .send(`<?xml version="1.0"?><error><code>NOT_FOUND</code><message>Employee ${req.params.id} not found</message></error>`);
    return;
  }
  res.set('Content-Type', 'application/xml');
  res.send(employeeToXml(emp));
});

// POST /employees — create (simulated, not persisted)
app.post('/employees', (req, res) => {
  const newId = 'EMP' + String(Object.keys(EMPLOYEES).length + 1).padStart(3, '0');
  const created = {
    id: newId,
    name: req.body.name || 'New Employee',
    department: req.body.department || 'Unassigned',
    startDate: new Date().toISOString().split('T')[0],
    salary: req.body.salary || 80000,
    status: 'active',
    manager: req.body.manager || null,
    location: req.body.location || 'Remote'
  };
  EMPLOYEES[newId] = created;
  res.status(201).set('Content-Type', 'application/xml');
  res.send(employeeToXml(created));
});

// PUT /employees/:id — update
app.put('/employees/:id', (req, res) => {
  const emp = EMPLOYEES[req.params.id.toUpperCase()];
  if (!emp) { res.status(404).json({ error: 'Not found' }); return; }

  Object.assign(emp, req.body);
  res.set('Content-Type', 'application/xml');
  res.send(employeeToXml(emp));
});

// GET /departments
app.get('/departments', (req, res) => {
  const depts = [...new Set(Object.values(EMPLOYEES).map(e => e.department))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<departments total="${depts.length}">
  ${depts.map(d => `<department>${d}</department>`).join('\n  ')}
</departments>`;
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[mock-hr] Listening on port ${PORT}`);
  console.log(`[mock-hr] Serving ${Object.keys(EMPLOYEES).length} employees as XML`);
});
