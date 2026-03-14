# Demo 

https://github.com/user-attachments/assets/a4f9ad74-a4fa-404b-8ab1-75984a07e246 

# Enterprise Integration Hub

Middleware integration broker connecting a mock HR system (XML) and mock payroll (JSON) via Azure Service Bus — with a GraphQL/REST gateway, PGP signing, dead-letter recovery, and a React dashboard.

---

## Architecture

```
React Dashboard (5173) → Gateway (3000) → Mock HR (3001) / Mock Payroll (3002)
        → Azure Service Bus (hr-events, payroll-events)
        → Python Transformer (8000) → PostgreSQL (5432)
```

Gateway handles API key auth, rate limiting, and protocol translation. Transformer subscribes to Azure SB, does XML→JSON (DB-driven field mappings), PGP verification, and writes to Postgres.

---

## Quick start (local, no Azure required)

### 1. Prerequisites

- Docker Desktop
- Git

### 2. Clone and configure

```bash
git clone https://github.com/YOUR_USERNAME/integration-hub.git
cd integration-hub
cp .env.example .env
# Leave AZURE_SB_CONNECTION_STRING blank for local-only mode
```

### 3. Start everything

```bash
docker compose up --build
```

Services start in dependency order. First boot takes ~2 minutes.

### 4. Verify

| URL | What |
|---|---|
| http://localhost:3000/health | Gateway health |
| http://localhost:3001/health | Mock HR |
| http://localhost:3002/health | Mock Payroll |
| http://localhost:5173 | React dashboard |
| http://localhost:3000/graphql | GraphQL playground |

### 5. Trigger your first sync

```bash
# Sync a single employee (HR XML → transform → payroll JSON)
curl -X POST http://localhost:3000/api/sync/employee/EMP001 \
  -H "x-api-key: dev-key-1234"

# Sync all employees
curl -X POST http://localhost:3000/api/sync/all \
  -H "x-api-key: dev-key-1234"

# Check events logged to Postgres
curl http://localhost:3000/api/events \
  -H "x-api-key: dev-key-1234" | jq '.[0]'
```

---

## Connecting Azure Service Bus

1. **Create resources** — Resource group, Service Bus namespace (Basic), queues `hr-events` and `payroll-events` (e.g. with `az servicebus namespace create` and `az servicebus queue create`).
2. **Get connection string** — `az servicebus namespace authorization-rule keys list ... --query primaryConnectionString -o tsv`
3. **Add to .env** — `AZURE_SB_CONNECTION_STRING=Endpoint=sb://...`
4. **Restart** — `docker compose down && docker compose up`

The transformer will then subscribe to the live queues.

---

## API reference

All endpoints except `/health` require the `x-api-key` header.

### REST

```
GET    /health                          # Aggregated health check
GET    /api/employees                   # List employees (XML → JSON)
GET    /api/employees/:id               # Single employee + payroll enrichment
GET    /api/payroll/:id                 # Payroll record
GET    /api/pay-runs                    # Pay run history
GET    /api/events?limit=50             # Integration event log
GET    /api/stats                       # Stats + 24h timeline
GET    /api/dead-letters                # Unresolved dead letters
POST   /api/dead-letters/:id/resolve    # Mark dead letter resolved
POST   /api/sync/employee/:id           # Publish HR sync event
POST   /api/sync/all                    # Trigger full sync (background)
GET    /api/pgp/info                    # PGP key status
```

### GraphQL (POST /graphql)

```graphql
# Unified employee query — merges HR XML + Payroll JSON
query {
  employee(id: "EMP001") {
    id name department salary status
    payroll { baseSalary currency ytdGross }
  }
}

# Integration stats
query {
  integrationStats {
    totalCount successCount failedCount successRate
  }
  eventTimeline(hours: 24) { hour success failed }
  queueStats { azureConfigured hrQueue { activeMessageCount } }
}

# Trigger sync
mutation {
  syncEmployee(employeeId: "EMP002") { success message published }
}
```

---

## Security

- **PGP** — Keys auto-generated on transformer start. Manual: `python security/keys.py generate`; sign/verify/export via the same script.
- **API keys** — Set in `API_KEYS` (comma-separated). Gateway returns 401 without `x-api-key`, 403 for invalid keys; rate limits: 100 req/min read, 20 req/min write.

---

## Development

```bash
# Single service
cd gateway && npm install && npm run dev
cd transformer && pip install -r requirements.txt && uvicorn main:app --reload
cd dashboard && npm install && npm run dev

# Postgres
docker compose exec postgres psql -U hub -d integrations
```

**Add field mapping (no code change):**
```sql
INSERT INTO field_mappings (source_format, target_format, source_path, target_path, transform_fn)
VALUES ('xml', 'json', 'employee.phone', 'contactPhone', 'trim');
```

---

## CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` on push to `main`: test (Python + Node), build images to GHCR, deploy to Azure Container Instances. Secrets: `AZURE_CREDENTIALS`, `AZURE_RESOURCE_GROUP`, `DATABASE_URL`, `AZURE_SB_CONNECTION_STRING`, `API_KEYS`, `PGP_PASSPHRASE`.

---

## Project structure

```
gateway/         # Node GraphQL + REST, auth, rate limit, Service Bus publisher
transformer/     # Python: Azure SB subscriber, XML→JSON, PGP, Postgres
mock-hr/         # Mock HR (XML)
mock-payroll/    # Mock payroll (JSON)
dashboard/       # React dashboard (Overview, Employees, DeadLetters, Security)
db/schema.sql    # Postgres schema + seeds
security/keys.py # PGP CLI
docker-compose.yml
```
