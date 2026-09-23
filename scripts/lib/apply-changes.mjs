// apply-changes.mjs — pure, formatting-preserving text edits to fiscal-data.json.
//
// fiscal-data.json is hand-formatted (see AGENTS.md in the app repo: "Both
// files are HAND-FORMATTED — any automated edit must preserve formatting and
// only change the touched lines"). We never JSON.stringify the whole file;
// instead we locate the exact `"income_tax": { ... }` / `"ss": { ... }` span
// for one country by brace-matching on the raw text and splice in a
// re-formatted replacement for just that span, byte for byte identical
// elsewhere.

/**
 * Finds the `{...}` span of `"fieldName": { ... }` inside `text`, searching
 * only for a match at the start of a line (ignoring leading whitespace) so
 * we don't accidentally match a nested field with the same name.
 * @returns {{ indent: string, braceStart: number, braceEnd: number } | null}
 *   braceEnd is the index of the matching closing `}` (inclusive span end
 *   is braceEnd, i.e. text.slice(braceStart, braceEnd + 1) is the object).
 */
export function findFieldObjectSpan(text, fieldName) {
  const re = new RegExp(`^([ \\t]*)"${fieldName}"\\s*:\\s*`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const indent = m[1];
  const afterKey = m.index + m[0].length;
  if (text[afterKey] !== '{') return null; // e.g. "ss": null
  let depth = 0;
  for (let i = afterKey; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { indent, braceStart: afterKey, braceEnd: i };
    }
  }
  return null;
}

/**
 * Finds the `{...}` span of a top-level `"CODE": { ... }` country block.
 */
export function findCountryBlockSpan(text, code) {
  return findFieldObjectSpan(text, code);
}

function jsonScalar(v) {
  return JSON.stringify(v);
}

/**
 * Renders a replacement `"income_tax": { ... }` block (no trailing comma —
 * the caller's surrounding text already has it) matching the existing file's
 * style: 6-space-indented fields under a 4-space `"income_tax": {`.
 * @param {object} it - { name, year, confidence, brackets, note, source, checked }
 * @param {string} baseIndent - indent of the `"income_tax"` line itself (e.g. '    ')
 */
export function formatIncomeTaxBlock(it, baseIndent = '    ') {
  const fieldIndent = baseIndent + '  ';
  const bracketIndent = fieldIndent + '  ';
  const lines = [];
  if (it.name !== undefined) lines.push(`${fieldIndent}"name": ${jsonScalar(it.name)}`);
  lines.push(`${fieldIndent}"year": ${jsonScalar(it.year)}`);
  lines.push(`${fieldIndent}"confidence": ${jsonScalar(it.confidence)}`);
  if (it.brackets === null) {
    lines.push(`${fieldIndent}"brackets": null`);
  } else {
    const bracketLines = it.brackets
      .map((b) => `${bracketIndent}{ "from": ${jsonScalar(b.from)}, "to": ${jsonScalar(b.to)}, "rate": ${jsonScalar(b.rate)} }`)
      .join(',\n');
    lines.push(`${fieldIndent}"brackets": [\n${bracketLines}\n${fieldIndent}]`);
  }
  if (it.note) lines.push(`${fieldIndent}"note": ${jsonScalar(it.note)}`);
  if (it.source) lines.push(`${fieldIndent}"source": ${jsonScalar(it.source)}`);
  if (it.checked) lines.push(`${fieldIndent}"checked": ${jsonScalar(it.checked)}`);

  return `${baseIndent}"income_tax": {\n${lines.join(',\n')}\n${baseIndent}}`;
}

/**
 * Renders a replacement `"ss": { ... }` single-line block matching the
 * existing file's style.
 * @param {object} ss - { name, mode, rate, note, source }
 */
export function formatSsBlock(ss, baseIndent = '    ') {
  if (ss === null) return `${baseIndent}"ss": null`;
  const parts = [];
  if (ss.name !== undefined) parts.push(`"name": ${jsonScalar(ss.name)}`);
  parts.push(`"mode": ${jsonScalar(ss.mode)}`);
  parts.push(`"rate": ${jsonScalar(ss.rate)}`);
  if (ss.note) parts.push(`"note": ${jsonScalar(ss.note)}`);
  if (ss.source) parts.push(`"source": ${jsonScalar(ss.source)}`);
  return `${baseIndent}"ss": { ${parts.join(', ')} }`;
}

/**
 * Applies an income_tax update for one country to the raw fiscal-data.json
 * text, returning the new full text. Throws if the country or the
 * income_tax field can't be located (caller should treat that as a hard
 * failure, not silently skip).
 * @param {string} fullText - full fiscal-data.json source
 * @param {string} code - country code, e.g. 'AT'
 * @param {object} newIncomeTax - full replacement object (name/year/confidence/brackets/note/source/checked)
 */
export function applyIncomeTaxUpdate(fullText, code, newIncomeTax) {
  const country = findCountryBlockSpan(fullText, code);
  if (!country) throw new Error(`applyIncomeTaxUpdate: country block "${code}" not found`);
  const countryText = fullText.slice(country.braceStart, country.braceEnd + 1);

  const field = findFieldObjectSpan(countryText, 'income_tax');
  if (!field) throw new Error(`applyIncomeTaxUpdate: income_tax field not found for "${code}"`);

  const replacement = formatIncomeTaxBlock(newIncomeTax, field.indent);

  // Splice: replace from the start of the indent+key up to the closing brace.
  const keyLineStart = countryText.lastIndexOf(`${field.indent}"income_tax"`, field.braceStart);
  const spliced = countryText.slice(0, keyLineStart) + replacement + countryText.slice(field.braceEnd + 1);

  return fullText.slice(0, country.braceStart) + spliced + fullText.slice(country.braceEnd + 1);
}

/**
 * Applies an ss update for one country to the raw fiscal-data.json text.
 */
export function applySsUpdate(fullText, code, newSs) {
  const country = findCountryBlockSpan(fullText, code);
  if (!country) throw new Error(`applySsUpdate: country block "${code}" not found`);
  const countryText = fullText.slice(country.braceStart, country.braceEnd + 1);

  // "ss" can be `null` (no braces) or an object — locate the key generically.
  const keyRe = /^([ \t]*)"ss"\s*:\s*/m;
  const m = keyRe.exec(countryText);
  if (!m) throw new Error(`applySsUpdate: ss field not found for "${code}"`);
  const indent = m[1];
  const valueStart = m.index + m[0].length;

  let valueEnd;
  if (countryText[valueStart] === '{') {
    let depth = 0;
    for (let i = valueStart; i < countryText.length; i++) {
      if (countryText[i] === '{') depth++;
      else if (countryText[i] === '}') { depth--; if (depth === 0) { valueEnd = i; break; } }
    }
  } else {
    // `null`
    valueEnd = countryText.indexOf('null', valueStart) + 'null'.length - 1;
  }
  if (valueEnd === undefined) throw new Error(`applySsUpdate: could not find end of ss value for "${code}"`);

  const replacement = formatSsBlock(newSs, indent);
  const keyLineStart = m.index;
  const spliced = countryText.slice(0, keyLineStart) + replacement + countryText.slice(valueEnd + 1);

  return fullText.slice(0, country.braceStart) + spliced + fullText.slice(country.braceEnd + 1);
}

/**
 * Updates `_meta.updated` to today's date (YYYY-MM-DD), preserving formatting.
 */
export function applyMetaUpdatedDate(fullText, dateStr) {
  return fullText.replace(/("updated"\s*:\s*)"[^"]*"/, `$1"${dateStr}"`);
}
