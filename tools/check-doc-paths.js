#!/usr/bin/env node
/* check-doc-paths.js - fail if CLAUDE.md names a file that does not exist.
 *
 *   node tools/check-doc-paths.js          exit 1 if any referenced path is missing
 *   node tools/check-doc-paths.js --list   also print every path it matched
 *
 * WHY THIS EXISTS. CLAUDE.md described tools/close-stage.js as doing real work for
 * two days. It had never existed in any commit. Four files have now been recorded
 * here as shipped that never landed: vuelta-og.png, make_vuelta_og.py,
 * persona-bank-additions.js and close-stage.js. A document that confidently
 * describes tools that were never built is WORSE than no document, because the next
 * session plans around them and only finds out at the moment it needs one.
 *
 * The rule this enforces is the same one CLAUDE.md already states about config
 * flags: a reference with nothing behind it is not documentation, it is a comment
 * that looks executable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DOC = path.join(REPO, 'CLAUDE.md');

/* Extensions worth checking. A token without one of these is prose, not a path. */
const EXT = ['.js','.py','.html','.md','.json','.rules','.toml','.webmanifest',
             '.png','.jpg','.mp3','.css','.txt','.yml','.yaml'];

/* Paths CLAUDE.md names on purpose that are NOT in this repo. Each needs a reason,
   and the reason is checked: an entry with no explanation is itself a failure. */
const EXTERNAL = {
  'Vuelta-Fantasy-Build-Plan.md':
    'lives in Allen\'s Claude project knowledge, not this repo. CLAUDE.md says so explicitly.',
  'api/break.js':
    'lives in the coldufantasy-login repo, which has its own Vercel deploy.',
  'persona-bank-additions.js':
    'BLOCKED and known absent. CLAUDE.md records it as never delivered; that is the point of the entry.',
  'settings.json':
    'Claude Code configuration under ~/.claude, not a repo file.',
  'firebase-tools.json':
    'the firebase CLI configstore under the user profile.',
  'giro.src.html':
    'a planned file for a race not yet added. Named in the Adding the Giro checklist as future work.',
  'index.js':
    'generic example text, not a repo file.',
  'giro-og.png':
    'future work. Named in the Adding the Giro checklist as a thing to build, not as a thing that exists.',
  '2026/icg.png':
    'a path on lavuelta.es, not in this repo. Part of the ranking-jersey URL note.'
};

/* Tokens that are patterns rather than paths. */
function isPlaceholder(t) {
  return /[<>{}*]/.test(t) || /^\d+\.jpg$/.test(t) === false && /\$\{/.test(t);
}

function main() {
  const listing = process.argv.includes('--list');
  const src = fs.readFileSync(DOC, 'utf8');

  /* Anything in backticks, plus bare tokens that look like a filename with a slash. */
  const raw = new Set();
  for (const m of src.matchAll(/`([^`\n]+)`/g)) raw.add(m[1].trim());
  for (const m of src.matchAll(/(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.\w+)/g)) raw.add(m[1].trim());

  const candidates = [];
  for (const t of raw) {
    if (!t || /\s/.test(t)) continue;                 /* commands, prose */
    if (/^https?:/.test(t)) continue;                 /* URLs */
    if (isPlaceholder(t)) continue;                   /* <race>.html, {{BUILD_STAMP}} */
    if (EXT.includes(t.toLowerCase())) continue;      /* a bare extension, as in "numbered .js files" */
    if (!EXT.some(e => t.toLowerCase().endsWith(e))) continue;
    candidates.push(t.replace(/^\.\//, ''));
  }

  /* A bare basename resolves if exactly ONE file in the repo carries it, so
     CLAUDE.md may say close-stage.js for tools/close-stage.js. Ambiguity does not
     resolve, because then the reference genuinely is unclear. */
  const index = {};
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else (index[e.name] = index[e.name] || []).push(path.relative(REPO, p));
    }
  })(REPO);

  const missing = [], external = [], ok = [];
  for (const t of candidates.sort()) {
    if (EXTERNAL[t] || EXTERNAL[path.basename(t)]) { external.push(t); continue; }
    if (fs.existsSync(path.join(REPO, t))) { ok.push(t); continue; }
    const hits = index[path.basename(t)] || [];
    if (t.indexOf('/') < 0 && hits.length === 1) { ok.push(t + '  -> ' + hits[0]); continue; }
    missing.push(t + (hits.length > 1 ? '  (ambiguous: ' + hits.join(', ') + ')' : ''));
  }

  console.log('CLAUDE.md path check');
  console.log('  referenced ' + candidates.length + '   present ' + ok.length +
    '   external-by-design ' + external.length + '   MISSING ' + missing.length);

  if (listing) {
    console.log('\n  present:');
    ok.forEach(t => console.log('    ' + t));
    console.log('\n  external by design:');
    external.forEach(t => console.log('    ' + t + '   -- ' + (EXTERNAL[t] || EXTERNAL[path.basename(t)])));
  }

  if (missing.length) {
    console.log('\n  MISSING, and CLAUDE.md speaks about them as if they exist:');
    missing.forEach(t => console.log('    ' + t));
    console.log('\n  Fix one of two ways. Build the file, or correct CLAUDE.md so it stops');
    console.log('  claiming the file is there. If it is deliberately outside the repo, add it');
    console.log('  to EXTERNAL in this script WITH A REASON.');
    process.exit(1);
  }

  console.log('\n  every path CLAUDE.md names is accounted for.');
}

main();
