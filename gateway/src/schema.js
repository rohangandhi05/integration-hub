const { gql } = require('graphql-tag');
const fetch = require('node-fetch');
const xml2js = require('xml2js');
const { getRecentEvents, getEventById, getStats, getDeadLetters, getEventTimeline } = require('./db');
const { publishHREvent, publishPayrollEvent, getQueueStats } = require('./servicebus');

const HR_URL = process.env.MOCK_HR_URL || 'http://mock-hr:3001';
const PAYROLL_URL = process.env.MOCK_PAYROLL_URL || 'http://mock-payroll:3002';
const TRANSFORMER_URL = process.env.TRANSFORMER_URL || 'http://transformer:8000';

// ─── Schema ───────────────────────────────────────────────────────────────────
const typeDefs = gql`
  type Employee {
    id: ID!
    name: String!
    department: String!
    startDate: String
    salary: Float
    status: String
    manager: String
    location: String
    payroll: PayrollRecord
  }

  type PayrollRecord {
    employeeId: ID!
    baseSalary: Float
    currency: String
    payFrequency: String
    taxCode: String
    bankLast4: String
    nextPayDate: String
    ytdGross: Float
    ytdTax: Float
  }

  type PayRun {
    runId: ID!
    date: String!
    status: String!
    totalGross: Float
    employeeCount: Int
  }

  type IntegrationEvent {
    id: ID!
    sourceService: String!
    targetService: String!
    eventType: String!
    status: String!
    errorMessage: String
    retryCount: Int
    pgpSigned: Boolean
    createdAt: String!
    updatedAt: String!
  }

  type IntegrationStats {
    totalCount: Int
    successCount: Int
    failedCount: Int
    pendingCount: Int
    processingCount: Int
    deadLetterCount: Int
    lastHour: Int
    last24h: Int
    successRate: Float
  }

  type TimelinePoint {
    hour: String!
    success: Int!
    failed: Int!
    total: Int!
  }

  type QueueStats {
    hrQueue: QueueInfo
    payrollQueue: QueueInfo
    azureConfigured: Boolean!
  }

  type QueueInfo {
    name: String!
    activeMessageCount: Int
    deadLetterMessageCount: Int
    scheduledMessageCount: Int
  }

  type DeadLetter {
    id: ID!
    queueName: String
    failureReason: String
    retryCount: Int
    resolved: Boolean
    createdAt: String
  }

  type SyncResult {
    success: Boolean!
    message: String!
    employeeId: String
    eventId: String
    published: Boolean
  }

  type Department {
    name: String!
    employeeCount: Int!
  }

  type Query {
    # Employee queries
    employee(id: ID!): Employee
    employees(department: String, status: String): [Employee!]!
    departments: [Department!]!

    # Payroll queries
    payrollRecord(employeeId: ID!): PayrollRecord
    payRuns: [PayRun!]!

    # Integration monitoring
    integrationEvents(limit: Int): [IntegrationEvent!]!
    integrationEvent(id: ID!): IntegrationEvent
    integrationStats: IntegrationStats!
    eventTimeline(hours: Int): [TimelinePoint!]!
    queueStats: QueueStats!
    deadLetters: [DeadLetter!]!
  }

  type Mutation {
    # Trigger employee sync HR → Payroll via Service Bus
    syncEmployee(employeeId: ID!): SyncResult!

    # Trigger full sync of all employees
    syncAllEmployees: SyncResult!

    # Retry a dead-lettered message
    retryDeadLetter(id: ID!): SyncResult!
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchXmlEmployee(id) {
  const res = await fetch(`${HR_URL}/employees/${id}`);
  if (!res.ok) return null;
  const xml = await res.text();
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const e = parsed.employee;
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

async function fetchPayroll(employeeId) {
  try {
    const res = await fetch(`${PAYROLL_URL}/salary/${employeeId}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ─── Resolvers ────────────────────────────────────────────────────────────────
