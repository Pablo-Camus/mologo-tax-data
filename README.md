# Mologo Tax Data

Country tax rate data for [Mologo](https://mologo.app) — fetched automatically by the app weekly.

## How to update a rate

Edit `tax-data.json` directly on GitHub. The app fetches it with a 7-day cache, so all users get the update within a week.

## Fields
| Field | Meaning |
|---|---|
| `vn` | VAT name (IVA, MwSt., TVA…) |
| `vs` | VAT standard rate (%) |
| `vr` | Reduced VAT rates |
| `wn` | Withholding tax name (IRPF, TDS…) |
| `wr` | Withholding rate options |
| `wd` | Default withholding rate (%) |

## Last verified
May 2026

## Fiscal data monitor (GitHub Action)

`.github/workflows/fiscal-monitor.yml` runs every Monday 09:00 UTC (and on
`workflow_dispatch`). It never pushes to `main` — it only opens a pull
request, labeled `fiscal-update`, on a `fiscal-update-YYYY-MM-DD` branch, for
a human to review and merge.

For each official source listed in `sources.json` (skipping any marked
`manual: true` — those block automated fetches and need a manual check), it:

1. Fetches the official government page(s).
2. Asks Claude (`claude-haiku-4-5`) for a structured proposal: brackets/rate,
   the exact source URL used, and a verbatim quote supporting the value.
3. Rejects the proposal outright if its `sourceUrl` host isn't in that
   country's allowlist in `sources.json`.
4. Applies or reports, depending on the country's current `confidence` in
   `fiscal-data.json`:
   - **`confidence: "high"`** (manually verified) entries are **never**
     auto-modified. A difference is only listed as a "discrepancy to review"
     in the run's report/PR — never written to the file.
   - **`confidence: "low"`/`"medium"`** entries are updated directly, with
     `confidence` always set to `"medium"` afterwards (the bot never marks
     its own writes as manually-verified `"high"`), plus `source` and
     `checked` (today's date).
5. Runs `scripts/validate.mjs` against the result. If validation fails, no
   PR is opened — the validation errors are emailed instead.
6. Writes a report to `proposals/YYYY-MM-DD.md` (also used as the PR body):
   what changed, what's a discrepancy on `high`-confidence entries, what
   failed to fetch/parse, with the source quote for everything.
7. If a PR was opened, emails a short summary + the PR link.
8. If nothing changed and there are no discrepancies: silent (job log only,
   no PR, no email).

`fiscal-data.json` and `tax-data.json` are **hand-formatted** — the monitor
never rewrites the whole file. It locates the exact `"income_tax": {...}` /
`"ss": {...}` span for the touched country by brace-matching the raw text and
splices in a re-formatted replacement for just that span (see
`scripts/lib/apply-changes.mjs`).

### Required repo secrets

| Secret | Used for |
|---|---|
| `CLAUDE_API_KEY` | Calling the Claude API to parse official pages |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `ADMIN_EMAIL` | Emailing a summary when a PR opens, or validation errors when one doesn't |

Missing SMTP secrets don't fail the job — the monitor logs and continues
without emailing (see `scripts/lib/mailer.mjs`).

### Local dev

```
npm install
npm test                    # unit tests, no network (node:test + fixtures)
npm run validate            # validate current fiscal-data.json + tax-data.json
npm run monitor:dry-run     # real fetch + real Claude call, prints the report, no branch/PR/email
node scripts/fiscal-monitor.mjs --dry-run --countries=ES,FR   # limit the dry run to specific countries
```

`monitor:dry-run` needs `CLAUDE_API_KEY` in the environment.
