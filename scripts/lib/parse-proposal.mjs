// parse-proposal.mjs — pure functions, no network.
// Parses Claude's raw text response into a structured proposal and validates
// it against the expected schema before anything downstream trusts it.

/**
 * Extracts the first JSON object found in a string, stripping ``` fences if
 * present. Claude sometimes wraps its answer in a code fence, sometimes adds
 * a sentence before/after the JSON — this handles both.
 * @param {string} raw
 * @returns {object|null}
 */
export function extractJsonObject(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let text = raw.trim();

  // Strip a leading/trailing ``` or ```json fence.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Find the first balanced {...} block, in case there's prose around it.
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;

  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * Schema-checks a parsed proposal object for a country's income_tax + ss data.
 * Returns { ok: true, proposal } or { ok: false, errors: string[] }.
 *
 * Expected shape (fields optional except where noted):
 * {
 *   changed: boolean,               // required
 *   income_tax?: {
 *     year: number,
 *     brackets: [{ from, to, rate }, ...] | null,
 *     note?: string,
 *     sourceUrl: string,             // required if income_tax present
 *     quote: string                  // required — snippet supporting the value
 *   },
 *   ss?: {
 *     name?: string,
 *     mode: 'percent' | 'fixed',
 *     rate: number | null,
 *     note?: string,
 *     sourceUrl: string,
 *     quote: string
 *   }
 * }
 */
export function validateProposal(proposal) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object') {
    return { ok: false, errors: ['proposal is not an object'] };
  }
  if (typeof proposal.changed !== 'boolean') {
    errors.push('missing/invalid "changed" boolean');
  }
  if (proposal.changed === false) {
    return errors.length ? { ok: false, errors } : { ok: true, proposal };
  }

  if (proposal.income_tax !== undefined) {
    const it = proposal.income_tax;
    if (!it || typeof it !== 'object') {
      errors.push('income_tax must be an object');
    } else {
      if (it.brackets !== null) {
        if (!Array.isArray(it.brackets) || it.brackets.length === 0) {
          errors.push('income_tax.brackets must be a non-empty array or null');
        } else {
          it.brackets.forEach((b, idx) => {
            if (typeof b.from !== 'number') errors.push(`income_tax.brackets[${idx}].from must be a number`);
            if (b.to !== null && typeof b.to !== 'number') errors.push(`income_tax.brackets[${idx}].to must be a number or null`);
            if (typeof b.rate !== 'number') errors.push(`income_tax.brackets[${idx}].rate must be a number`);
          });
        }
      }
      if (typeof it.sourceUrl !== 'string' || !it.sourceUrl) errors.push('income_tax.sourceUrl is required');
      if (typeof it.quote !== 'string' || !it.quote.trim()) errors.push('income_tax.quote is required');
      if (it.year !== undefined && typeof it.year !== 'number') errors.push('income_tax.year must be a number');
    }
  }

  if (proposal.ss !== undefined && proposal.ss !== null) {
    const ss = proposal.ss;
    if (typeof ss !== 'object') {
      errors.push('ss must be an object or null');
    } else {
      if (!['percent', 'fixed'].includes(ss.mode)) errors.push('ss.mode must be "percent" or "fixed"');
      if (ss.rate !== null && typeof ss.rate !== 'number') errors.push('ss.rate must be a number or null');
      if (typeof ss.sourceUrl !== 'string' || !ss.sourceUrl) errors.push('ss.sourceUrl is required');
      if (typeof ss.quote !== 'string' || !ss.quote.trim()) errors.push('ss.quote is required');
    }
  }

  if (!proposal.income_tax && proposal.ss === undefined) {
    errors.push('changed:true but neither income_tax nor ss provided');
  }

  return errors.length ? { ok: false, errors } : { ok: true, proposal };
}

/**
 * Parses + validates in one step. Never throws.
 * @returns {{ ok: true, proposal: object } | { ok: false, errors: string[] }}
 */
export function parseProposal(raw) {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { ok: false, errors: ['could not extract a JSON object from the response'] };
  return validateProposal(parsed);
}

/**
 * Checks whether a proposed source URL's host is within a country's allowlist
 * (plus the shared EU VAT allowlist, when includeEuVat is true).
 */
export function isAllowedSource(sourceUrl, allowlist, extraAllowlist = []) {
  let host;
  try {
    host = new URL(sourceUrl).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  const all = [...allowlist, ...extraAllowlist].map((d) => d.toLowerCase().replace(/^www\./, ''));
  return all.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export const _CONFIDENCE_VALUES = VALID_CONFIDENCE;
