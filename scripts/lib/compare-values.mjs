// compare-values.mjs — pure value-equality checks used to decide whether a
// Claude proposal actually differs from what's stored, INDEPENDENT of
// whatever Claude itself claimed via "changed". Claude's "changed" flag is
// unreliable (it said true for GB even when brackets/year/note were byte-
// identical to the stored data — it was reacting to being asked to fill in
// sourceUrl/quote, not to an actual value difference). This module is the
// real gate: note/wording/sourceUrl/quote are NEVER compared, only the
// numeric/structural fields that matter to the app.

const EPS = 1e-9;

function numEq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) < EPS;
}

/**
 * @param {Array<{from:number,to:number|null,rate:number}>|null} a
 * @param {Array<{from:number,to:number|null,rate:number}>|null} b
 */
export function bracketsEqual(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => numEq(x.from, b[i].from) && numEq(x.to, b[i].to) && numEq(x.rate, b[i].rate));
}

/**
 * Decides whether a proposed income_tax value actually differs from the
 * stored one. Only `year` and `brackets` (numerically) are compared — note,
 * source, quote are ignored on purpose.
 * @param {{year?:number, brackets:Array|null}} current
 * @param {{year?:number, brackets:Array|null}} proposed
 */
export function incomeTaxChanged(current, proposed) {
  const propYear = proposed.year ?? current?.year;
  if ((current?.year ?? null) !== (propYear ?? null)) return true;
  return !bracketsEqual(current?.brackets ?? null, proposed.brackets ?? null);
}

/**
 * Decides whether a proposed ss value actually differs from the stored one.
 * Only `mode` and `rate` are compared — note/source are ignored.
 * @param {{mode?:string, rate:number|null}|null} current
 * @param {{mode:string, rate:number|null}} proposed
 */
export function ssChanged(current, proposed) {
  if (!current) return true; // there was nothing stored — any proposal is a change
  if ((current.mode ?? null) !== (proposed.mode ?? null)) return true;
  return !numEq(current.rate ?? null, proposed.rate ?? null);
}
