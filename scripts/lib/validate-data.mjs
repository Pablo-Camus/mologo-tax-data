// validate-data.mjs — pure validation rules for fiscal-data.json and
// tax-data.json. No network, no filesystem — takes parsed JSON + sources.json
// config in, returns a list of human-readable error strings out (empty = ok).

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isAllowedHost(url, allowlist) {
  const host = hostOf(url);
  if (!host) return false;
  return allowlist.some((d) => {
    const domain = d.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/**
 * Known-legitimate duplicate pairs/groups (coincidental identical values,
 * not the France→Belgium copy-paste bug). Documented here rather than
 * weakening the duplicate-detection rule. Re-verify with a fresh grep before
 * adding to this list — see AGENTS.md §13 stop condition (1).
 */
export const KNOWN_LEGIT_BRACKET_DUPES = [
  ['BG', 'RO'], // both flat 10% income tax — coincidence, verified 2026-09-23
  ['AE', 'QA', 'SA'], // no personal income tax — same {from:0,to:null,rate:0} bracket by construction
];

export const KNOWN_LEGIT_VAT_DUPES = [
  ['SA', 'ZA'], // both 15% standard VAT, no reduced rates, generic name "VAT" — coincidence, verified 2026-09-23
];

/**
 * Explicit, documented exceptions to the "vr rate < vs" rule: entries under
 * `vr` (`{l, r}`) that are legitimate ALTERNATE rates a user can select in
 * the app, not a "reduced" rate that must be lower than the standard one.
 * Each entry is `{ code, label }`, matched against `entry.vr[i].l` exactly.
 * Verify with a fresh read of the app's rate picker before adding here —
 * see AGENTS.md §13 stop condition (1).
 */
export const KNOWN_VAT_ALTERNATE_RATE_EXCEPTIONS = [
  // CA: GST (5%, federal, stored as vs) vs HST (13-15%, combined federal+provincial
  // in HST-participating provinces). HST isn't a "reduced" rate under GST — it's an
  // alternate rate a Canadian user picks depending on their province. Selectable in
  // the app's vr dropdown like any other vr option. Verified 2026-09-23.
  { code: 'CA', label: 'HST (combined)' },
];

function isKnownVatAlternateRate(code, label) {
  return KNOWN_VAT_ALTERNATE_RATE_EXCEPTIONS.some((e) => e.code === code && e.label === label);
}

function setsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isKnownDupe(codes, knownGroups) {
  const sorted = [...codes].sort();
  return knownGroups.some((group) => {
    const g = [...group].sort();
    return g.length === sorted.length && g.every((c, i) => c === sorted[i]);
  });
}

/**
 * Validates fiscal-data.json (income tax brackets + social security).
 * @param {object} data - parsed fiscal-data.json
 * @param {object} sourcesConfig - parsed sources.json (for allowlist checks)
 * @returns {string[]} errors, empty if valid
 */
export function validateFiscalData(data, sourcesConfig) {
  const errors = [];
  const countries = sourcesConfig?.countries || {};
  const euExtra = sourcesConfig?.euVatAllowlistExtra || [];

  const bracketFingerprints = {}; // fingerprint -> [codes]

  for (const [code, entry] of Object.entries(data)) {
    if (code === '_meta') continue;
    const it = entry.income_tax;
    if (!it) { errors.push(`${code}: missing income_tax`); continue; }

    if (!_CONFIDENCE.has(it.confidence)) {
      errors.push(`${code}: income_tax.confidence must be one of ${[..._CONFIDENCE].join('/')}, got "${it.confidence}"`);
    }

    if (it.brackets !== null) {
      if (!Array.isArray(it.brackets) || it.brackets.length === 0) {
        errors.push(`${code}: income_tax.brackets must be a non-empty array or null`);
      } else {
        let prevTo = 0;
        it.brackets.forEach((b, idx) => {
          if (b.from !== prevTo) {
            errors.push(`${code}: income_tax.brackets[${idx}].from (${b.from}) is not contiguous with previous bracket's "to" (${prevTo})`);
          }
          if (typeof b.rate !== 'number' || b.rate < 0 || b.rate > 70) {
            errors.push(`${code}: income_tax.brackets[${idx}].rate (${b.rate}) out of range 0–70`);
          }
          if (idx === it.brackets.length - 1) {
            if (b.to !== null) errors.push(`${code}: income_tax.brackets last entry must have "to": null`);
          } else if (typeof b.to !== 'number') {
            errors.push(`${code}: income_tax.brackets[${idx}].to must be a number (only the last bracket may be null)`);
          }
          prevTo = b.to;
        });

        const fp = JSON.stringify(it.brackets);
        (bracketFingerprints[fp] = bracketFingerprints[fp] || []).push(code);
      }
    }

    const isNoTaxJurisdiction =
      Array.isArray(it.brackets) && it.brackets.length === 1 && it.brackets[0].from === 0 && it.brackets[0].to === null && it.brackets[0].rate === 0;

    if ((it.confidence === 'high' || it.confidence === 'medium') && !isNoTaxJurisdiction) {
      if (!it.source) {
        errors.push(`${code}: income_tax.confidence is "${it.confidence}" but has no "source"`);
      } else {
        const allow = countries[code]?.allowlist || [];
        if (allow.length > 0 && !isAllowedHost(it.source, allow)) {
          errors.push(`${code}: income_tax.source "${it.source}" is not in the official allowlist for ${code}`);
        }
      }
    }

    const ss = entry.ss;
    if (ss !== null && ss !== undefined) {
      if (ss.mode === 'percent') {
        if (typeof ss.rate !== 'number' || ss.rate < 0 || ss.rate > 60) {
          errors.push(`${code}: ss.rate (${ss.rate}) out of range 0–60 for mode "percent"`);
        }
      } else if (ss.mode !== 'fixed') {
        errors.push(`${code}: ss.mode must be "percent" or "fixed", got "${ss.mode}"`);
      }
    }
  }

  for (const [fp, codes] of Object.entries(bracketFingerprints)) {
    if (codes.length > 1 && !isKnownDupe(codes, KNOWN_LEGIT_BRACKET_DUPES)) {
      errors.push(`Identical income_tax.brackets across ${codes.join(', ')} — looks like a copy-paste bug (fingerprint: ${fp.slice(0, 60)}...). Add to KNOWN_LEGIT_BRACKET_DUPES in scripts/lib/validate-data.mjs if this is legitimate.`);
    }
  }

  return errors;
}

const _CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * Validates tax-data.json (VAT / withholding / calendar). Keeps the existing
 * required-fields check (ported from the old validate.yml Python step) and
 * adds: vs range, vr rates < vs, duplicate VAT-rate-set detection.
 * @param {object} data - parsed tax-data.json
 * @returns {string[]} errors, empty if valid
 */
export function validateTaxData(data) {
  const errors = [];
  const required = ['name', 'vn', 'vs', 'vr', 'wn', 'wr', 'wd'];
  const vatFingerprints = {};

  for (const [code, entry] of Object.entries(data)) {
    for (const field of required) {
      if (!(field in entry)) errors.push(`${code}: missing field "${field}"`);
    }
    if (typeof entry.vs === 'number' && (entry.vs < 0 || entry.vs > 30)) {
      errors.push(`${code}: vs (${entry.vs}) out of range 0–30`);
    }
    if (Array.isArray(entry.vr)) {
      for (const r of entry.vr) {
        if (typeof r.r === 'number' && typeof entry.vs === 'number' && r.r >= entry.vs && !isKnownVatAlternateRate(code, r.l)) {
          errors.push(`${code}: reduced VAT rate "${r.l}" (${r.r}) is not less than standard vs (${entry.vs}) — add to KNOWN_VAT_ALTERNATE_RATE_EXCEPTIONS in scripts/lib/validate-data.mjs if this is a legitimate alternate rate rather than a reduced one`);
        }
      }
      const fp = JSON.stringify({ vn: entry.vn, vs: entry.vs, vr: [...entry.vr].map((r) => r.r).sort() });
      (vatFingerprints[fp] = vatFingerprints[fp] || []).push(code);
    }
  }

  for (const [fp, codes] of Object.entries(vatFingerprints)) {
    if (codes.length > 1 && !isKnownDupe(codes, KNOWN_LEGIT_VAT_DUPES)) {
      errors.push(`Identical VAT name+rate set across ${codes.join(', ')} — looks like a copy-paste bug (fingerprint: ${fp}). Add to KNOWN_LEGIT_VAT_DUPES in scripts/lib/validate-data.mjs if this is legitimate.`);
    }
  }

  return errors;
}

export { setsEqual };
