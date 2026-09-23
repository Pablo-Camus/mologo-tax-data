#!/usr/bin/env node
// fiscal-monitor.mjs — weekly GitHub Action entry point.
//
// For each official source in sources.json (skipping manual:true countries),
// fetches the page, asks Claude for a structured proposal, and either:
//   - applies it directly to fiscal-data.json (confidence "low"/"medium" entries), or
//   - lists it as a discrepancy to review (confidence "high" entries — never auto-modified).
// Writes proposals/YYYY-MM-DD.md, then (unless --dry-run) opens a PR on a
// fiscal-update-YYYY-MM-DD branch and emails a summary. NEVER pushes to main.
//
// Usage:
//   node scripts/fiscal-monitor.mjs                 # full run, opens PR if needed
//   node scripts/fiscal-monitor.mjs --dry-run        # full run, no branch/PR/email
//   node scripts/fiscal-monitor.mjs --dry-run --countries=ES,FR  # limit scope

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { fetchCountryPages } from './lib/fetch-source.mjs';
import { requestProposal } from './lib/claude-client.mjs';
import { processCountry, mergeIncomeTaxUpdate, mergeSsUpdate } from './lib/process-country.mjs';
import { applyIncomeTaxUpdate, applySsUpdate, applyMetaUpdatedDate } from './lib/apply-changes.mjs';
import { validateFiscalData, validateTaxData } from './lib/validate-data.mjs';
import { buildReport } from './lib/report.mjs';
import { sendNotification } from './lib/mailer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const countriesArg = args.find((a) => a.startsWith('--countries='));
const ONLY_COUNTRIES = countriesArg ? countriesArg.split('=')[1].split(',').map((s) => s.trim().toUpperCase()) : null;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: repoRoot, stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf8' });
}

