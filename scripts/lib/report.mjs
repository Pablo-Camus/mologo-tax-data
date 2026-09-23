// report.mjs — pure function building the human-readable Markdown report
// written to proposals/YYYY-MM-DD.md and used as the PR body.

/**
 * @param {object} run
 * @param {string} run.date - YYYY-MM-DD
 * @param {Array<{code:string, field:string, before:any, after:any, sourceUrl:string, quote:string}>} run.applied
 * @param {Array<{code:string, field:string, current:any, proposed:any, sourceUrl:string, quote:string}>} run.discrepancies - confidence:high entries with a proposed diff
 * @param {Array<{code:string, reason:string}>} run.fetchFailures
 * @param {Array<{code:string, reason:string}>} run.parseFailures
 * @param {Array<{code:string, reason:string}>} run.rejectedSources - proposals rejected for an off-allowlist source
 * @param {string[]} run.skippedManual - country codes skipped as manual:true
 */
export function buildReport(run) {
  const { date, applied = [], discrepancies = [], fetchFailures = [], parseFailures = [], rejectedSources = [], skippedManual = [] } = run;
  const lines = [];

  lines.push(`# Fiscal data monitor — ${date}`);
  lines.push('');

  if (applied.length === 0 && discrepancies.length === 0) {
    lines.push('No changes and no discrepancies found this run.');
  }

  if (applied.length > 0) {
    lines.push(`## Changes applied (${applied.length})`);
    lines.push('');
    lines.push('These were `confidence: "low"` or `"medium"` entries — the bot updated them directly, always downgrading/keeping confidence at `"medium"` (never `"high"`).');
    lines.push('');
    for (const c of applied) {
      lines.push(`### ${c.code} — ${c.field}`);
      lines.push(`- Source: ${c.sourceUrl}`);
      lines.push(`- Quote: "${c.quote}"`);
      lines.push(`- Before: \`${JSON.stringify(c.before)}\``);
      lines.push(`- After: \`${JSON.stringify(c.after)}\``);
      lines.push('');
    }
  }

  if (discrepancies.length > 0) {
    lines.push(`## Discrepancies to review — confidence:high, NOT auto-applied (${discrepancies.length})`);
    lines.push('');
    lines.push('These entries are marked `confidence: "high"` (manually verified), so the bot never overwrites them automatically — even when the official page now appears to say something different. Review by hand.');
    lines.push('');
    for (const d of discrepancies) {
      lines.push(`### ${d.code} — ${d.field}`);
      lines.push(`- Source checked: ${d.sourceUrl}`);
      lines.push(`- Quote: "${d.quote}"`);
      lines.push(`- Current stored value: \`${JSON.stringify(d.current)}\``);
      lines.push(`- Value suggested by source: \`${JSON.stringify(d.proposed)}\``);
      lines.push('');
    }
  }

  if (rejectedSources.length > 0) {
    lines.push(`## Rejected — source not in official allowlist (${rejectedSources.length})`);
    lines.push('');
    for (const r of rejectedSources) lines.push(`- **${r.code}**: ${r.reason}`);
    lines.push('');
  }

  if (fetchFailures.length > 0) {
    lines.push(`## Fetch failures (${fetchFailures.length})`);
    lines.push('');
    for (const f of fetchFailures) lines.push(`- **${f.code}**: ${f.reason}`);
    lines.push('');
  }

  if (parseFailures.length > 0) {
    lines.push(`## Parse/schema failures (${parseFailures.length})`);
    lines.push('');
    for (const p of parseFailures) lines.push(`- **${p.code}**: ${p.reason}`);
    lines.push('');
  }

  if (skippedManual.length > 0) {
    lines.push(`## Skipped — manual review only (bot-blocked sources)`);
    lines.push('');
    lines.push(skippedManual.join(', '));
    lines.push('');
  }

  return lines.join('\n');
}
