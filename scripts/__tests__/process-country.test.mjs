import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processCountry, mergeIncomeTaxUpdate, mergeSsUpdate } from '../lib/process-country.mjs';

const config = { urls: ['https://www.bmf.gv.at'], allowlist: ['bmf.gv.at'] };
const currentEntry = {
  income_tax: { name: 'Einkommensteuer', year: 2025, confidence: 'low', brackets: null, source: 'https://www.bmf.gv.at' },
  ss: { name: 'SVS', mode: 'percent', rate: 26.85, source: 'https://www.svs.at' },
};

function fakeFetch(text = 'some page text') {
  return async () => ({ text, failures: [] });
}

test('processCountry: no page text fetched → early return, no calls to Claude', async () => {
  let claudeCalled = false;
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry,
    fetchPages: async () => ({ text: '', failures: [{ url: 'https://x', reason: 'HTTP 403' }] }),
    askClaude: async () => { claudeCalled = true; return { ok: true, raw: '{"changed":false}' }; },
  });
  assert.equal(claudeCalled, false);
  assert.equal(result.fetchFailures.length, 1);
});

test('processCountry: Claude says changed:false → no applied/discrepancy', async () => {
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry,
    fetchPages: fakeFetch(),
    askClaude: async () => ({ ok: true, raw: '{"changed": false}' }),
  });
  assert.equal(result.appliedFields.length, 0);
  assert.equal(result.discrepancyFields.length, 0);
});

test('processCountry: low-confidence country with a valid proposal → applied', async () => {
  const raw = JSON.stringify({
    changed: true,
    income_tax: { year: 2026, brackets: [{ from: 0, to: null, rate: 25 }], sourceUrl: 'https://www.bmf.gv.at', quote: '25%' },
  });
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry,
    fetchPages: fakeFetch(),
    askClaude: async () => ({ ok: true, raw }),
  });
  assert.equal(result.appliedFields.length, 1);
  assert.equal(result.appliedFields[0].field, 'income_tax');
  assert.equal(result.discrepancyFields.length, 0);
});

test('processCountry: high-confidence country → discrepancy, not applied', async () => {
  const highEntry = { ...currentEntry, income_tax: { ...currentEntry.income_tax, confidence: 'high' } };
  const raw = JSON.stringify({
    changed: true,
    income_tax: { year: 2026, brackets: [{ from: 0, to: null, rate: 30 }], sourceUrl: 'https://www.bmf.gv.at', quote: '30%' },
  });
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry: highEntry,
    fetchPages: fakeFetch(),
    askClaude: async () => ({ ok: true, raw }),
  });
  assert.equal(result.appliedFields.length, 0);
  assert.equal(result.discrepancyFields.length, 1);
});

test('processCountry: proposal from an off-allowlist source is rejected, not applied', async () => {
  const raw = JSON.stringify({
    changed: true,
    income_tax: { year: 2026, brackets: [{ from: 0, to: null, rate: 25 }], sourceUrl: 'https://totally-unofficial-blog.com', quote: '25%' },
  });
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry,
    fetchPages: fakeFetch(),
    askClaude: async () => ({ ok: true, raw }),
  });
  assert.equal(result.appliedFields.length, 0);
  assert.equal(result.rejectedSources.length, 1);
});

test('processCountry: malformed Claude JSON → parseFailures, not thrown', async () => {
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry,
    fetchPages: fakeFetch(),
    askClaude: async () => ({ ok: true, raw: 'not json' }),
  });
  assert.equal(result.parseFailures.length, 1);
});

test('processCountry: Claude API failure surfaces as parseFailure, not thrown', async () => {
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry,
    fetchPages: fakeFetch(),
    askClaude: async () => ({ ok: false, reason: 'HTTP 529' }),
  });
  assert.equal(result.parseFailures.length, 1);
  assert.match(result.parseFailures[0].reason, /529/);
});

test('processCountry: Claude says changed:true but values are identical (GB false positive) → neither applied nor discrepancy', async () => {
  const highEntry = { ...currentEntry, income_tax: { ...currentEntry.income_tax, confidence: 'high', year: 2026, brackets: [{ from: 0, to: null, rate: 45 }] } };
  const raw = JSON.stringify({
    changed: true,
    income_tax: {
      year: 2026,
      brackets: [{ from: 0, to: null, rate: 45 }], // identical to stored
      note: 'differently worded note',
      sourceUrl: 'https://www.bmf.gv.at',
      quote: 'some quote',
    },
  });
  const result = await processCountry({
    code: 'AT',
    config,
    currentEntry: highEntry,
    fetchPages: fakeFetch(),
    askClaude: async () => ({ ok: true, raw }),
  });
  assert.equal(result.appliedFields.length, 0);
  assert.equal(result.discrepancyFields.length, 0);
});

test('mergeIncomeTaxUpdate: always downgrades confidence to medium, never high', () => {
  const merged = mergeIncomeTaxUpdate(
    { name: 'X', confidence: 'low' },
    { year: 2026, brackets: [{ from: 0, to: null, rate: 10 }], sourceUrl: 'https://x.gov', quote: 'q' },
    '2026-09-23'
  );
  assert.equal(merged.confidence, 'medium');
  assert.equal(merged.source, 'https://x.gov');
  assert.equal(merged.checked, '2026-09-23');
});

test('mergeSsUpdate: carries through name from current if proposal omits it', () => {
  const merged = mergeSsUpdate({ name: 'SVS' }, { mode: 'percent', rate: 27, sourceUrl: 'https://x.gov', quote: 'q' });
  assert.equal(merged.name, 'SVS');
  assert.equal(merged.rate, 27);
});
