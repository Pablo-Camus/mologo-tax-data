import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFiscalData, validateTaxData } from '../lib/validate-data.mjs';

const sourcesConfig = {
  countries: {
    AT: { allowlist: ['bmf.gv.at'] },
    GB: { allowlist: ['gov.uk'] },
  },
  euVatAllowlistExtra: ['ec.europa.eu'],
};

test('validateFiscalData: valid data produces no errors', () => {
  const data = {
    AT: {
      income_tax: { name: 'x', year: 2025, confidence: 'high', brackets: [{ from: 0, to: null, rate: 20 }], source: 'https://www.bmf.gv.at' },
      ss: { mode: 'percent', rate: 20 },
    },
  };
  assert.deepEqual(validateFiscalData(data, sourcesConfig), []);
});

test('validateFiscalData: rejects non-contiguous brackets', () => {
  const data = {
    AT: {
      income_tax: {
        confidence: 'high',
        brackets: [
          { from: 0, to: 10000, rate: 10 },
          { from: 20000, to: null, rate: 20 }, // gap
        ],
        source: 'https://www.bmf.gv.at',
      },
      ss: null,
    },
  };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('contiguous')));
});

test('validateFiscalData: rejects last bracket with non-null "to"', () => {
  const data = {
    AT: {
      income_tax: { confidence: 'high', brackets: [{ from: 0, to: 100, rate: 10 }], source: 'https://www.bmf.gv.at' },
      ss: null,
    },
  };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('last entry must have "to": null')));
});

test('validateFiscalData: rejects rate out of 0-70 range', () => {
  const data = {
    AT: { income_tax: { confidence: 'high', brackets: [{ from: 0, to: null, rate: 95 }], source: 'https://www.bmf.gv.at' }, ss: null },
  };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('out of range 0–70')));
});

test('validateFiscalData: rejects bad confidence value', () => {
  const data = { AT: { income_tax: { confidence: 'medium-ish', brackets: null }, ss: null } };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('confidence must be one of')));
});

test('validateFiscalData: requires source for high/medium confidence (unless no-tax jurisdiction)', () => {
  const data = { AT: { income_tax: { confidence: 'high', brackets: [{ from: 0, to: null, rate: 20 }] }, ss: null } };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('has no "source"')));
});

test('validateFiscalData: no-tax jurisdiction (flat 0%) does not require source', () => {
  const data = { AT: { income_tax: { confidence: 'high', brackets: [{ from: 0, to: null, rate: 0 }] }, ss: null } };
  assert.deepEqual(validateFiscalData(data, sourcesConfig), []);
});

test('validateFiscalData: rejects source host not in country allowlist', () => {
  const data = { AT: { income_tax: { confidence: 'high', brackets: [{ from: 0, to: null, rate: 20 }], source: 'https://evil.com' }, ss: null } };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('not in the official allowlist')));
});

test('validateFiscalData: rejects ss.rate out of 0-60 range for percent mode', () => {
  const data = { AT: { income_tax: { confidence: 'low', brackets: null }, ss: { mode: 'percent', rate: 90 } } };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('out of range 0–60')));
});

test('validateFiscalData: flags identical brackets across countries as a copy-paste bug', () => {
  const data = {
    AT: { income_tax: { confidence: 'low', brackets: [{ from: 0, to: null, rate: 15 }] }, ss: null },
    GB: { income_tax: { confidence: 'low', brackets: [{ from: 0, to: null, rate: 15 }], source: 'https://www.gov.uk' }, ss: null },
  };
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('copy-paste bug')));
});

test('validateFiscalData: known-legit dupes (AE/QA/SA-style) are allowlisted, not flagged', () => {
  const data = {
    AT: { income_tax: { confidence: 'low', brackets: [{ from: 0, to: null, rate: 0 }] }, ss: null },
    GB: { income_tax: { confidence: 'low', brackets: [{ from: 0, to: null, rate: 0 }] }, ss: null },
  };
  // AT/GB aren't in the real allowlist pairs, so this SHOULD still be flagged —
  // proves the allowlist is code-specific, not "any zero bracket everywhere".
  const errors = validateFiscalData(data, sourcesConfig);
  assert.ok(errors.some((e) => e.includes('copy-paste bug')));
});

test('validateTaxData: required fields check (ported from old validate.yml)', () => {
  const data = { XX: { name: 'X', vn: 'VAT' } };
  const errors = validateTaxData(data);
  assert.ok(errors.some((e) => e.includes('missing field "vs"')));
  assert.ok(errors.some((e) => e.includes('missing field "vr"')));
});

test('validateTaxData: rejects vs out of range', () => {
  const data = { XX: { name: 'X', vn: 'VAT', vs: 99, vr: [], wn: 'W', wr: [], wd: 0 } };
  const errors = validateTaxData(data);
  assert.ok(errors.some((e) => e.includes('out of range 0–30')));
});

test('validateTaxData: rejects a reduced rate >= standard rate', () => {
  const data = { XX: { name: 'X', vn: 'VAT', vs: 10, vr: [{ l: 'bad', r: 15 }], wn: 'W', wr: [], wd: 0 } };
  const errors = validateTaxData(data);
  assert.ok(errors.some((e) => e.includes('is not less than standard vs')));
});

test('validateTaxData: CA "HST (combined)" is an allowlisted exception, not flagged', () => {
  const data = { CA: { name: 'Canada', vn: 'GST/HST', vs: 5, vr: [{ l: 'HST (combined)', r: 15 }], wn: 'W', wr: [], wd: 0 } };
  const errors = validateTaxData(data);
  assert.ok(!errors.some((e) => e.includes('is not less than standard vs')));
});

test('validateTaxData: the exception is label-specific — a different high vr label on CA is still flagged', () => {
  const data = { CA: { name: 'Canada', vn: 'GST/HST', vs: 5, vr: [{ l: 'Some other rate', r: 15 }], wn: 'W', wr: [], wd: 0 } };
  const errors = validateTaxData(data);
  assert.ok(errors.some((e) => e.includes('is not less than standard vs')));
});

test('validateTaxData: flags identical VAT name+rate set across countries', () => {
  const data = {
    XX: { name: 'X', vn: 'VAT', vs: 15, vr: [], wn: 'W', wr: [], wd: 0 },
    YY: { name: 'Y', vn: 'VAT', vs: 15, vr: [], wn: 'W', wr: [], wd: 0 },
  };
  const errors = validateTaxData(data);
  assert.ok(errors.some((e) => e.includes('copy-paste bug')));
});

test('validateTaxData: known-legit VAT dupe pair (SA/ZA) not flagged', () => {
  const data = {
    SA: { name: 'Saudi Arabia', vn: 'VAT', vs: 15, vr: [], wn: 'W', wr: [{ l: '15%', r: 15 }], wd: 15 },
    ZA: { name: 'South Africa', vn: 'VAT', vs: 15, vr: [], wn: 'W', wr: [{ l: '15%', r: 15 }], wd: 15 },
  };
  const errors = validateTaxData(data);
  assert.ok(!errors.some((e) => e.includes('copy-paste bug')));
});
