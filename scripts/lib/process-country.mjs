// process-country.mjs — orchestrates one country's check: fetch → ask Claude
// → parse → classify as "applied" (low/medium confidence, safe to write) or
// "discrepancy" (confidence:high, report only). Network calls are injected
// (fetchPages, askClaude) so this stays unit-testable with fixtures.

import { parseProposal, isAllowedSource } from './parse-proposal.mjs';

/**
 * @param {object} params
 * @param {string} params.code
 * @param {{urls:string[], allowlist:string[], manual?:boolean}} params.config
 * @param {{income_tax:object, ss:object|null}} params.currentEntry
 * @param {(urls:string[]) => Promise<{text:string, failures:Array<{url:string,reason:string}>}>} params.fetchPages
 * @param {(args:{code:string,currentEntry:object,pageText:string}) => Promise<{ok:boolean, raw?:string, reason?:string}>} params.askClaude
 * @param {string[]} [params.extraAllowlist]
 */
export async function processCountry({ code, config, currentEntry, fetchPages, askClaude, extraAllowlist = [] }) {
  const result = {
    code,
    appliedFields: [],
    discrepancyFields: [],
    fetchFailures: [],
    parseFailures: [],
    rejectedSources: [],
  };

  const { text, failures } = await fetchPages(config.urls);
  for (const f of failures) result.fetchFailures.push({ code, reason: `${f.url} — ${f.reason}` });
  if (!text || !text.trim()) return result;

  const claudeResult = await askClaude({ code, currentEntry, pageText: text });
  if (!claudeResult.ok) {
    result.parseFailures.push({ code, reason: claudeResult.reason });
    return result;
  }

  const parsed = parseProposal(claudeResult.raw);
  if (!parsed.ok) {
    result.parseFailures.push({ code, reason: parsed.errors.join('; ') });
    return result;
  }

  const proposal = parsed.proposal;
  if (!proposal.changed) return result;

  const currentConfidence = currentEntry?.income_tax?.confidence;
  const allow = config.allowlist || [];

  for (const field of ['income_tax', 'ss']) {
    const p = proposal[field];
    if (!p) continue;

    if (!isAllowedSource(p.sourceUrl, allow, extraAllowlist)) {
      result.rejectedSources.push({
        code,
        reason: `${field} proposal sourceUrl "${p.sourceUrl}" is not in the official allowlist for ${code} [${allow.join(', ')}]`,
      });
      continue;
    }

    const currentField = field === 'income_tax' ? currentEntry?.income_tax : currentEntry?.ss;

    if (currentConfidence === 'high') {
      result.discrepancyFields.push({ code, field, current: currentField, proposed: p, sourceUrl: p.sourceUrl, quote: p.quote });
    } else {
      result.appliedFields.push({ code, field, before: currentField, after: p, sourceUrl: p.sourceUrl, quote: p.quote });
    }
  }

  return result;
}

/**
 * Merges an applied income_tax proposal onto the current object, producing
 * the full replacement object for apply-changes.mjs#formatIncomeTaxBlock.
 * Confidence is always downgraded/kept at "medium" — never "high" (per spec,
 * the bot must never mark its own writes as manually-verified).
 */
export function mergeIncomeTaxUpdate(currentIncomeTax, proposedIncomeTax, checkedDate) {
  return {
    name: currentIncomeTax?.name,
    year: proposedIncomeTax.year ?? currentIncomeTax?.year,
    confidence: 'medium',
    brackets: proposedIncomeTax.brackets ?? null,
    note: proposedIncomeTax.note ?? currentIncomeTax?.note,
    source: proposedIncomeTax.sourceUrl,
    checked: checkedDate,
  };
}

/**
 * Merges an applied ss proposal onto the current object.
 */
export function mergeSsUpdate(currentSs, proposedSs) {
  return {
    name: currentSs?.name,
    mode: proposedSs.mode,
    rate: proposedSs.rate,
    note: proposedSs.note ?? currentSs?.note,
    source: proposedSs.sourceUrl,
  };
}
