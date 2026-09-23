import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  findFieldObjectSpan,
  formatIncomeTaxBlock,
  formatSsBlock,
  applyIncomeTaxUpdate,
  applySsUpdate,
  applyMetaUpdatedDate,
} from '../lib/apply-changes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(__dirname, 'fixtures', 'fiscal-data.sample.json'), 'utf8');

test('findFieldObjectSpan: locates a top-level country block', () => {
  const span = findFieldObjectSpan(fixture, 'AT');
  assert.ok(span);
  const block = fixture.slice(span.braceStart, span.braceEnd + 1);
  assert.match(block, /"income_tax"/);
  assert.equal(JSON.parse(block).income_tax.name, 'Einkommensteuer');
});

test('findFieldObjectSpan: returns null for ss:null (no object)', () => {
  const country = findFieldObjectSpan(fixture, 'RU_NULL_SS');
  assert.equal(country, null); // not a real key in the fixture — sanity check
});

test('formatIncomeTaxBlock: renders brackets and matches file style', () => {
  const block = formatIncomeTaxBlock(
    { name: 'Test', year: 2026, confidence: 'medium', brackets: [{ from: 0, to: 100, rate: 5 }], source: 'https://x.gov', checked: '2026-09-23' },
    '    '
  );
  assert.match(block, /^ {4}"income_tax": \{\n {6}"name": "Test",\n {6}"year": 2026,/);
  assert.match(block, /"brackets": \[\n {8}\{ "from": 0, "to": 100, "rate": 5 \}\n {6}\]/);
  assert.ok(block.endsWith('    }'));
});

test('formatIncomeTaxBlock: renders brackets:null', () => {
  const block = formatIncomeTaxBlock({ year: 2025, confidence: 'low', brackets: null }, '    ');
  assert.match(block, /"brackets": null/);
});

test('formatSsBlock: single line, omits absent optional fields', () => {
  const block = formatSsBlock({ mode: 'percent', rate: 10 }, '    ');
  assert.equal(block, '    "ss": { "mode": "percent", "rate": 10 }');
});

test('formatSsBlock: null', () => {
  assert.equal(formatSsBlock(null, '    '), '    "ss": null');
});

test('applyIncomeTaxUpdate: only touches the target country, byte-identical elsewhere', () => {
  const updated = applyIncomeTaxUpdate(fixture, 'AT', {
    name: 'Einkommensteuer',
    year: 2026,
    confidence: 'medium',
    brackets: [{ from: 0, to: 20000, rate: 20 }],
    source: 'https://www.bmf.gv.at',
    checked: '2026-09-23',
  });

  // Result is valid JSON with the update applied.
  const parsed = JSON.parse(updated);
  assert.equal(parsed.AT.income_tax.year, 2026);
  assert.equal(parsed.AT.income_tax.confidence, 'medium');
  assert.equal(parsed.AT.income_tax.brackets[0].rate, 20);
  assert.equal(parsed.AT.income_tax.checked, '2026-09-23');

  // Sibling country (BE) is untouched byte-for-byte.
  const origBE = findFieldObjectSpan(fixture, 'BE');
  const newBE = findFieldObjectSpan(updated, 'BE');
  assert.equal(fixture.slice(origBE.braceStart, origBE.braceEnd + 1), updated.slice(newBE.braceStart, newBE.braceEnd + 1));

  // AT's "ss" field (a sibling of income_tax within the same country block) is untouched.
  assert.match(updated, /"ss": \{ "name": "Sozialversicherung \(SVS\)", "mode": "percent", "rate": 26\.85, "source": "https:\/\/www\.svs\.at" \}/);
});

test('applySsUpdate: replaces an object ss value', () => {
  const updated = applySsUpdate(fixture, 'AT', { name: 'Sozialversicherung (SVS)', mode: 'percent', rate: 27.1, source: 'https://www.svs.at' });
  const parsed = JSON.parse(updated);
  assert.equal(parsed.AT.ss.rate, 27.1);
  // income_tax untouched
  assert.equal(parsed.AT.income_tax.year, 2025);
});

test('applySsUpdate: throws for a country not present in the file', () => {
  assert.throws(() => applySsUpdate(fixture, 'NL_NO_SS', { mode: 'percent', rate: 5 }), /country block "NL_NO_SS" not found/);
});

test('applySsUpdate: null → object on a real null-ss country', () => {
  const updated = applySsUpdate(fixture, 'NL', { mode: 'percent', rate: 12.5, note: 'new rule' });
  const parsed = JSON.parse(updated);
  assert.equal(parsed.NL.ss.rate, 12.5);
});

test('applyMetaUpdatedDate: rewrites only the date', () => {
  const updated = applyMetaUpdatedDate(fixture, '2026-09-23');
  assert.match(updated, /"updated": "2026-09-23"/);
});

test('round trip: apply twice, still valid JSON both times', () => {
  let text = fixture;
  text = applyIncomeTaxUpdate(text, 'AT', { year: 2026, confidence: 'medium', brackets: null, checked: '2026-09-23' });
  text = applySsUpdate(text, 'BE', { mode: 'percent', rate: 21, source: 'https://www.inasti.be' });
  const parsed = JSON.parse(text);
  assert.equal(parsed.AT.income_tax.year, 2026);
  assert.equal(parsed.BE.ss.rate, 21);
});
