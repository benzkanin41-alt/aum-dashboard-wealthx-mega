# Daily refresh scheduling

This integration only changes the scheduler client and its GitHub workflow. It
does not change the Sites deployment, API, database schema, source ingestion,
projection formulas, local cache, launcher, or dashboard presentation.

## Delivery

- Intended primary: cron-job.org POST at 09:00 Asia/Bangkok to the existing
  GitHub workflow dispatch endpoint, with `mode=daily` and `ref=main`.
- GitHub's existing 02:00 UTC schedule remains enabled as a fallback. Do not
  disable it until the external provider's saved job and a real dispatch pass.
- The standard Linux runner uses the existing resumable Sites refresh API.
  A single POST to Sites is insufficient to finish the refresh.
- GitHub concurrency serializes workflow runs. The Sites lock also coalesces
  concurrent local and online button requests into one canonical job.
- Daily mode skips before the day's 09:00 target, or when the current canonical
  job started after that target, completed, and matches the current snapshot.
  Running, failed, missing, mismatched, future-dated and early jobs never count
  as today's completed refresh. Manual mode retains the existing behavior.
- Scheduling, runner queues and upstream availability have no exact-time
  guarantee. The workflow summary records actual start/completion and delay.
- A completed refresh may still report a partial source check (for example,
  SET unavailable with IR fallback). It does not certify every source as healthy.

## Credentials and provisioning

Use a private JSON file outside this repository containing `cronJobApiKey` and
`githubActionsToken`. Never include it in Git, screenshots, reports or logs.
The GitHub token must be fine-grained, limited to this repository, and have
Actions read/write plus required Metadata read-only. Rotate before expiration.
The cron-job.org management key can be IP-restricted and is not needed for
scheduled execution after setup; it is only used to configure/read back jobs.

Run `node scripts/configure-cron-job.js --credentials <private-file>` for a
read-only preflight. Add `--apply` to create or update the uniquely matching
job. A duplicate or ambiguous match aborts without touching other jobs.
The helper checks the provider's saved schedule and next 09:00 execution,
and writes a redacted verification file beside the credential file.
Provider readback alone is not an end-to-end test: verify a real cron request,
the resulting GitHub run, and the canonical Sites job separately.

## Regression checks

- `node --test tests/*.test.js`
- `REFRESH_MODE=daily node scripts/run-sites-refresh.js` after a completed run:
  must skip, exit successfully, and retain the canonical job/data version.
- `node scripts/qa-live-refresh.js`: signed-out Update buttons share a job,
  resume after page closure, and sync local/online/cache without losing filters.
- Preserve hashes of the formula, UI, API, cache and launcher files.
- Cold-start the existing desktop shortcut and verify `appId=aum-dashboard`.
- Keep the prior data and scheduler files available as rollback copies.

## Primary references (checked 2026-09-18)

- https://cron-job.org/en/faq/
- https://docs.cron-job.org/rest-api.html
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
- https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
