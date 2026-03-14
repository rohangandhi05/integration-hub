const BASE = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3000';
const API_KEY = 'dev-key-1234';

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers, ...opts });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  health: ()              => fetch(`${BASE}/health`).then(r => r.json()),
  stats: ()               => request('/api/stats'),
  events: (limit = 50)    => request(`/api/events?limit=${limit}`),
  event: (id)             => request(`/api/events/${id}`),
  employees: (params = {})=> request(`/api/employees?${new URLSearchParams(params)}`),
  employee: (id)          => request(`/api/employees/${id}`),
  payroll: (id)           => request(`/api/payroll/${id}`),
  payRuns: ()             => request('/api/pay-runs'),
  deadLetters: ()         => request('/api/dead-letters'),
  pgpInfo: ()             => request('/api/pgp/info'),

  syncEmployee: (id) => request(`/api/sync/employee/${id}`, { method: 'POST' }),
  syncAll: ()        => request('/api/sync/all', { method: 'POST' }),
  resolveDeadLetter: (id) => request(`/api/dead-letters/${id}/resolve`, { method: 'POST' }),

  graphql: (query, variables = {}) =>
    request('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    }).then(r => r.data),
};
