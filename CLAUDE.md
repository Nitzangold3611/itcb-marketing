# Working rules for this repo (ITCB marketing plan site)

- UI language is Hebrew (RTL). Keep the existing design tokens in `public/styles.css`.
- **Do not push to GitHub without the owner's explicit approval.** Every push to `main` deploys to Netlify (costs build credits). Commit locally, batch changes into a version, push only when approved.
- **Before proposing a push, run the full QA suite (`npm test`) and give the owner the report** (summary from `tests/reports/v<version>.md`, full HTML in `tests/reports/latest.html`) plus screenshots of what changed. Never push with failing tests.
- New features need tests (API in `tests/api.test.mjs`, UI in `tests/e2e/`). Fix flaky tests at the root cause; don't add sleeps.
- Every version: bump `VERSION` in `public/app.js` and `?v=` in `public/index.html`, add a row to the versions table in `README.md`, commit the report `tests/reports/v<version>.md`.
- Secrets live only in Netlify env vars (`SESSION_SECRET`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_NAME`). Never commit them.
- Production data lives in Netlify Blobs (store `itcb-marketing`), not in git. `netlify/functions/lib/seed.mjs` is only the first-run seed.
