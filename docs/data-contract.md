# Dashboard Data Contract

## Canonical Store

- Sites D1 is the canonical store for fund metadata, daily AUM, official AUA,
  source state, refresh jobs, model versions, projections, audit records, and
  dashboard snapshots.
- Sites R2 stores immutable copies of official AUA documents keyed by content
  hash.
- The Local dashboard reads the same API and atomically replaces its last-good
  cache only after validating `appId = aum-dashboard`.

## AUM Buckets

- `wealthx_other`: strict WealthX SeriesX funds and the only projection input.
- `mega30`: MEGA30 plus TLUSHD classes; display only.
- `other_funds`: additional thematic funds; display only.
- Missing fund observations are never replaced with zero. Aggregate points
  retain active-fund coverage and fund inception dates.

## Official AUA

- Accept only historical actual AUA reported by LTMH through SET or LTMH
  Investor Relations.
- Targets, guidance, forecasts, and management estimates are not actuals.
- Store reference date, announcement time, and discovery time separately.
- De-duplicate repeated news by observation identity and document hash.
- A conflicting amount or unclear date is `pending_review`; it does not enter
  model training.
- SET failure triggers an LTMH IR fallback and an incomplete-verification status.
  SET is checked again on later refreshes.

## Refresh Contract

- `POST /api/refresh` accepts no user-supplied source URL or financial value.
- One refresh job is shared by simultaneous callers.
- A completed run prevents a new run for five minutes and returns the existing
  job with a retry interval.
- Work is staged and cursor-backed so each request advances or resumes the same
  job.
- `GET /api/refresh/status?job=...` exposes progress. `advance=1` advances one checkpoint.
- `GET /api/dashboard/version` is read-only and does not start or advance jobs.
- Visible clients poll every 15 seconds and on focus/reconnection; Local caches
  validated snapshots on E: with serialized atomic replacement and last-good copy.
- Official-source discovery paginates SET and checks all linked IR PDFs one at a
  time. Reachable HTML alone never means verification is complete. Unknown dates,
  conflicting figures and unreadable documents remain pending review.
- Projections include lower, upper, intervalLevel, intervalMethod,
  algorithmVersion and inputFingerprint. Historical chart estimates are labeled
  reconstructed; recorded projection revisions remain append-only.
- Every snapshot has immutable `dataVersion` and `modelVersion` identifiers.

## Provenance

Each fund point retains source URL and observation time. Each AUA observation is
linked to one or more archived official documents. Corrections create audit
records and model versions rather than silently replacing historical outputs.
