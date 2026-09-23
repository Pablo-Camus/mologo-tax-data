import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/report.mjs';

test('buildReport: empty run says so', () => {
  const report = buildReport({ date: '2026-09-23' });
  assert.match(report, /No changes and no discrepancies/);
});

test('buildReport: lists applied changes with source + quote', () => {
  const report = buildReport({
    date: '2026-09-23',
    applied: [{ code: 'AT', field: 'income_tax', before: { rate: 'old' }, after: { rate: 'new' }, sourceUrl: 'https://bmf.gv.at', quote: 'quoted text' }],
  });
  assert.match(report, /Changes applied \(1\)/);
  assert.match(report, /AT — income_tax/);
  assert.match(report, /quoted text/);
});

test('buildReport: lists discrepancies separately from applied', () => {
  const report = buildReport({
    date: '2026-09-23',
    discrepancies: [{ code: 'GB', field: 'income_tax', current: { a: 1 }, proposed: { a: 2 }, sourceUrl: 'https://gov.uk', quote: 'q' }],
  });
  assert.match(report, /Discrepancies to review — confidence:high/);
  assert.match(report, /GB — income_tax/);
});

test('buildReport: includes fetch/parse failures and rejected sources', () => {
  const report = buildReport({
    date: '2026-09-23',
    fetchFailures: [{ code: 'FR', reason: 'timeout' }],
    parseFailures: [{ code: 'IT', reason: 'bad json' }],
    rejectedSources: [{ code: 'ES', reason: 'off-allowlist domain' }],
    skippedManual: ['MT', 'AU'],
  });
  assert.match(report, /Fetch failures/);
  assert.match(report, /Parse\/schema failures/);
  assert.match(report, /Rejected — source not in official allowlist/);
  assert.match(report, /MT, AU/);
});
