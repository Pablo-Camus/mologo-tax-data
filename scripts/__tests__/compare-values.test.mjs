import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bracketsEqual, incomeTaxChanged, ssChanged } from '../lib/compare-values.mjs';

test('bracketsEqual: both null → equal', () => {
  assert.equal(bracketsEqual(null, null), true);
});

test('bracketsEqual: null vs array → not equal', () => {
  assert.equal(bracketsEqual(null, [{ from: 0, to: null, rate: 10 }]), false);
  assert.equal(bracketsEqual([{ from: 0, to: null, rate: 10 }], null), false);
});

test('bracketsEqual: identical brackets → equal', () => {
  const a = [{ from: 0, to: 100, rate: 10 }, { from: 100, to: null, rate: 20 }];
  const b = [{ from: 0, to: 100, rate: 10 }, { from: 100, to: null, rate: 20 }];
  assert.equal(bracketsEqual(a, b), true);
});

test('bracketsEqual: floating point noise within epsilon → equal', () => {
  const a = [{ from: 0, to: 47537.98, rate: 19 }];
  const b = [{ from: 0, to: 47537.980000001, rate: 19.0000000001 }];
  assert.equal(bracketsEqual(a, b), true);
});

test('bracketsEqual: different rate → not equal', () => {
  const a = [{ from: 0, to: null, rate: 10 }];
  const b = [{ from: 0, to: null, rate: 11 }];
  assert.equal(bracketsEqual(a, b), false);
});

test('bracketsEqual: different length → not equal', () => {
  const a = [{ from: 0, to: null, rate: 10 }];
  const b = [{ from: 0, to: 100, rate: 10 }, { from: 100, to: null, rate: 20 }];
  assert.equal(bracketsEqual(a, b), false);
});

test('incomeTaxChanged: identical brackets + year → false (the GB false-positive case)', () => {
  const current = {
    year: 2026,
    brackets: [
      { from: 0, to: 12570, rate: 0 },
      { from: 12570, to: 50270, rate: 20 },
      { from: 50270, to: 125140, rate: 40 },
      { from: 125140, to: null, rate: 45 },
    ],
    note: 'Personal allowance tapers to 0 for income over £100,000.',
    source: 'https://www.gov.uk/income-tax-rates',
  };
  const proposed = {
    year: 2026,
    brackets: [
      { from: 0, to: 12570, rate: 0 },
      { from: 12570, to: 50270, rate: 20 },
      { from: 50270, to: 125140, rate: 40 },
      { from: 125140, to: null, rate: 45 },
    ],
    // Different wording, different sourceUrl/quote — must NOT count as a change.
    note: 'Rewritten note text about the same allowance taper.',
    sourceUrl: 'https://www.gov.uk/income-tax-rates',
    quote: 'Band Taxable income Tax rate...',
  };
  assert.equal(incomeTaxChanged(current, proposed), false);
});

test('incomeTaxChanged: different year → true', () => {
  const current = { year: 2025, brackets: [{ from: 0, to: null, rate: 10 }] };
  const proposed = { year: 2026, brackets: [{ from: 0, to: null, rate: 10 }] };
  assert.equal(incomeTaxChanged(current, proposed), true);
});

test('incomeTaxChanged: different rate → true', () => {
  const current = { year: 2025, brackets: [{ from: 0, to: null, rate: 10 }] };
  const proposed = { year: 2025, brackets: [{ from: 0, to: null, rate: 12 }] };
  assert.equal(incomeTaxChanged(current, proposed), true);
});

test('incomeTaxChanged: proposal omits year → falls back to current year, not flagged', () => {
  const current = { year: 2025, brackets: [{ from: 0, to: null, rate: 10 }] };
  const proposed = { brackets: [{ from: 0, to: null, rate: 10 }] };
  assert.equal(incomeTaxChanged(current, proposed), false);
});

test('ssChanged: identical mode + rate, different note/source → false', () => {
  const current = { mode: 'percent', rate: 26.85, note: 'old note', source: 'https://a' };
  const proposed = { mode: 'percent', rate: 26.85, note: 'new note', sourceUrl: 'https://b', quote: 'q' };
  assert.equal(ssChanged(current, proposed), false);
});

test('ssChanged: different rate → true', () => {
  const current = { mode: 'percent', rate: 9 };
  const proposed = { mode: 'percent', rate: 6 }; // the real GB Class 4 change Pablo is fixing in PR #2
  assert.equal(ssChanged(current, proposed), true);
});

test('ssChanged: different mode → true', () => {
  const current = { mode: 'fixed', rate: null };
  const proposed = { mode: 'percent', rate: 20 };
  assert.equal(ssChanged(current, proposed), true);
});

test('ssChanged: current null (nothing stored) → any proposal counts as a change', () => {
  assert.equal(ssChanged(null, { mode: 'percent', rate: 10 }), true);
});

test('ssChanged: both rate null → false', () => {
  const current = { mode: 'fixed', rate: null };
  const proposed = { mode: 'fixed', rate: null };
  assert.equal(ssChanged(current, proposed), false);
});
