# E: local storage and model-based predictive intervals

Accepted 2026-09-17 by the dashboard owner.

## Decision

The existing Sites D1/R2 resources remain canonical and public. Local datasets,
offline caches, development D1/R2 state, test databases and recovery copies live
under E:/DASHBOARD/DASBOARD LTMH/ข้อมูล. Code and Git history remain on C:.
config/storage.json is the Windows storage root; AUM_DATA_ROOT is the explicit
override for other environments. An unavailable root is an error, never a C:
fallback. Builds no longer embed historical database bootstrap payloads.

The migration copied and hashed each file before switching readers. A separate
acceptance record gates deletion of the 27 allowlisted old files. Recovery copies
and original launcher/registry are on E:. No other dashboard is migrated.

## Predictive interval

Center = actual(s) + b * (x(t)-x(s)), with the latest actual reference date s.
OLS uses same-day or previous complete SeriesX AUM, at most seven calendar days
old, never future data. Explicit inception dates exclude pre-launch NAVs.
Missing active funds invalidate the aggregate, never become zero.

Algorithm anchored-bootstrap-v1 uses 10,000 parametric draws. For n training
pairs compute SSE, Sxx and s2=SSE/(n-2). Each draw samples sigma2=SSE/ChiSquare(n-2),
generates Gaussian training errors, refits the slope, and generates an independent
future error. Prediction error is futureError-anchorError+(b-bStar)*deltaX.
Its 2.5% and 97.5% quantiles are added to the observed anchored center. Anchor error
is the simulated residual at the last training point, retaining its covariance
with the refitted slope. This includes new-observation error, not just slope
uncertainty. D3 normal/gamma distributions use a model/date-derived seed.

At the actual reference date both bounds equal the actual. Lower bounds are
clamped to zero. Four to seven pairs are provisional; extrapolation is flagged.
Normal independent constant-variance residuals and a stable linear relationship
are assumptions, not evidence of coverage accuracy. Time trends, fund universe
changes and concentrated clients can invalidate them. No claim of 95% achieved
backtest coverage is made.

https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd512.htm
https://d3js.org/d3-random

## Versions and history

Algorithm version, canonical actual identities/revisions, matched AUM and
component hashes identify a model. A daily point beyond the training dates uses
that same version. Recorded estimates are immutable and keyed by input hash, so
a correction on an existing date appends an estimate. The chart's historical
projection is explicitly reconstructed with the current model, not a vintage
backtest. Genuine as-of backtests require announcement and availability histories;
the current model must never be applied to pretend it was known earlier.

## Fund evidence

ONE-HUMANOID-X-UH is SeriesX Selected. SEC factsheet dated 2026-09-03,
published for the 2026-09-10 offering, specifies registration 2026-09-16 and the
exact unhedged class. The pre-registration 2026-09-15 quote is excluded pending a
valid observation. Do not reinterpret IPO proceeds as post-launch AUM.

https://www.wealthx.co/announcements/6aa75e48ca8ea8ae08c7e58f
https://market.sec.or.th/public/mrap/MRAPFile.aspx?FILESEQUENCE=1&FUNDCOMPRUNCODE=MF06722569&FUNDNAME=ONE-HUMANOID&PERIOD=2026-09-10&REPORTID=47

## Release and rollback

Generated migrations add nullable columns and replace only the projection
uniqueness index. Existing records are not rewritten. The first new refresh
archives pre-update canonical tables to R2 backups/2026-09-17-interval-v1/ with
per-part SHA-256 and a manifest before catalog/data changes. Documents remain
content-addressed. Redeploy the prior Sites version for code rollback; restoration
of data is a separate controlled operator action, not a public bootstrap route.

URLs, public access, registry ID and exact shortcut are unchanged. GitHub Actions
continues 02:00 UTC daily with concurrency protection; actual job start/end are
shown. Queue timing is not guaranteed.

https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
