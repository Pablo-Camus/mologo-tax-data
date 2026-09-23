import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, validateProposal, parseProposal, isAllowedSource } from '../lib/parse-proposal.mjs';

test('extractJsonObject: plain JSON', () => {
  assert.deepEqual(extractJsonObject('{"changed": false}'), { changed: false });
});

test('extractJsonObject: strips ```json fence', () => {
  const raw = '```json\n{"changed": false}\n```';
  assert.deepEqual(extractJsonObject(raw), { changed: false });
});

test('extractJsonObject: strips plain ``` fence', () => {
  const raw = '```\n{"changed": false}\n```';
  assert.deepEqual(extractJsonObject(raw), { changed: false });
});

test('extractJsonObject: finds JSON amid prose', () => {
  const raw = 'Here is the result:\n{"changed": false}\nHope that helps!';
  assert.deepEqual(extractJsonObject(raw), { changed: false });
});

test('extractJsonObject: nested braces (brackets array)', () => {
  const raw = '{"changed":true,"income_tax":{"brackets":[{"from":0,"to":100,"rate":10}],"sourceUrl":"https://x","quote":"q"}}';
  const parsed = extractJsonObject(raw);
  assert.equal(parsed.income_tax.brackets[0].rate, 10);
});

test('extractJsonObject: returns null for garbage', () => {
  assert.equal(extractJsonObject('not json at all'), null);
  assert.equal(extractJsonObject(''), null);
  assert.equal(extractJsonObject(null), null);
});

test('validateProposal: changed:false is always valid', () => {
  assert.deepEqual(validateProposal({ changed: false }), { ok: true, proposal: { changed: false } });
});

test('validateProposal: rejects missing changed', () => {
  const res = validateProposal({});
  assert.equal(res.ok, false);
  assert.match(res.errors.join(), /changed/);
});

test('validateProposal: requires sourceUrl and quote on income_tax', () => {
  const res = validateProposal({ changed: true, income_tax: { brackets: null, year: 2025 } });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('sourceUrl')));
  assert.ok(res.errors.some((e) => e.includes('quote')));
});

test('validateProposal: accepts a full valid income_tax proposal', () => {
  const res = validateProposal({
    changed: true,
    income_tax: {
      year: 2025,
      brackets: [
        { from: 0, to: 10000, rate: 0 },
        { from: 10000, to: null, rate: 20 },
      ],
      sourceUrl: 'https://www.gov.uk/income-tax-rates',
      quote: 'Basic rate 20%',
    },
  });
  assert.equal(res.ok, true);
});

test('validateProposal: accepts brackets:null (unknown/no data)', () => {
  const res = validateProposal({
    changed: true,
    ss: { mode: 'percent', rate: 10, sourceUrl: 'https://x.gov', quote: 'q' },
  });
  assert.equal(res.ok, true);
});

test('validateProposal: rejects changed:true with neither field', () => {
  const res = validateProposal({ changed: true });
  assert.equal(res.ok, false);
});

test('validateProposal: rejects bad ss.mode', () => {
  const res = validateProposal({
    changed: true,
    ss: { mode: 'weird', rate: 10, sourceUrl: 'https://x.gov', quote: 'q' },
  });
  assert.equal(res.ok, false);
});

test('parseProposal: end-to-end through a fenced Claude response', () => {
  const raw = '```json\n{"changed":true,"income_tax":{"year":2026,"brackets":[{"from":0,"to":null,"rate":15}],"sourceUrl":"https://www.vero.fi","quote":"15%"}}\n```';
  const res = parseProposal(raw);
  assert.equal(res.ok, true);
  assert.equal(res.proposal.income_tax.year, 2026);
});

test('isAllowedSource: matches exact host', () => {
  assert.equal(isAllowedSource('https://www.gov.uk/income-tax-rates', ['gov.uk']), true);
});

test('isAllowedSource: matches subdomain', () => {
  assert.equal(isAllowedSource('https://sede.agenciatributaria.gob.es/foo', ['agenciatributaria.gob.es']), true);
});

test('isAllowedSource: rejects off-list domain', () => {
  assert.equal(isAllowedSource('https://evil.example.com/gov.uk', ['gov.uk']), false);
});

test('isAllowedSource: rejects a domain that merely contains the allowed one as substring', () => {
  assert.equal(isAllowedSource('https://notgov.uk.evil.com', ['gov.uk']), false);
});

test('isAllowedSource: honors extra allowlist (e.g. ec.europa.eu)', () => {
  assert.equal(isAllowedSource('https://ec.europa.eu/taxation', ['fu.gov.si'], ['ec.europa.eu']), true);
});

test('isAllowedSource: malformed URL is rejected', () => {
  assert.equal(isAllowedSource('not a url', ['gov.uk']), false);
});
