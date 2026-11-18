#!/usr/bin/env node
/* tools-guest-pass-parity.js - the guest pass core exists twice. Prove they agree.
 *
 *   node tools-guest-pass-parity.js
 *   node tools-guest-pass-parity.js --repo <path to coldufantasy-login>
 *
 * WHY THIS EXISTS. `tools-guest-pass-core.js` here and `lib/guest-pass.js` in the
 * coldufantasy-login repo are the SAME code in two deploy targets. The board repo copy
 * is what the owner tools require when they mint and revoke a pass; the API copy is what
 * /auth/guest and /api/guest-ping import on Vercel. Separate repos, separate deploys, so
 * they cannot share a file.
 *
 * WHAT A DRIFT WOULD COST, stated concretely because "they might diverge" is not a
 * reason on its own. `isGuestEmail` decides whether an address is a guest. If the two
 * copies ever disagree about that, the tool mints an address the server does not
 * recognise as a guest, and the server then treats it as a PLAYER: isMember falls
 * through to the userPools branch, which is exactly the never-expiring grant the pass
 * design exists to replace. Nothing would error. The link would simply work forever.
 *
 * DUPLICATION THAT CANNOT DRIFT IS TOLERABLE, so the rule is duplicate and ASSERT. This
 * fails if the region between the SHARED CORE markers differs by one byte.
 *
 * IT SKIPS LOUDLY when the sibling clone is absent, and never passes quietly: a gate
 * that reports success when it could not find the thing it is checking is the fail-open
 * shape this repo keeps cataloguing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'tools-guest-pass-core.js');
const DEFAULT_API_REPO = path.resolve(__dirname, '..', 'coldufantasy-login');

function apiRepo() {
  const i = process.argv.indexOf('--repo');
  return i >= 0 ? process.argv[i + 1] : DEFAULT_API_REPO;
}

const BEGIN = '/* ---- SHARED CORE BEGIN';
const END = '/* ---- SHARED CORE END ---- */';

/* The markers are EXPLICIT rather than "everything above module.exports", which is what
   tools-api-parity.js uses. The difference is that this core needs `crypto`, and the
   import line is the one thing that genuinely must differ between a CommonJS file and an
   ESM one, so the boundary cannot simply be the export. */
function core(text, where) {
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0) throw new Error('no SHARED CORE BEGIN marker in ' + where);
  if (b < 0) throw new Error('no SHARED CORE END marker in ' + where);
  if (b < a) throw new Error('the markers are out of order in ' + where);
  const start = text.indexOf('*/', a) + 2;
  return text.slice(start, b).replace(/^\s+|\s+$/g, '');
}

let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(52) +
    (detail == null ? '' : String(detail)));
}

console.log('GUEST PASS CORE PARITY');

const repo = apiRepo();
const COPY = path.join(repo, 'lib', 'guest-pass.js');

if (!fs.existsSync(SRC)) {
  console.log('\n  [FAIL] the source is missing: ' + SRC);
  process.exit(1);
}
if (!fs.existsSync(COPY)) {
  console.log('\n  [SKIP] the coldufantasy-login clone is not at ' + repo);
  console.log('         Pass --repo <path>. THIS IS A SKIP AND NOT A PASS: nothing was');
  console.log('         compared, so nothing is known about the deployed copy.');
  process.exit(0);
}

const a = core(fs.readFileSync(SRC, 'utf8'), SRC);
const b = core(fs.readFileSync(COPY, 'utf8'), COPY);

check('both files carry the SHARED CORE markers', a.length > 0 && b.length > 0,
  a.length + ' vs ' + b.length + ' bytes');
check('the shared core is byte-identical', a === b,
  a === b ? 'identical' : 'DIVERGED');

if (a !== b) {
  const al = a.split('\n'), bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      console.log('\n  first difference at core line ' + (i + 1) + ':');
      console.log('    board: ' + JSON.stringify(al[i] === undefined ? '(end of file)' : al[i].slice(0, 110)));
      console.log('    api:   ' + JSON.stringify(bl[i] === undefined ? '(end of file)' : bl[i].slice(0, 110)));
      break;
    }
  }
  console.log('\n  Do NOT hand-edit either file to agree. Regenerate the copy.');
}

/* The wrappers are allowed to differ, but only in the one way they are supposed to: one
   module system each, and the same export list. A copy that quietly stopped exporting a
   predicate would import as undefined at the call site and read as "false" there, which
   is the silent direction. */
const srcText = fs.readFileSync(SRC, 'utf8');
const copyText = fs.readFileSync(COPY, 'utf8');
const names = (s) => {
  const m = /(?:module\.exports\s*=\s*\{|export\s*\{)([^}]*)\}/.exec(s);
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean).sort().join(',') : '';
};
check('both export the same names', names(srcText) === names(copyText) && names(srcText).length > 0,
  names(srcText).split(',').length + ' names');
check('the board copy is CommonJS', /module\.exports\s*=/.test(srcText) && !/\bexport\s/.test(srcText));
check('the API copy is ESM', /export\s*\{/.test(copyText) && !/module\.exports/.test(copyText));

console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
