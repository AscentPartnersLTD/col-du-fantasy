/* tools-claudemd-paths.js - the gate that keeps CLAUDE.md honest about its own repo.
 *
 * WHY THIS EXISTS. CLAUDE.md is the cold-start brief, and a reader trusts it. A path it
 * names that is not in the repo is the documentation twin of the defect recorded under
 * "A CONFIG FLAG WITH NO CONSUMER IS NOT CONFIGURATION": it reads as executable, nobody
 * checks it, and anyone reasoning from it reaches a wrong answer with full confidence.
 * `tools/close-stage.js` is the live case. CLAUDE.md describes it in detail, in several
 * sections, as the thing that resolves picks to bibs and writes scored finishes. It has
 * never existed in this repo and has never appeared in its git history.
 *
 * Run:  node tools-claudemd-paths.js
 * Exit: 0 when every referenced path resolves or is a declared external, 1 otherwise.
 *
 * A path is only ever ADDED to EXTERNAL with a reason. Do not silence a miss by listing
 * it here: an EXTERNAL entry is a claim that the file legitimately lives somewhere else,
 * and a wrong claim here is the same failure one level up.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DOC = 'CLAUDE.md';

/* Paths CLAUDE.md names that are NOT meant to be in this repo. Each carries the reason,
   because "it is fine" without a reason is how a real miss gets buried. */
const EXTERNAL = {
  'Vuelta-Fantasy-Build-Plan.md':
    'lives in Allen Claude project knowledge, not this repo; CLAUDE.md says so explicitly',
  'api/break.js':
    'the primary proxy, in the coldufantasy-login repo with its own Vercel deploy',
  'persona-bank-additions.js':
    'documented in Open items as BLOCKED and never delivered; its absence IS the record',
  'scratchpad/sim.js':
    'session scratchpad, deliberately outside the repo',
  '2026/icg.png':
    'a path on lavuelta.es, not a local file',
  'giro.src.html':
    'planned, in the Adding the Giro checklist; not yet created',
  'giro-og.png':
    'planned, in the Adding the Giro checklist; not yet created',
};

/* Extensions that name a real artifact. Anything else in backticks is prose or code. */
const EXT = /\.(html|js|py|json|toml|rules|md|png|jpe?g|webmanifest)$/i;

function candidates(src) {
  const out = new Map();          // path -> line numbers
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    const spans = line.match(/`[^`]+`/g) || [];
    spans.forEach((span) => {
      span.slice(1, -1).split(/[\s(),;]+/).forEach((raw) => {
        let t = raw.trim().replace(/[.,;:]+$/, '');
        if (!t || !EXT.test(t)) return;
        /* Not a repo file: URLs, and any glob or placeholder. A placeholder path is a
           SHAPE, not a file, and asserting it exists would be nonsense. */
        if (/^https?:/i.test(t)) return;
        if (/[<>{}*]/.test(t)) return;
        /* Absolute Windows path, machine-local. Written with charCodeAt rather than a
           regex on purpose: a doubled backslash in a character class does not survive
           every heredoc, and it fails SILENTLY as a class that matches only a slash. */
        if (t.charAt(1) === ":" && (t.charAt(2) === "/" || t.charCodeAt(2) === 92)) return;
        /* A bare extension such as ".js" is prose, not a path. CLAUDE.md writes one in
           the validate step, numbered `.js` files. */
        if (t.lastIndexOf(".") <= 0) return;
        const key = t.replace(/^\.?\//, '');     // '/vuelta.html' and './x' are repo-root
        if (!key) return;
        if (!out.has(key)) out.set(key, []);
        if (out.get(key).indexOf(i + 1) < 0) out.get(key).push(i + 1);
      });
    });
  });
  return out;
}

function main() {
  if (!fs.existsSync(DOC)) {
    console.error('FAIL: ' + DOC + ' not found. Run from the repo root.');
    process.exit(1);
  }
  const found = candidates(fs.readFileSync(DOC, 'utf8'));
  const ok = [], ext = [], missing = [];

  [...found.keys()].sort().forEach((p) => {
    const at = found.get(p);
    if (fs.existsSync(path.join(process.cwd(), p))) ok.push([p, at]);
    else if (EXTERNAL[p]) ext.push([p, at]);
    else missing.push([p, at]);
  });

  console.log('CLAUDE.md path references: ' + found.size + ' distinct');
  console.log('  present in repo : ' + ok.length);
  console.log('  declared external: ' + ext.length);
  console.log('  MISSING          : ' + missing.length);

  if (ext.length) {
    console.log('\nDeclared external (not a failure, each with its reason):');
    ext.forEach(([p, at]) => console.log('  ' + p + '  [line ' + at.join(', ') + ']\n      ' + EXTERNAL[p]));
  }

  if (missing.length) {
    console.log('\nMISSING - named by CLAUDE.md, absent from the repo:');
    missing.forEach(([p, at]) => console.log('  ' + p + '  [line ' + at.join(', ') + ']'));
    console.log('\nEither create the file, correct the reference, or add it to EXTERNAL');
    console.log('WITH A REASON. Do not silence it by listing it without one.');
    process.exit(1);
  }

  console.log('\nPASS: every path CLAUDE.md names resolves.');
}

main();
