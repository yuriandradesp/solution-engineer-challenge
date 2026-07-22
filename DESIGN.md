# DESIGN — Order ingestion at scale

This describes how I'd take the small service in `order-ingestion-service/` to
production: hundreds of customers, mixed push/pull, update rates from
sub-second to nightly. The take-home keeps one pipeline in one process; the
production shape below is the same pipeline, decoupled and horizontally scaled.

## 1. Architecture at scale

The core principle: **decouple ingestion from processing with a durable log.**
Ingestion's only job is to accept a raw payload as fast as possible and append
it. Processing (normalize → validate → persist) happens asynchronously by
independent consumers.

```
 PUSH (webhooks)                                          canonical
   FreshMart ─┐                                            consumers
   …          ├▶ [Ingress API] ─┐                        ┌▶ normalize
 PULL (pollers)                 │                        │   validate
   BairroBox ─┐                 ▼                        │   dedup/persist
   GlobalGoods├▶ [Poller fleet]─┴▶ ( raw-orders topic ) ─┼▶ ───────────▶ [Order store]
   …          │                     partitioned by         │                 │
              │                      customerId            └▶ [DLQ] ◀─ bad ───┘
              ▼                                                    records
      [Per-customer config + cursor store]           [Schema/contract monitor]
```

- **Ingress API** (webhooks): stateless, autoscaled behind a load balancer.
  Validates the signature, appends the raw body to the log, returns `202`. No
  business logic on the hot path.
- **Raw-orders log** (Kafka / Kinesis / PubSub): the seam between ingestion and
  processing. **Partitioned by `customerId`** so one customer's ordering is
  preserved and one customer's volume can't reorder another's.
- **Canonical consumers**: a horizontally scaled consumer group running the
  exact pipeline from this repo (normalize → validate → idempotent upsert).
  Scale by adding consumers / partitions.
- **Config + cursor store**: per-customer contract (mode, interval, rate limit,
  field mapping, watermarks). Config-driven so a new customer is data, not a
  deploy.

Why a log and not a job queue: it gives **replay** (reprocess history after a
mapping fix), **buffering** (absorb bursts), and **consumer independence** for
free.

## 2. Polling at scale

Hundreds of pollers is a **scheduling** problem, not hundreds of `setInterval`s
in one box.

- **Scheduler** emits "poll customer X" tickets onto a work queue at each
  customer's interval; a pool of **stateless poll workers** consumes them. The
  fleet scales with the queue, and a slow API ties up one worker, not the box.
- **Cursors / watermarks**: persist the high-water mark per customer (max
  `createdAt`/id seen, or a real cursor when the API offers one) so we don't
  re-read the whole window each cycle. The mocks here expose no `since`, so we
  fall back to **at-least-once + downstream dedup** (see §4) — which is exactly
  what the take-home implements.
- **Rate limits**: a per-customer token bucket (implemented here as
  `RateLimiter`); at scale it's a shared/distributed limiter (e.g. Redis) so all
  workers for a customer honor one global budget.
- **Backoff**: respect `Retry-After` on `429`; exponential backoff with jitter
  on `5xx`/timeouts (implemented here). A circuit breaker per customer stops
  hammering a down API and flips it to a slower probe cadence.
- **File/SFTP pulls** (nightly CSV, etc.) are just another poll-worker type that
  lists new files and appends rows to the same log.

## 3. Webhook ingestion

- **Fast ack**: validate signature, append raw, return `202`. Everything else
  is async. This absorbs bursts because the log is the buffer.
- **Signature verification** over the **raw request bytes** (HMAC), with a
  short timestamp window to bound replay. (This repo has the optional guard but
  HMACs a re-serialized body — a documented simplification.)
- **Bursts**: the ingress autoscales on CPU/RPS; the log soaks the spike; a
  temporarily behind consumer group just adds lag, never drops.
- **Replay/retries**: customers retry on non-`2xx`; our dedup makes retries
  safe. We can also replay from the log to rebuild the store.

## 4. Exactly-once & idempotency

True exactly-once across a network is impractical; the pragmatic target is
**at-least-once delivery + idempotent processing = effectively once.**

- **Deterministic id**: `orderId = hash(customerId, externalOrderId)`. The same
  order always lands on the same key.
- **Dedup on write**: compare a **content hash**. Identical → no-op; changed →
  update (real state transition). Enforced by a UNIQUE/PK constraint (here,
  SQLite `orderId` PRIMARY KEY; at scale, the store's upsert/conditional write).
- **Where at-least-once is fine**: everywhere here — pushes retry, poll windows
  overlap, consumers may reprocess after a crash. Dedup absorbs all of it. I'd
  reserve stronger guarantees (transactional outbox, dedup tables on the
  consumer offset) only for side effects that aren't naturally idempotent
  (e.g. "charge once", "notify once").

## 5. Backpressure & isolation

One noisy or broken customer must not starve the rest.

- **Partition-per-customer** on the log bounds blast radius to that customer's
  partitions.
- **Poll-worker pool + per-customer concurrency caps** stop one customer
  hogging workers; the overlap guard (here `inFlight`) stops a slow cycle
  stacking on itself.
- **Per-customer circuit breakers & rate budgets** isolate a flapping API.
- **Bad-data isolation**: a record that can't be mapped goes to the **DLQ**, so
  a customer sending garbage fills their DLQ, not the pipeline.
- **Quotas**: cap a single customer's in-flight lag so a 10M-row backfill can't
  monopolize the consumer group (separate "bulk" lane if needed).

## 6. Failure handling & observability

- **Retries** with backoff for transient failures; **DLQ** for non-retryable
  (mapping/validation) with the reason attached — inspectable and **replayable**
  after a fix. This repo has the DLQ + `/orders/failures`.
- **Metrics** per customer: ingest rate, lag, DLQ rate, `429`/error rate, poll
  duration, dedup ratio. **Alert on the derivatives** — a spike in a customer's
  DLQ rate or a drop to zero ingest is the early signal.
- **Detecting a silent contract change** (the hard one): validate every payload
  against the customer's expected schema and **track field-level drift** — a new
  enum value, a field going null, a currency unit flipping. When drift crosses a
  threshold, the record dead-letters and we page the integration owner *before*
  the customer complains. In this repo, an unmapped status code or a
  non-ISO country already dead-letters instead of silently corrupting data —
  the seed of that mechanism.
- **Tracing**: propagate an ingest id from raw payload → canonical order → DLQ
  so any order is traceable end to end.

## 7. Trade-offs — kept simple vs. deferred

**Kept simple in the take-home (deliberately):**
- One process, in-process pipeline, `setInterval` pollers, in-memory DLQ,
  SQLite via `node:sqlite`. Enough to prove normalization, both modes,
  idempotency, and isolation without spending the budget on infra.
- Fixed UTC offsets instead of a tz library; inline pipeline on the webhook
  instead of enqueue.

**Deferred to production:**
- The durable log + separate consumer group (the biggest real change).
- Distributed scheduler + poll-worker fleet + shared rate limiter.
- Durable, replayable DLQ and a schema/contract-drift monitor.
- Real datastore (Postgres) with partitioning/retention, and a config service
  with per-customer versioning + audit.

The through-line: the **canonical model and the normalize→validate→dedup
pipeline don't change** from laptop to production. What changes is what sits
*between* ingestion and processing (a log) and how many copies of each stage
run. That's what makes "a new customer is config, not code" hold at 3 customers
and at 300.
