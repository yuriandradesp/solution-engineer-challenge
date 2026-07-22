# Order Ingestion Service

A NestJS service that ingests orders from many customers — over **push
(webhook)** and **pull (polling)** at different rates — and turns each one into
a single **canonical order**, so the rest of the platform never has to care
where the data came from or how it arrived.

For the full brief and the canonical model, see the repo root
[README.md](../README.md) and [INSTRUCTIONS.md](../INSTRUCTIONS.md).

## Quick start

```bash
# 1. Start the mock customer APIs first (separate project, port 4000)
cd ../mock-customer-apis && pnpm install && cp .env.sample .env && pnpm start

# 2. In another terminal, this service (port 3000)
cd ../order-ingestion-service
pnpm install
cp .env.sample .env
pnpm start
```

On boot the pollers immediately hit the mocks once, then on their interval. To
watch polling without waiting 5–15 min, set `DEMO_POLL_INTERVAL_MS=15000` in
`.env`.

### Try it

```bash
# Push a Customer A (FreshMart) order via webhook
curl -X POST http://localhost:3000/webhooks/freshmart \
  -H "Content-Type: application/json" \
  -d @../mock-customer-apis/fixtures/customer-a.sample.json

# See everything normalized (A pushed + B/C polled)
curl http://localhost:3000/orders
curl http://localhost:3000/orders/stats
curl http://localhost:3000/orders/failures
```

## Routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/webhooks/:customerId` | Push ingestion (Customer A → `freshmart`). Returns `202`. Accepts one order or an array. |
| `GET` | `/orders` | All normalized orders, newest first. |
| `GET` | `/orders/stats` | `{ orders, failures }` counts. |
| `GET` | `/orders/failures` | Dead-lettered records with the mapping reason. |
| `GET` | `/orders/:orderId` | One order by its canonical id. |
| `GET` | `/api/v1`, `/health/liveness`, `/health/readiness` | Starter routes (unchanged). |

## How it works

```
                 ┌─────────────────────────────────────────────┐
  Customer A ──▶ │ WebhookController  (POST /webhooks/:id)      │
  (push)         └───────────────┬─────────────────────────────┘
                                 │
  Customer B ──▶ ┌───────────────▼─────────────────────────────┐
  Customer C ──▶ │ HttpPollerService (per-customer timers,      │
  (pull)         │  pagination, rate-limit + backoff)           │
                 └───────────────┬─────────────────────────────┘
                                 │ raw record(s) + customerId
                 ┌───────────────▼─────────────────────────────┐
                 │ IngestionPipeline                            │
                 │   normalize → validate → upsert (idempotent) │
                 └───┬───────────────────────────┬─────────────┘
                     │ ok                         │ bad / partial
          ┌──────────▼─────────┐        ┌─────────▼──────────┐
          │ OrderRepository    │        │ DeadLetterStore    │
          │ (SQLite, node:     │        │ (reasons, /orders/ │
          │  sqlite; UNIQUE    │        │  failures)         │
          │  orderId)          │        └────────────────────┘
          └────────────────────┘
```

Both ingestion modes feed **one pipeline**. A new customer is a new entry in
[`customers.config.ts`](src/ingestion/config/customers.config.ts) — mode,
interval, rate limit, response shape, status/country dictionaries — plus, only
if its data shape is genuinely new, one small normalizer strategy. It is
**config, not a new pipeline**.

### Idempotency (the core)

The mock feeds return an overlapping, sliding window of the same rows every
poll (no `since`/cursor), so the same order arrives many times.

- `orderId = sha256(customerId + externalOrderId)` — deterministic, so a
  re-delivered order always maps to the same row.
- The repository upserts by comparing a **content hash**:
  - unseen → **created**
  - seen, identical content → **unchanged** (pure duplicate, no write)
  - seen, changed content → **updated** (a real status transition, e.g.
    `Novo → Entregue`)

In practice: once the poll windows have covered every row, each further poll
logs `N duplicate, 0 created`. Idempotency holds at the DB layer too — `orderId`
is the SQLite PRIMARY KEY.

### Per-customer quirks handled

| | Customer A (FreshMart) | Customer B (BairroBox) | Customer C (GlobalGoods) |
|---|---|---|---|
| Mode | push / webhook | poll (array) | poll (paginated, rate-limited) |
| Items | clean JSON lines | delimited string `Name\|xQTY\|LINETOTAL` | JSON, price in **cents** |
| Price | unit price | **line total** → ÷ qty for unit | cents → major; qty by **weight** |
| Status | `NEW` | Portuguese (`Em separacao`) | integer codes `1..5` |
| Date | ISO `Z` | `dd/mm/yyyy` @ `-03:00` | `MM-DD-YYYY hh:mm AM/PM` @ `-06:00` |
| Country | `BR` | default `BR` | `Mexico` → `MX` |

Bad/partial records (missing id, unmapped status, unparseable date, non-ISO
country) are **dead-lettered with a reason**, never silently dropped, and never
block the rest of the batch. Zero-quantity lines are kept as partials
(unit price `0`, not `NaN`).

### Documented assumptions / simplifications

- **Timezones** use a fixed UTC offset per customer (config), which ignores DST.
  Production would resolve a real IANA zone with a tz library.
- **Customer C status codes** (`1..5`) had no data dictionary; the mapping is a
  documented guess. An **unknown** code dead-letters — surfacing a possible
  silent contract change rather than guessing.
- **`Em entrega`** (out-for-delivery) has no exact canonical status; it collapses
  to the nearest (`ready`).
- **Webhook signatures** are optional (`WEBHOOK_SECRET`) and HMAC a
  re-serialized body; production must HMAC the raw request bytes.
- Persistence is SQLite via Node's built-in `node:sqlite` (no native build).
  The dead-letter store is in-memory; in production it is a durable DLQ.

## Configuration (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MOCKS_BASE_URL` | `http://localhost:4000` | Base URL the pollers call |
| `DB_PATH` | `./data/orders.sqlite` | SQLite file, or `:memory:` |
| `POLLING_ENABLED` | `true` | Set `false` to boot without pollers |
| `DEMO_POLL_INTERVAL_MS` | _(unset)_ | Overrides every pull interval (demo) |
| `WEBHOOK_SECRET` | _(unset)_ | Enables HMAC webhook verification |

## Test

```bash
pnpm test               # unit: normalizers + idempotency (test/unit)
pnpm test:integration   # black-box HTTP: webhook → persist, dedup (test/integration)
pnpm test:coverage      # unit with coverage
```

## Project structure

```
src/
├── common/                     # hashing, date parsing, errors, utils
├── orders/                     # canonical model, DTO/validation, repositories,
│   │                           # dead-letter store, read API
│   ├── order.repository.ts     # port
│   ├── sqlite-order.repository.ts
│   └── in-memory-order.repository.ts
└── ingestion/
    ├── config/customers.config.ts   # per-customer behavior + mapping
    ├── normalizers/                 # one strategy per customer + registry
    ├── pipeline/ingestion.pipeline.ts
    ├── webhook/                      # controller + optional signature guard
    └── polling/                     # poller + rate limiter
```