async function main() {
  const date = todayISO();
  const sourcesConfig = JSON.parse(readFileSync(path.join(repoRoot, 'sources.json'), 'utf8'));
  const fiscalRawOriginal = readFileSync(path.join(repoRoot, 'fiscal-data.json'), 'utf8');
  const fiscalData = JSON.parse(fiscalRawOriginal);

  let countryCodes = Object.keys(sourcesConfig.countries);
  if (ONLY_COUNTRIES) countryCodes = countryCodes.filter((c) => ONLY_COUNTRIES.includes(c));

  const skippedManual = [];
  const apiKey = process.env.CLAUDE_API_KEY;

  const allApplied = [];
  const allDiscrepancies = [];
  const allFetchFailures = [];
  const allParseFailures = [];
  const allRejectedSources = [];
  const checkedCodes = [];
  const okCodes = []; // pages fetched and Claude answered with a parseable proposal

  let fiscalRaw = fiscalRawOriginal;

  for (const code of countryCodes) {
    const config = sourcesConfig.countries[code];
    if (config.manual) { skippedManual.push(code); continue; }
    if (!fiscalData[code]) { allFetchFailures.push({ code, reason: 'no entry in fiscal-data.json' }); continue; }

    console.log(`[fiscal-monitor] checking ${code}...`);
    const result = await processCountry({
      code,
      config,
      currentEntry: fiscalData[code],
      fetchPages: fetchCountryPages,
      askClaude: (a) => requestProposal({ apiKey, ...a }),
      extraAllowlist: sourcesConfig.euVatAllowlistExtra || [],
    });

    checkedCodes.push(code);
    const allUrlsFailed = result.fetchFailures.length >= (config.urls || []).length;
    if (!allUrlsFailed && result.parseFailures.length === 0) okCodes.push(code);
    allFetchFailures.push(...result.fetchFailures);
    allParseFailures.push(...result.parseFailures);
    allRejectedSources.push(...result.rejectedSources);
    allDiscrepancies.push(...result.discrepancyFields);

    for (const applied of result.appliedFields) {
      try {
        if (applied.field === 'income_tax') {
          const merged = mergeIncomeTaxUpdate(applied.before, applied.after, date);
          fiscalRaw = applyIncomeTaxUpdate(fiscalRaw, code, merged);
          applied.after = merged;
        } else if (applied.field === 'ss') {
          const merged = mergeSsUpdate(applied.before, applied.after);
          fiscalRaw = applySsUpdate(fiscalRaw, code, merged);
          applied.after = merged;
        }
        allApplied.push(applied);
      } catch (e) {
        allParseFailures.push({ code, reason: `failed to apply ${applied.field} update: ${e.message}` });
      }
    }
  }

  if (allApplied.length > 0) {
    fiscalRaw = applyMetaUpdatedDate(fiscalRaw, date);
  }

  const report = buildReport({
    date,
    applied: allApplied,
    discrepancies: allDiscrepancies,
    fetchFailures: allFetchFailures,
    parseFailures: allParseFailures,
    rejectedSources: allRejectedSources,
    skippedManual,
  });

  if (DRY_RUN) {
    console.log('\n===== DRY RUN — report (not written, no branch/PR/email) =====\n');
    console.log(report);
    console.log('\n===== end dry run =====');
    return;
  }

  // Failures are never silent: they are always logged, and if no country
  // could be checked at all (e.g. an invalid CLAUDE_API_KEY) the job fails.
  const failureCount = allFetchFailures.length + allParseFailures.length;
  if (failureCount > 0) {
    console.warn(`[fiscal-monitor] ${failureCount} failure(s):\n` +
      [...allFetchFailures, ...allParseFailures].map((f) => `- ${f.code}: ${f.reason}`).join('\n'));
  }
  const allFailed = checkedCodes.length > 0 && okCodes.length === 0;

  const hasChangesOrDiscrepancies = allApplied.length > 0 || allDiscrepancies.length > 0;
  if (!hasChangesOrDiscrepancies) {
    if (failureCount > 0) {
      await sendNotification({
        subject: allFailed
          ? '[Mologo fiscal-monitor] FAILED — no country could be checked'
          : `[Mologo fiscal-monitor] no changes, but ${failureCount} check(s) failed`,
        text: report,
      });
      if (allFailed) process.exitCode = 1;
      return;
    }
    console.log('[fiscal-monitor] no changes, no discrepancies, no failures — silent exit (no PR, no email).');
    return;
  }

  // Validate the proposed fiscal-data.json (in memory) + the untouched tax-data.json before writing/committing anything.
  let updatedFiscalData;
  try {
    updatedFiscalData = JSON.parse(fiscalRaw);
  } catch (e) {
    await sendNotification({
      subject: '[Mologo fiscal-monitor] validation FAILED — malformed JSON, no PR opened',
      text: `fiscal-monitor produced invalid JSON while applying updates on ${date}:\n\n${e.message}\n\nNo branch or PR was created. Investigate scripts/lib/apply-changes.mjs.`,
    });
    console.error('[fiscal-monitor] produced invalid JSON — aborting without opening a PR.', e.message);
    process.exitCode = 1;
    return;
  }

  const taxData = JSON.parse(readFileSync(path.join(repoRoot, 'tax-data.json'), 'utf8'));
  const validationErrors = [
    ...validateFiscalData(updatedFiscalData, sourcesConfig).map((e) => `[fiscal-data.json] ${e}`),
    ...validateTaxData(taxData).map((e) => `[tax-data.json] ${e}`),
  ];

  if (validationErrors.length > 0) {
    await sendNotification({
      subject: '[Mologo fiscal-monitor] validation FAILED — no PR opened',
      text: `fiscal-monitor's proposed changes on ${date} failed validation:\n\n${validationErrors.map((e) => `- ${e}`).join('\n')}\n\nNo branch or PR was created.`,
    });
    console.error('[fiscal-monitor] validation failed — aborting without opening a PR:\n' + validationErrors.join('\n'));
    process.exitCode = 1;
    return;
  }

  // Write files.
  mkdirSync(path.join(repoRoot, 'proposals'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'proposals', `${date}.md`), report + '\n');
  if (allApplied.length > 0) {
    writeFileSync(path.join(repoRoot, 'fiscal-data.json'), fiscalRaw);
  }

  // Git: branch, commit, push — NEVER to main.
  const branch = `fiscal-update-${date}`;
  sh('git', ['config', 'user.name', 'Mologo Fiscal Bot']);
  sh('git', ['config', 'user.email', 'bot@mologo.app']);
  sh('git', ['checkout', '-b', branch]);
  sh('git', ['add', 'proposals/', ...(allApplied.length > 0 ? ['fiscal-data.json'] : [])]);
  const commitTitle =
    allApplied.length > 0
      ? `fiscal: update ${[...new Set(allApplied.map((a) => a.code))].join(', ')} (${date})`
      : `fiscal: discrepancy report ${date}`;
  sh('git', ['commit', '-m', commitTitle]);
  sh('git', ['push', 'origin', branch]);

  // Ensure the label exists (idempotent — ignore failure if it already does).
  try {
    sh('gh', ['label', 'create', 'fiscal-update', '--color', 'FBCA04', '--description', 'Automated fiscal data monitor'], { silent: true });
  } catch {
    // already exists — fine
  }

  const prTitle =
    allApplied.length > 0
      ? `Fiscal data update: ${[...new Set(allApplied.map((a) => a.code))].join(', ')} — ${date}`
      : `Fiscal data discrepancy report — ${date}`;
  const prOutput = sh(
    'gh',
    ['pr', 'create', '--title', prTitle, '--body', report, '--head', branch, '--base', 'main', '--label', 'fiscal-update'],
    { silent: true }
  );
  const prUrl = String(prOutput).trim().split('\n').pop();
  console.log(`[fiscal-monitor] PR opened: ${prUrl}`);

  await sendNotification({
    subject: `[Mologo fiscal-monitor] ${prTitle}`,
    text: `${report}\n\nPR: ${prUrl}`,
  });
}

main().catch(async (e) => {
  console.error('[fiscal-monitor] fatal error:', e);
  if (!DRY_RUN) {
    await sendNotification({
      subject: '[Mologo fiscal-monitor] job crashed',
      text: `fiscal-monitor crashed on ${todayISO()}:\n\n${e.stack || e.message || e}`,
    }).catch(() => {});
  }
  process.exitCode = 1;
});
