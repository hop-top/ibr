#!/usr/bin/env node
/**
 * Re-derive capability manifest seed signatures and print them.
 *
 * Use this after changing the signature format or the KNOWN_BROKEN_FLOWS
 * list to confirm the seeds still compute to expected values.
 *
 * Usage: node scripts/verify-seed.js
 */

import { computeSeedSignatures } from '../src/browser/capability-seed.js';

const sigs = computeSeedSignatures();
console.log(`capability-seed: ${sigs.length} known-broken flows\n`);
for (const row of sigs) {
  console.log(`- ${row.description}`);
  console.log(`  reference: ${row.reference}`);
  console.log(`  opKind:    ${row.input.opKind}`);
  console.log(`  selector:  ${JSON.stringify(row.input.selector)}`);
  console.log(`  step:      ${row.input.stepTemplate}`);
  console.log(`  signature: ${row.signature}`);
  console.log();
}
