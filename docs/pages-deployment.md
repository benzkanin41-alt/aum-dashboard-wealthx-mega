# GitHub Pages deployment

## One application, one canonical backend

The Pages URL is
[aum-dashboard-wealthx-mega](https://benzkanin41-alt.github.io/aum-dashboard-wealthx-mega/).
It builds the existing `index.html`, `src/main.tsx`, `src/App.tsx` and
`src/styles.css`. There is no separate Pages UI, fund catalog, projection
formula, data snapshot, database or refresh implementation.

The canonical API remains
[the public Sites dashboard](https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site).
Sites retains its D1/R2 storage; the existing local proxy at
`http://127.0.0.1:12014/` continues to use that same backend. These deployment
files do not change the local proxy, its port, the Sites release or its output.

The shared API resolver in `src/api.ts` applies
`import.meta.env.VITE_DASHBOARD_API_ORIGIN` to every existing API fetch,
including dashboard, version, refresh, refresh status and fund details. Its
default is empty for same-origin Local/Sites requests. The Pages config defines
that value as `https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site` at build
time. It is a public origin, not a credential. The canonical worker's existing
CORS handling supports GET, POST, OPTIONS and the `content-type` header.

Pages hosts only application files. Reads and Update-button requests go
directly to the canonical API; no data is fetched or refreshed during the static
build. Canonical data changes do not require another Pages build; UI code
changes do. The same UI can show different versions briefly while its existing
polling/request cycle runs. Compare `dataVersion` and `model.id` when checking
synchronization. Source contracts: [shared API resolver](../src/api.ts),
[worker CORS](../worker/http.ts), [model](../shared/model.js) and
[canonical storage ADR](adr/0001-sites-d1-as-canonical-dashboard-store.md).

## Isolated build

Run from the repository root with Node.js satisfying [package.json](../package.json)'s
engine requirement and the existing lockfile:

```sh
npm ci --include=dev --no-audit --no-fund
npm run build:pages
```

If locked dependencies are already installed, run just `npm run build:pages`.
Changing the package script does not require a lockfile update. `npm ci` is for
clean CI installation, not for regenerating `package-lock.json`.

[vite.pages.config.ts](../vite.pages.config.ts) uses only Vite and the React
plugin. It imports neither the main Vite config nor Cloudflare/Sites plugins or
local `DATA_ROOT` helpers. `envDir: false` disables dotenv-file loading. The
project base is `/aum-dashboard-wealthx-mega/`; JS, CSS and imported assets retain
Vite's normal hashed static-asset handling under that base.

`publicDir: false` matches Sites and excludes the older standalone
`public/index.html`, `public/app.js` and `public/styles.css`. They are not the
React dashboard and must not replace its entry or styles.

Output is exclusively `dist-pages/index.html` and its generated assets. Vite
cleans only `dist-pages` on rebuild. The script does not call `clean-dist.js`,
`prepare-site-dist.js`, the Sites build, a deployment CLI or a refresh script.
The existing Sites `dist` is not an input or output. Do not commit generated
`dist-pages`; the workflow uploads it as an artifact. The Pages build does not
substitute for the existing typecheck/regression tests.

## Publishing and daily timing

The filename remains [.github/workflows/pages.yml](../.github/workflows/pages.yml)
so the existing external daily automation can continue dispatching it without
reconfiguration. Existing scheduler policy: [scheduler.md](scheduler.md) and
[scheduler-policy.js](../scripts/scheduler-policy.js).

| Trigger | Canonical refresh | Pages publication |
| --- | --- | --- |
| Push to `main` | Skipped; no source refresh | Build, upload, deploy |
| Dispatch, `mode=manual` | Existing manual refresh client | After successful refresh and canonical verification |
| Dispatch, `mode=daily` | Existing idempotent daily decision | After successful refresh or a successful daily skip |
| Schedule `0 2 * * *` | `mode=daily` fallback | After successful refresh or a successful daily skip |

02:00 UTC is 09:00 Asia/Bangkok. The existing external 09:00 Thailand automation
dispatches `pages.yml` on `main` with `mode=daily`; this change neither provisions
nor edits that provider job. Daily mode skips before the target or when today's
completed canonical job already matches the current snapshot. A skip exits
successfully, so the static application is still published. Refresh failures
block publication; pushes can build with the refresh job skipped. Explicit
status conditions let the build and deploy jobs run after that intentional skip.

The original `ltmh-wealthx-sites-refresh` concurrency group and
`cancel-in-progress: false` are retained across the entire workflow. The existing
daily policy, canonical cooldown, shared refresh lock and resumable polling
remain unchanged. Scheduling/deployment queues can delay execution; 09:00 is a
target, not a promise of completion at that minute. External dispatch and GitHub
fallback can both publish, but the existing daily policy prevents a second
completed daily data refresh.

Refresh and build jobs have only `contents: read`. Only the separate deploy job
has `pages: write` and `id-token: write`; it uses the `github-pages` environment
and the uploaded build artifact. Checkouts do not persist credentials. No PAT,
Sites deployment credential or external-scheduler key is required by the added
build/deploy jobs.

Before an authorized release, repository Settings > Pages must use GitHub
Actions and the `github-pages` environment must permit deployment from `main`.
The configuration action does not automatically enable Pages. Validate the
shared API resolver and canonical CORS behavior before publishing. This change
alone does not commit, push, dispatch, deploy, refresh data, change provider
configuration, start/restart another dashboard or modify Chrome bookmarks.

## Verification and rollback

Local validation completed on 2026-10-03 using already-installed dependencies:

- `npm run build:pages` passed: `index.html` (846 bytes),
  `assets/index-DLLT_A3Y.css` (14,070 bytes) and
  `assets/index-CHoru_yd.js` (626,426 bytes). Only these three static files were
  emitted. Vite reported the existing application's JS chunk above 500 kB;
  code splitting was not changed because shared UI changes are outside scope.
- `npm run typecheck` and all eight existing scheduler tests passed.
- YAML structure, isolated permissions, action versions and seven push,
  schedule/dispatch, failure and cancellation condition cases passed offline.
- All five API paths passed with both empty and canonical origins (10 cases),
  preserving request options and encoded query/path values. Fetch was stubbed;
  these checks made zero network requests and never started a refresh.
- The Pages CSS SHA-256 matched the pre-existing Sites CSS. `package-lock.json`,
  the main Vite config and all 14 pre-existing Sites output files retained their
  pre-build hashes. No package installation or Sites build was run.

These are local/offline checks, not a live GitHub workflow execution or browser
deployment test. Repository Pages settings, environment authorization and the
public Pages runtime remain to be verified during a separately authorized
release. External-provider configuration and credentials were not inspected.

1. Run `npm run build:pages`; confirm asset URLs use
   `/aum-dashboard-wealthx-mega/assets/` and the bundle uses the canonical API
   origin. There must be no worker, D1/R2 files or older standalone app in it.
2. Confirm `package-lock.json`, the main Vite config and the pre-existing Sites
   `dist` are unchanged by the Pages build. Preserve concurrent source changes.
3. After a separately authorized release, verify the Pages URL renders the
   shared UI and all API fetches, including Update/fund details, reach Sites.
   Compare canonical `dataVersion` and `model.id` across Pages, Sites and Local.
4. Check daily skip and actual refresh runs, workflow completion, deployed commit
   and real timestamps. Provider dispatch success alone does not prove refresh
   or Pages publication.

For rollback, rebuild/publish a known-good revision through the same workflow
only when authorized. Do not replace canonical data or change the existing
model, scheduler client, cooldown or Sites/local deployment settings.

## Primary references

References checked on 2026-10-03. GitHub/Vite documentation is living material
without a displayed publication date; action release dates are included below.

- [GitHub Pages custom workflows and build/deploy jobs](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
- [Workflow conditions and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
- [Vite GitHub Pages base-path guidance](https://vite.dev/guide/static-deploy.html#github-pages).
- [actions/checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), released 2026-07-20; existing `@v7` retained.
- [actions/setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0), released 2026-07-14; existing `@v7` retained.
- [actions/upload-pages-artifact v5.0.0](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0), released 2026-04-10; workflow uses `@v5`.
- [actions/configure-pages v6.0.0](https://github.com/actions/configure-pages/releases/tag/v6.0.0), released 2026-03-25; workflow uses `@v6`.
- [actions/deploy-pages v5.0.1](https://github.com/actions/deploy-pages/releases/tag/v5.0.1), released 2026-09-01; workflow uses `@v5`.

The general Pages guide still shows earlier action majors. These versions were
checked against current official GitHub action releases and their tagged action
definitions, not inferred from third-party examples.