const resolvers = {
  Query: {
    employee: async (_, { id }) => fetchXmlEmployee(id),

    employees: async (_, { department, status }) => {
      let url = `${HR_URL}/employees`;
      const params = new URLSearchParams();
      if (department) params.append('department', department);
      if (status) params.append('status', status);
      if ([...params].length) url += `?${params}`;

      const res = await fetch(url);
      const xml = await res.text();
      const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
      const employees = parsed.employees?.employee || [];
      const list = Array.isArray(employees) ? employees : [employees];
      return list.map(e => ({
        id: e.id,
        name: e.n || e.name,
        department: e.department,
        startDate: e.startDate,
        salary: parseFloat(e.salary) || null,
        status: e.status,
        manager: e.manager || null,
        location: e.location,
      }));
    },

    departments: async () => {
      const res = await fetch(`${HR_URL}/departments`);
      const xml = await res.text();
      const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
      const depts = parsed.departments?.department || [];
      const list = Array.isArray(depts) ? depts : [depts];

      // Get employee counts per dept
      const empRes = await fetch(`${HR_URL}/employees`);
      const empXml = await empRes.text();
      const empParsed = await xml2js.parseStringPromise(empXml, { explicitArray: false });
      const emps = empParsed.employees?.employee || [];
      const empList = Array.isArray(emps) ? emps : [emps];
      const counts = empList.reduce((acc, e) => {
        acc[e.department] = (acc[e.department] || 0) + 1;
        return acc;
      }, {});

      return list.map(d => ({ name: d, employeeCount: counts[d] || 0 }));
    },

    payrollRecord: async (_, { employeeId }) => fetchPayroll(employeeId),

    payRuns: async () => {
      const res = await fetch(`${PAYROLL_URL}/pay-runs`);
      const data = await res.json();
      return data.data || [];
    },

    integrationEvents: async (_, { limit = 50 }) => {
      const events = await getRecentEvents(limit);
      return events.map(e => ({
        id: e.id,
        sourceService: e.source_service,
        targetService: e.target_service,
        eventType: e.event_type,
        status: e.status,
        errorMessage: e.error_message,
        retryCount: e.retry_count,
        pgpSigned: e.pgp_signed,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
      }));
    },

    integrationEvent: async (_, { id }) => {
      const e = await getEventById(id);
      if (!e) return null;
      return {
        id: e.id,
        sourceService: e.source_service,
        targetService: e.target_service,
        eventType: e.event_type,
        status: e.status,
        errorMessage: e.error_message,
        retryCount: e.retry_count,
        pgpSigned: e.pgp_signed,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
      };
    },

    integrationStats: async () => {
      const s = await getStats();
      const total = parseInt(s.total_count) || 0;
      const success = parseInt(s.success_count) || 0;
      return {
        totalCount:      total,
        successCount:    success,
        failedCount:     parseInt(s.failed_count) || 0,
        pendingCount:    parseInt(s.pending_count) || 0,
        processingCount: parseInt(s.processing_count) || 0,
        deadLetterCount: parseInt(s.dead_letter_count) || 0,
        lastHour:        parseInt(s.last_hour) || 0,
        last24h:         parseInt(s.last_24h) || 0,
        successRate:     total > 0 ? Math.round((success / total) * 100) : 0,
      };
    },

    eventTimeline: async (_, { hours = 24 }) => {
      const rows = await getEventTimeline(hours);
      return rows.map(r => ({
        hour: r.hour,
        success: parseInt(r.success) || 0,
        failed: parseInt(r.failed) || 0,
        total: parseInt(r.total) || 0,
      }));
    },

    queueStats: async () => {
      const stats = await getQueueStats();
      return {
        azureConfigured: !!process.env.AZURE_SB_CONNECTION_STRING,
        hrQueue: stats?.hrQueue || null,
        payrollQueue: stats?.payrollQueue || null,
      };
    },

    deadLetters: async () => {
      const rows = await getDeadLetters(false);
      return rows.map(r => ({
        id: r.id,
        queueName: r.queue_name,
        failureReason: r.failure_reason,
        retryCount: r.retry_count,
        resolved: r.resolved,
        createdAt: r.created_at,
      }));
    },
  },

  Employee: {
    payroll: async (employee) => fetchPayroll(employee.id),
  },

  Mutation: {
    syncEmployee: async (_, { employeeId }) => {
      try {
        const emp = await fetchXmlEmployee(employeeId);
        if (!emp) return { success: false, message: `Employee ${employeeId} not found`, published: false };

        const res = await fetch(`${HR_URL}/employees/${employeeId}`);
        const xmlPayload = await res.text();
        const result = await publishHREvent(employeeId, xmlPayload, 'employee.sync');

        return {
          success: true,
          message: `Sync event published for ${employeeId}`,
          employeeId,
          published: result.published,
        };
      } catch (e) {
        return { success: false, message: e.message, published: false };
      }
    },

    syncAllEmployees: async () => {
      try {
        const res = await fetch(`${TRANSFORMER_URL}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_sync: true }),
        });
        const data = await res.json();
        return {
          success: true,
          message: data.message || 'Full sync triggered',
          published: false,
        };
      } catch (e) {
        return { success: false, message: e.message, published: false };
      }
    },

    retryDeadLetter: async (_, { id }) => {
      try {
        const { resolveDeadLetter } = require('./db');
        await resolveDeadLetter(id);
        return { success: true, message: `Dead letter ${id} marked as resolved` };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },
  },
};

module.exports = { typeDefs, resolvers };
