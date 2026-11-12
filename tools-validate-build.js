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

const BUILT = { 'vuelta.html': 'vuelta-2026' };
const SOURCES = ['vuelta.src.html'];

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

  if (expectPool) {
    const m = s.match(/DEFAULT_POOL\s*=\s*'([^']*)'/);
    check('DEFAULT_POOL is ' + expectPool, m && m[1] === expectPool, m ? m[1] : 'absent');
    check('no unsubstituted placeholders', s.indexOf('{{') < 0);
    check('build stamp present', /<!-- build:\d{8}-\d{6}Z -->/.test(s),
      (s.match(/<!-- build:[^>]*-->/) || [''])[0]);
  }
  return s;
}

SOURCES.forEach(f => checkFile(f, null));
let built = null;
Object.keys(BUILT).forEach(f => { built = checkFile(f, BUILT[f]); });

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
if (built) {
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
  check('every inline script parses', bad === 0, i + ' blocks checked');
}

console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
