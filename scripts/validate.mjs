#!/usr/bin/env node
// validate.mjs — CLI wrapper around scripts/lib/validate-data.mjs.
// Run standalone: `node scripts/validate.mjs [fiscal-data.json] [tax-data.json] [sources.json]`
// Exits 1 and prints every error if either data file fails validation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFiscalData, validateTaxData } from './lib/validate-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function runValidation({ fiscalPath, taxPath, sourcesPath } = {}) {
  const fiscal = loadJson(fiscalPath ?? path.join(repoRoot, 'fiscal-data.json'));
  const tax = loadJson(taxPath ?? path.join(repoRoot, 'tax-data.json'));
  const sources = loadJson(sourcesPath ?? path.join(repoRoot, 'sources.json'));

  const fiscalErrors = validateFiscalData(fiscal, sources).map((e) => `[fiscal-data.json] ${e}`);
  const taxErrors = validateTaxData(tax).map((e) => `[tax-data.json] ${e}`);

  return [...fiscalErrors, ...taxErrors];
}

// Only run as a CLI when invoked directly (not when imported by fiscal-monitor.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = runValidation();
  if (errors.length > 0) {
    console.log(`❌ ${errors.length} validation error(s):\n`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
  console.log('✅ fiscal-data.json and tax-data.json pass all checks.');
}
