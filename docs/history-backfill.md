# Published AUM history repair

## 2026-10-03: TLCHINASTAR50-X

The catalog correctly records inception on 2026-09-24. The initial latest-feed
import contained only 2026-09-30, so strict SeriesX completeness left a gap on
2026-09-24, 25, 28 and 29. No old observation had been deleted.

The approved repair reads the official Talis history for fund row 40081:
https://nav.talisam.co.th/index_NAV_Sum_Table.jsp?p_fund_code=40081&p_lang=EN&year1=year1

Published rows: 2026-09-24 (NAV 9.9996; net assets THB 14,171,770.97),
2026-09-28 (NAV 9.7220; THB 13,778,392.55), and
2026-09-29 (NAV 9.8101; THB 13,986,709.45).
There is no raw observation invented for September 25, 26 or 27. The existing
at-most-seven-day carry-forward rule provides valid aggregate coverage.

## Safety Contract

- A trusted, versioned allowlist binds the fund, Talis row, inception, date range
  and complete set of published dates. No public arbitrary import endpoint.
- Validate identity against the current official feed and require full historical
  coverage before mutation. Existing conflicting rows require manual review.
- Save the target fund's original rows and source HTML to R2 before the D1 batch;
  include a SHA-256 source hash in each added point and audit entry.
- Atomically insert missing points, per-point audits and the completion marker.
  Never UPDATE or DELETE existing observations. Retry a failed repair on a later
  refresh; a completed repair skips the history request on subsequent refreshes.
- Run through the existing shared refresh lock and five-minute throttle. Local
  and Online use the same canonical D1 snapshot, not independent imports.
- Preserve the formulas, model version for unchanged training data, old
  snapshots/projections, UI, scheduler, port, registry and shortcut.

## Acceptance Checklist

1. Capture all fund histories and the current snapshot on E: before release.
2. Test partial source, outage, identity/inception mismatch, duplicate, conflict,
   interruption/rollback, retry and existing-row preservation in isolated DBs.
3. Check complete SeriesX AUM and lower/mid/upper on all affected aggregate dates;
   calculate totals and the anchored formula independently. No future matching.
4. Confirm old points, official AUA, model and all unaffected timeline values
   remain unchanged. Verify protected source and shortcut hashes.
5. Publish on the same Site and test signed-out Update buttons sharing one job,
   closing/reopening a tab, version polling and E: cache/last-good copy.
6. Check desktop/iPhone/iPad, both themes and 1Y/6M/3M/1M; do not bridge nulls as
   a cosmetic repair. Cold-start the original shortcut and verify appId/12014.
7. Reuse the existing free daily updater at 09:00 Asia/Bangkok. Check the actual
   start/completion timestamps and daily duplicate guard; future executions
   cannot be certified before they happen.

Cloudflare D1 batch transaction behavior:
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
