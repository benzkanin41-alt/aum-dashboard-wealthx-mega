# SeriesX catalog upgrade: 2026-10-03

## Evidence and scope

All 14 supplied images in `E:/Download/LTMH` were compared with catalog
`2026-09-17.1` and the live canonical dashboard on 2026-10-03. The 27 unique
SeriesX codes contain exactly one missing fund: `TLCHINASTAR50-X`. The other
26 already exist, including `ONE-HUMANOID-X-UH`. The catalog becomes
`2026-10-03.1`: SeriesX 27, MEGA30+TLUSHD 33, other funds 9.

Primary sources checked 2026-10-03:

- [WealthX fund page](https://www.wealthx.co/funds/TLCHINASTAR50-X).
- [Talis fund page](https://www.talisam.co.th/tlchinastar50-x/): registered
  2026-09-24; no separate unit class is fabricated from the `-X` suffix.
- [SEC MRAP](https://market.sec.or.th/public/mrap/MRAPView.aspx?FTYPE=M&PID=0886&PYR=2569):
  PID 0886, PYR 2569, fund-company code MF08862569. The SEC API's project-ID
  string was not verified, so the catalog uses the exact fund code as its
  name identifier instead of an inferred project ID.
- [Talis latest NAV](https://nav.talisam.co.th/index_NAV_Sum.jsp?p_lang=EN):
  fund row 40081, 2026-09-30 NAV 9.5551 and net assets THB 13,668,178.06
  at the source check. Existing conversion yields AUM THB 13.67 million.
- [Talis history](https://nav.talisam.co.th/index_NAV_Sum_Table.jsp?p_fund_code=40081&p_lang=EN&year1=year1):
  real observations available on 2026-09-24, 28, 29 and 30. The existing
  refresh imports the latest feed, not a historical backfill. Do not invent
  earlier observations or run the destructive legacy history importer to
  fill this one new fund. A future backfill must be additive and audited.

## Preservation rules

- D1/R2 on the existing Sites project remain canonical. Local cache stays
  on E:, Local remains `127.0.0.1:12014`, app ID stays `aum-dashboard`.
- Only append the new catalog entry through the existing versioned upsert.
  Never rerun bootstrap, remove existing funds or overwrite financial history.
- Keep `shared/model.js`, worker logic, CSS, local proxy, storage configuration,
  launcher and desktop shortcut byte-identical. The shared App changes only
  its five API calls to support the public canonical origin on GitHub Pages.
- The anchored projection, 95% interval method, training-data fingerprint,
  model versioning and missing-data rules are unchanged. New fund data after
  the latest Actual does not by itself refit historical training pairs.
- Existing daily policy, shared job lock, five-minute throttle and resumption
  remain unchanged. Target is 09:00 Bangkok; record actual start/completion.
  cron-job.org dispatch is primary and GitHub schedule is the deduplicated
  fallback. GitHub queue delays are not a guarantee of exact-minute execution.

## Release checklist

Baseline and task reports belong under
`E:/DASHBOARD/DASBOARD LTMH/ข้อมูล/tests/fund-upgrade-20261003`.
`before.json` contains the canonical snapshot, all 68 old fund histories and
SHA-256 values for 15 protected source/launcher files. Separate recovery
copies preserve the old catalog, App, workflow, cache and Pages HTML.

1. Run all unit/integration tests and both builds without updating the lockfile.
2. Publish from a clean checkout containing only the scoped commit. Preserve
   unrelated dirty work in the primary checkout.
3. Verify the existing public Sites and GitHub Pages URLs render the shared UI.
4. Cold-start the exact desktop shortcut; verify `api/health.appId`, port,
   cache write and cache ACL without changing folder ACLs.
5. Run `scripts/qa-fund-upgrade.js`: click all three Update buttons without
   login, require one shared job, complete refresh and matching data versions.
   Require one added fund, positive real AUM, preserved old histories/Actuals,
   unchanged model and protected-file hashes, independent anchored calculation,
   preserved Local timeline/scroll and all three new-fund detail views.
6. Run `qa-browser.js` on all three surfaces: desktop/iPhone/iPad, both themes,
   all timelines, charts, touch tooltips and overflow checks.
7. Dispatch the real daily workflow and check its completed-daily skip plus
   Pages deployment. Future timed runs are not tested in advance.
8. If a source is unavailable, retain last-good observations and report the
   incomplete source; never claim complete source coverage from job success.

Rollback requires republishing a known-good code revision, not replacing D1/R2
or deleting newly recorded financial observations. Preserve recovery copies,
audit history, existing access controls and the unchanged desktop shortcut.
