#!/usr/bin/env node
/* tools-validate-build.js - the pre-push validation from CLAUDE.md, executable.
 *
 *   node tools-validate-build.js
 *
 * WHY THIS EXISTS RATHER THAN THE GREP THE RULE USED TO IMPLY.
 *
 * Validation step 1 is "zero U+2013 en dashes and zero U+2014 em dashes". Doing that
 * with a grep bracket expression in Git Bash on Dragon MATCHES BYTES, not characters, so
 * it reports a false positive on every non-ASCII character whose UTF-8 encoding happens
 * to share a byte with those dashes.
 *
 * On 2026-09-09 it claimed four dash lines in vuelta.src.html. A codepoint scan found
 * ZERO. The four lines contain A-grave, Y-diaeresis, ae and combining marks, all inside
 * regex character classes.
 *
 * THE FIX WOULD HAVE BEEN THE BUG. Those lines are normName and the accent-folding
 * table, and both decide whether a rider name matches. "Correcting" a dash that is not
 * there would have broken name resolution on the strength of a tool artifact.
 *
 * So: scan codepoints, never a bracket expression. Everything else here is the rest of
 * the checklist, run the same way for the same reason.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const REPO = __dirname;
let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(44) +
    (detail == null ? '' : String(detail)));
}

/* CODEPOINTS. Not bytes, not a grep. */
function dashCount(s) {
  let en = 0, em = 0;
  for (const ch of s) { if (ch === '–') en++; else if (ch === '—') em++; }
  return { en, em };
}

/* EVERY BUILT BOARD, and that is the point of this entry. This table read
   `{ 'vuelta.html': 'vuelta-2026' }` ALONE until 2026-11-17, so the whole Tour family
   was outside the pre-push gate. That is how a finished Tour went two months showing a
   stage 22 draft card, a stage 22 Captain 'Merica picker and a live break check, on two
   pools: the gate that would have seen it was reading the other file. A gate that covers
   one of two boards cannot see the board that is wrong.

   board.html expects an EMPTY DEFAULT_POOL, which is a value and not an absence, so the
   per-file pool check below tests against null rather than against falsy. */
const BUILT = {
  'vuelta.html': 'vuelta-2026',
  'tour.html': 'col-du-fantasy',
  'index.html': 'col-du-fantasy',
  'tour-staging.html': 'col-du-fantasy',
  'board.html': '',
};
const SOURCES = ['vuelta.src.html', 'board.src.html'];

function checkFile(f, expectPool) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) { check(f + ' exists', false); return null; }
  const s = fs.readFileSync(p, 'utf8');
  console.log('\n' + f);

  const d = dashCount(s);
  check('zero en dashes (U+2013)', d.en === 0, String(d.en));
  check('zero em dashes (U+2014)', d.em === 0, String(d.em));
  check('zero dash HTML entities', (s.match(/&[mn]dash;/g) || []).length === 0);

  const open = (s.match(/<script/g) || []).length;
  const close = (s.match(/<\/script>/g) || []).length;
  check('script tags balance', open === close, open + ' open, ' + close + ' close');

  if (expectPool !== null) {
    const m = s.match(/DEFAULT_POOL\s*=\s*'([^']*)'/);
    check('DEFAULT_POOL is ' + (expectPool === '' ? 'empty' : expectPool),
      m && m[1] === expectPool, m ? JSON.stringify(m[1]) : 'absent');
    check('no unsubstituted placeholders', s.indexOf('{{') < 0);
    check('build stamp present', /<!-- build:\d{8}-\d{6}Z -->/.test(s),
      (s.match(/<!-- build:[^>]*-->/) || [''])[0]);
  }
  return s;
}

SOURCES.forEach(f => checkFile(f, null));
const allBuilt = {};
Object.keys(BUILT).forEach(f => {
  const s = checkFile(f, BUILT[f]);
  if (s) allBuilt[f] = s;
});
/* The operator card section below is VUELTA ONLY, deliberately: that card does not exist
   on the Tour family at all, so asserting it there would fail on a correct board. Every
   other section runs per file. */
const built = allBuilt['vuelta.html'] || null;

/* The operator card, which is the one surface that must never reach a player. */
if (built) {
  console.log('\noperator card');
  check('the card ships', built.indexOf('__opCloseBoot') > 0);
  check('it is gated in JS, not CSS', /if\(!isOwner\) return;/.test(built));
  check('the served body carries only an empty mount',
    (built.match(/<div id="opClose"><\/div>/g) || []).length === 1);
  check('it fetches nothing on load', /function boot\(\)\{ render\(\); \}/.test(built),
    'boot must not call preview');
}

/* Extract every inline script and parse it. */
console.log('\ninline scripts');
Object.keys(allBuilt).forEach(function (bf) {
  const built = allBuilt[bf];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0, bad = 0;
  while ((m = re.exec(built))) {
    i++;
    if (!m[1].trim()) continue;
    const tmp = path.join(os.tmpdir(), 'cdf_val_' + process.pid + '_' + i + '.js');
    fs.writeFileSync(tmp, m[1]);
    try { execSync('node --check "' + tmp + '"', { stdio: 'pipe' }); }
    catch (e) { bad++; console.log('  [FAIL] block ' + i + ': ' +
      String(e.stderr || e).split('\n').slice(0, 2).join(' ')); }
    fs.unlinkSync(tmp);
  }
  check(bf + ': every inline script parses', bad === 0, i + ' blocks checked');
});

console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
