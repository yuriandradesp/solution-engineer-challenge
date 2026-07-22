# SOLUTIONS — Scenario

> A mid-size retailer wants to go live in six weeks for peak season. Their
> "API" is a nightly CSV on an SFTP server; their small IT team can't change
> the export format. Sales has already promised integration is easy. How do you
> scope and run this — what do you commit to, push back on, and how do you
> phase it?

## The real situation

The good news: a nightly CSV over SFTP is a *pull* source, and our platform
already treats pull as a first-class mode. In our model this customer is a
**config entry + one CSV normalizer**, not new plumbing — the same
normalize → validate → dedup → persist pipeline every other customer uses.

The catch to name early, kindly but plainly: **a nightly file is not real-time.**
Orders placed at 9am aren't visible to the workforce until the next export
lands. For peak season that latency, not the integration effort, is the actual
risk. So I separate "can we ingest their file reliably in six weeks?" (yes) from
"is once-a-night good enough for peak?" (a business decision to make with eyes
open).

## What I commit to

- **Ingest their nightly CSV as-is.** No format changes on their side — we adapt.
  Their IT team's only job is "drop the file on SFTP like you already do."
- **A robust file pipeline**: watch the SFTP drop, ingest each new file exactly
  once (dedup on our deterministic order id, so a re-dropped or overlapping file
  is safe), validate every row, and **dead-letter bad rows with reasons** rather
  than failing the whole file.
- **A visible failure path**: they (and we) can see which rows didn't map and
  why, from day one.
- **Live for peak in six weeks** on the nightly cadence.

## What I push back on

- **"Integration is easy" = "real-time is easy."** I reset that expectation with
  Sales and the customer directly, in writing, before kickoff. Easy to *ingest*;
  nightly by *nature*.
- **No custom format requests to their IT team.** Every "could you just add a
  column / change the date format?" is a schedule risk we don't control. We
  absorb their format instead; if their export is ambiguous (encoding, delimiter,
  timezone, partial last-day rows), we pin those down once, up front, with real
  sample files — not assumptions.
- **Scope creep into returns/cancellations/inventory.** Peak go-live is orders
  in. Everything else is phase 2.

## How I phase it

**Phase 0 — Days 1–5: de-risk the contract.** Get 3–5 real sample files (not a
spec). Confirm delimiter, encoding, date/timezone, currency, status vocabulary,
key/id column, and how deletes/updates appear. Write the config + CSV normalizer
against real data. **Most integration risk dies here**, cheaply.

**Phase 1 — Weeks 2–3: reliable nightly ingestion.** SFTP watcher →
idempotent ingestion → dead-letter + reasons → normalized orders visible on the
platform. Run their real files nightly in staging. Definition of done: a week of
their actual exports flowing clean, failures explainable.

**Phase 2 — Weeks 3–4: harden for peak.** Volume test at peak-day size (files
get big and late during peak). Alerting on "file didn't arrive by Xam," on
DLQ-rate spikes, and on schema drift (a new status value, a shifted column).
Define the manual replay/runbook for a bad or missing file.

**Phase 3 — Weeks 5–6: UAT, reconciliation, go-live.** Reconcile a few days of
their orders against ours end to end with their team. Soft launch, watch the
first few real nightly cycles together, then cut over.

**Phase 4 — post-peak (explicitly deferred):** if latency hurt during peak,
revisit intraday drops (every N hours is often a trivial config change once the
nightly pipeline exists) or a real API later. Named now, scheduled after peak,
so it's a roadmap item and not a broken promise.

## The one-line version

We can absolutely have them live in six weeks — by adapting to their nightly
CSV instead of asking them to change it, and by being honest that "live" means
nightly, not real-time. De-risk the file format in week one, spend the rest on
reliability and peak hardening, and put "faster than nightly" on the post-peak
roadmap rather than the launch commitment.
