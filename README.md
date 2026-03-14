# Enterprise Integration Hub

A production-grade middleware integration broker connecting a mock HR system (XML/SOAP-style) and a mock payroll system (REST/JSON) via Azure Service Bus — with a GraphQL API gateway, PGP payload signing, dead-letter recovery, and a real-time React monitoring dashboard.

> Built as a portfolio project targeting enterprise integration roles. Demonstrates pub/sub messaging, protocol translation, API security, and Azure Integration Services.

---

## Architecture

```
React Dashboard (port 5173)
        │
        ▼
GraphQL + REST Gateway (port 3000)
  ├── API key auth + rate limiting
  ├── PGP payload signing
  └── Protocol translation (XML ↔ JSON)
        │
        ├──── Mock HR Service (port 3001)   → returns XML (legacy SOAP-style)
        ├──── Mock Payroll Service (port 3002) → returns JSON (modern REST)
        │
        ▼
Azure Service Bus
  ├── hr-events queue          (pub/sub)
  ├── payroll-events queue     (pub/sub)
  └── dead-letter sub-queues   (auto-managed by Azure)
        │
        ▼
Python Transformer Service (port 8000)
  ├── Subscribes to Azure SB queues
  ├── XML → JSON transformation (DB-driven field mappings)
  ├── PGP signature verification
  └── PostgreSQL audit logging
        │
        ▼
PostgreSQL (port 5432)
  ├── integration_events   (full audit trail)
  ├── field_mappings       (schema evolution config)
  ├── api_keys             (key management)
  └── dead_letters         (manual review queue)
```

### Integration patterns implemented

| Pattern | Where |
|---|---|
| Publish-subscribe | Azure Service Bus queues |
| Request-reply | Gateway → HR/Payroll REST calls |
| Dead-letter queue | Azure SB + PostgreSQL `dead_letters` table |
| Content-based routing | GraphQL resolvers |
| Message transformation | Python transformer (XML → JSON) |
| PGP payload signing | Transformer signs all outbound payloads |

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

Services will start in dependency order. First boot takes ~2 minutes (Python deps install).

### 4. Verify

| URL | What |
|---|---|
| http://localhost:3000/health | Gateway health (all upstream checks) |
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

### 1. Create Azure resources

```bash
# Login
az login

# Create resource group
az group create --name integration-hub-rg --location canadacentral

# Create Service Bus namespace (Basic tier is free)
az servicebus namespace create \
  --resource-group integration-hub-rg \
  --name YOUR_UNIQUE_NAMESPACE \
  --location canadacentral \
  --sku Basic

# Create queues
az servicebus queue create \
  --resource-group integration-hub-rg \
  --namespace-name YOUR_UNIQUE_NAMESPACE \
  --name hr-events \
  --max-delivery-count 3

az servicebus queue create \
  --resource-group integration-hub-rg \
  --namespace-name YOUR_UNIQUE_NAMESPACE \
  --name payroll-events \
  --max-delivery-count 3

# Get connection string
az servicebus namespace authorization-rule keys list \
  --resource-group integration-hub-rg \
  --namespace-name YOUR_UNIQUE_NAMESPACE \
  --name RootManageSharedAccessKey \
  --query primaryConnectionString -o tsv
```

### 2. Add to .env

```
AZURE_SB_CONNECTION_STRING=Endpoint=sb://YOUR_UNIQUE_NAMESPACE.servicebus.windows.net/;...
```

### 3. Restart

```bash
docker compose down && docker compose up
```

The transformer will now subscribe to live Azure queues. Messages published via `POST /api/sync/employee/:id` flow through Azure and back.

---

## API reference

All endpoints except `/health` require `x-api-key` header.

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

### PGP signing

```bash
# Generate keys manually (also auto-generated on transformer start)
pip install python-gnupg
python security/keys.py generate

# Sign a test payload
python security/keys.py sign "test payload"

# Verify
python security/keys.py verify security/keys/signed_output.asc

# Export public key (share with integration partners)
python security/keys.py export
```

### API keys

Keys are set in `API_KEYS` env var (comma-separated). The gateway middleware:
1. Rejects requests missing `x-api-key` with `401`
2. Rejects invalid keys with `403`
3. Rate-limits reads to 100 req/min, writes to 20 req/min

For production, rotate keys and store in Azure Key Vault.

---

## CI/CD (GitHub Actions)

The workflow at `.github/workflows/deploy.yml` runs on every push to `main`:

1. **Test** — Python transform unit tests, Node import checks
2. **Build** — Docker images pushed to GitHub Container Registry
3. **Deploy** — Azure Container Instances updated via `az container create`

### Required GitHub secrets

| Secret | Value |
|---|---|
| `AZURE_CREDENTIALS` | Output of `az ad sp create-for-rbac --sdk-auth` |
| `AZURE_RESOURCE_GROUP` | e.g. `integration-hub-rg` |
| `DATABASE_URL` | PostgreSQL connection string |
| `AZURE_SB_CONNECTION_STRING` | From Azure portal |
| `API_KEYS` | Comma-separated production keys |
| `PGP_PASSPHRASE` | Strong passphrase |

---

## Development

### Run a single service locally

```bash
# Gateway (with nodemon hot reload)
cd gateway && npm install && npm run dev

# Transformer
cd transformer && pip install -r requirements.txt && uvicorn main:app --reload

# Dashboard
cd dashboard && npm install && npm run dev
```

### Database access

```bash
# Connect to local Postgres
docker compose exec postgres psql -U hub -d integrations

# Query events
SELECT source_service, target_service, status, created_at
FROM integration_events ORDER BY created_at DESC LIMIT 10;

# Check dead letters
SELECT * FROM dead_letters WHERE resolved = FALSE;
```

### Add a new field mapping (no code change required)

```sql
INSERT INTO field_mappings (source_format, target_format, source_path, target_path, transform_fn)
VALUES ('xml', 'json', 'employee.phone', 'contactPhone', 'trim');
```

The transformer picks up mappings from the DB at runtime — no restart needed.

---

## Project structure

```
integration-hub/
├── .github/workflows/deploy.yml   # CI/CD pipeline
├── db/schema.sql                  # PostgreSQL schema + seed data
├── security/keys.py               # PGP + SSH key management CLI
├── gateway/                       # Node.js GraphQL + REST gateway
│   └── src/
│       ├── index.js               # Express app + Apollo server
│       ├── schema.js              # GraphQL typedefs + resolvers
│       ├── auth.js                # API key middleware + rate limiting
│       ├── db.js                  # Postgres client
│       └── servicebus.js          # Azure SB publisher
├── transformer/                   # Python transformation service
│   └── src/
│       ├── transform.py           # XML→JSON engine + field mapping
│       ├── pgp.py                 # PGP sign/verify
│       ├── subscriber.py          # Azure SB subscriber + dead-letter
│       └── db.py                  # Postgres client
├── mock-hr/src/index.js           # Mock HR service (XML responses)
├── mock-payroll/src/index.js      # Mock payroll service (JSON responses)
├── dashboard/src/                 # React monitoring dashboard
│   ├── App.jsx
│   ├── components/
│   │   ├── Overview.jsx           # Stats + event timeline chart
│   │   ├── Employees.jsx          # Employee list + sync controls
│   │   ├── DeadLetters.jsx        # Dead-letter review + resolution
│   │   └── Security.jsx           # PGP status + pattern reference
│   ├── hooks/usePolling.js        # Auto-refresh hooks
│   └── lib/api.js                 # Gateway API client
└── docker-compose.yml
```

---

## Resume framing

When describing this project in interviews or on your resume:

> **Enterprise Integration Hub** | *Node.js, Python, Azure Service Bus, PostgreSQL, GraphQL, React, Docker*
> - Built a middleware integration broker translating between XML (SOAP-style HR) and JSON (REST payroll) using a DB-driven field mapping engine, processing events via Azure Service Bus pub/sub and request-reply patterns
> - Implemented PGP payload signing on all transformer outputs and API key authentication with per-route rate limiting on the GraphQL/REST gateway
> - Designed dead-letter recovery workflow with PostgreSQL audit trail; containerized all services with Docker Compose and automated CI/CD to Azure Container Instances via GitHub Actions

**Talking points for interviews:**
- Why Azure Service Bus over direct HTTP? Decoupling — the transformer can be down and messages are durably queued; the gateway doesn't need to know anything about the transformer's state
- Why DB-driven field mappings? Schema evolution without deploys — when the HR system adds a field, an ops person inserts a row, not a developer shipping code
- What does PGP signing buy you here? Non-repudiation and tamper detection — a subscriber can prove a transformed payload came from this hub and wasn't modified in transit
- How does dead-lettering work? Azure retries failed messages up to `max-delivery-count` (3), then moves them to the `./$DeadLetterQueue` sub-queue automatically; this project also mirrors them to Postgres so they show up in the dashboard for human review
