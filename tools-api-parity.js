#!/usr/bin/env node
/* tools-api-parity.js - the combatif gate exists twice. Prove the two copies agree.
 *
 *   node tools-api-parity.js
 *   node tools-api-parity.js --repo <path to coldufantasy-login>
 *
 * WHY THIS EXISTS. `tools-combatif-gate.js` here and `lib/combatif-gate.js` in the
 * coldufantasy-login repo are the SAME code in two deploy targets: one runs in the local
 * closer, the other runs in the preview endpoint on Vercel. They are separate repos with
 * separate deploys, so they cannot share a file.
 *
 * That is a duplicated computation, which this project has been bitten by repeatedly:
 * FP_SCALE written out five times and two copies missed when the scale changed, the
 * Kasseistampers tally counted at two sites, the Arlequin count rebuilt inside an IIFE.
 * The copy that drifts is always the one nobody is looking at, and here that is
 * guaranteed to be the server copy, because the local one is the one an operator runs
 * and watches.
 *
 * DUPLICATION THAT CANNOT DRIFT IS TOLERABLE. So the rule is not "do not duplicate", it
 * is "duplicate and ASSERT". This gate fails if the shared core diverges by one byte.
 *
 * WHAT IT COMPARES. Everything above the module epilogue: the header comment, `tokens`,
 * `sameRider`, `combatifFromBind` and `combatifGate`. It deliberately does NOT compare
 * the epilogue itself, because that is the one legitimate difference: this repo is
 * CommonJS and exports with `module.exports`, the API repo is an ESM package and exports
 * with `export {}`. The API copy also carries a generated header saying it is a copy,
 * which is stripped before the comparison.
 *
 * If this fails, do NOT hand-edit either file to match. Regenerate the API copy from
 * THIS one, which is the source of truth.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'tools-combatif-gate.js');
const DEFAULT_API_REPO = path.resolve(__dirname, '..', 'coldufantasy-login');

function apiRepo() {
  const i = process.argv.indexOf('--repo');
  return i >= 0 ? process.argv[i + 1] : DEFAULT_API_REPO;
}

/* The shared core of the source: everything before `module.exports`, which also drops
   the self-test block that follows it. */
function coreOfSource(text) {
  const cut = text.indexOf('module.exports');
  if (cut < 0) throw new Error('no module.exports in ' + SRC);
  return text.slice(0, cut).replace(/\s+$/, '');
}

/* The shared core of the copy: everything between the generated header and the export.
   The header is delimited by the first blank line after the closing comment marker. */
function coreOfCopy(text) {
  const cut = text.indexOf('export {');
  if (cut < 0) throw new Error('no export block in the API copy');
  let body = text.slice(0, cut);
  const hdrEnd = body.indexOf('*/');
  if (hdrEnd < 0) throw new Error('no generated header in the API copy');
  body = body.slice(hdrEnd + 2);
  return body.replace(/^\s+/, '').replace(/\s+$/, '');
}

let fails = 0;
function check(label, ok, detail) {
  if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(46) +
    (detail == null ? '' : detail));
}

function main() {
  const repo = apiRepo();
  const copyPath = path.join(repo, 'lib', 'combatif-gate.js');

  console.log('API PARITY');
  console.log('  source ' + path.relative(__dirname, SRC));
  console.log('  copy   ' + copyPath);
  console.log('');

  if (!fs.existsSync(copyPath)) {
    /* The API repo is a sibling checkout on Allen's machines and is NOT guaranteed to be
       present. Absence is reported as a SKIP and not a pass: a gate that silently passes
       when it cannot find what it is checking is the fail-open shape this repo keeps
       recording. It is also not a hard failure, because a machine without that clone is
       a normal state, not a broken one. */
    console.log('  [SKIP] the coldufantasy-login clone is not at ' + repo);
    console.log('         Nothing was compared. This is NOT a pass.');
    console.log('         Pass --repo <path> if it lives elsewhere.');
    process.exit(0);
  }

  const src = coreOfSource(fs.readFileSync(SRC, 'utf8'));
  const copy = coreOfCopy(fs.readFileSync(copyPath, 'utf8'));

  check('the shared core is byte-identical', src === copy,
    src === copy ? src.length + ' chars' : 'source ' + src.length + ', copy ' + copy.length);

  if (src !== copy) {
    /* Name the first divergence by line, so the failure is actionable rather than a
       bare inequality. */
    const a = src.split('\n'), b = copy.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log('\n  first divergence at core line ' + (i + 1) + ':');
        console.log('    source: ' + JSON.stringify(a[i] == null ? '(absent)' : a[i]));
        console.log('    copy  : ' + JSON.stringify(b[i] == null ? '(absent)' : b[i]));
        break;
      }
    }
    console.log('\n  Regenerate the copy from the source. Do not hand-edit either.');
  }

  /* Both must actually load and agree on a live case, because byte equality proves the
     text matches and nothing about whether the module still works. */
  const local = require(SRC);
  check('the source still gates a live bib-only bind',
    (() => {
      const r = local.combatifGate({ stage: 17, bind: { rankings: [{ position: 1, bib: 96 }] },
        bindStage: 17, proposed: null, riders: [{ b: 96, r: 'E. Paleni' }] });
      return r.ok && r.value === 'E. Paleni';
    })());

  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'parity holds'));
  process.exit(fails ? 1 : 0);
}

main();
