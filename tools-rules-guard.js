#!/usr/bin/env node
/* tools-rules-guard.js - assert the INVARIANTS of firestore.rules.
 *
 *   node tools-rules-guard.js
 *
 * WHAT THIS IS NOT. It is not a rules unit test and it is not a compiler. Real
 * rules tests need the Firestore emulator, the emulator needs Java, and there is
 * no Java on Gerald. THE RULES IN THIS REPO HAVE NOT BEEN COMPILED. `firebase
 * deploy --only firestore:rules` compiles server side and rejects a syntax error,
 * so the deploy is the compile step, and that is the moment to find out.
 *
 * WHAT IT IS. A static check of the handful of properties that are easy to break
 * by hand and expensive to get wrong, drawn from what this project has actually
 * suffered:
 *
 *  1. NO EMAIL IS READABLE BY A GUEST. The whole feature turns on this. Two
 *     separate leak paths existed: `members` on the pool document, and
 *     `config/roster`, which holds `players` and `reviewers` keyed by email under
 *     a blanket signedIn() read. Fixing one and not the other fixes nothing.
 *  2. A GUEST NEVER WRITES. Not one allow-write clause may mention a guest.
 *  3. GUEST READS ARE SCOPED TO A NAMED POOL, never blanket, or a guest edits
 *     ?pool= and reads the Tour pool.
 *  4. NOTHING IS PUBLIC. No `if true` anywhere.
 *  5. The pool document no longer carries a members map, so no rule may read one.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'firestore.rules');

let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(52) +
    (detail == null ? '' : String(detail)));
}

const raw = fs.readFileSync(SRC, 'utf8');

/* Comments carry the word "guest" everywhere by design, so every check below runs
   against the rules with comments stripped. A gate that reads its own prose is
   the same mistake as a text match standing in for a component. */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/* An allow clause runs from `allow` to its semicolon and OFTEN SPANS LINES: the two
   scoped member updates are five visual rows each. Reading them line by line finds the
   word `allow` and none of the conditions, which is how the first version of this gate
   reported zero scoped updates while two sat in the file. Parse whole statements. */
const allows = (src.match(/allow\s[^;]*;/g) || []).map(a => a.replace(/\s+/g, ' ').trim());
const writeAllows = allows.filter(l => /allow[^:]*\b(write|create|update|delete)\b/.test(l));
const readAllows = allows.filter(l => /allow[^:]*\bread\b/.test(l));

console.log('FIRESTORE RULES INVARIANTS');
console.log('  ' + allows.length + ' allow clauses, ' + readAllows.length + ' read, ' +
  writeAllows.length + ' write\n');

/* ---- 1. braces balance, which is the one syntax error a hand edit makes ---- */
const opens = (src.match(/{/g) || []).length, closes = (src.match(/}/g) || []).length;
check('braces balance', opens === closes, opens + ' open, ' + closes + ' close');

/* ---- 2. nothing is public ---- */
const publicRules = allows.filter(l => /:\s*if\s+true\s*;/.test(l));
check('no rule is unconditionally public', publicRules.length === 0,
  publicRules.join(' | '));

/* ---- 3. a guest never writes ---- */
const guestWrites = writeAllows.filter(l => /guest/i.test(l));
check('no write clause mentions a guest', guestWrites.length === 0,
  guestWrites.join(' | '));

/* ---- 4. guest reads are scoped to a named pool ---- */
/* A GRANT to a guest is guestOf(). `!isGuest()` is an EXCLUSION, and counting it as a
   grant is how the first version of this gate failed on the two clauses that exist
   precisely to keep guests OUT of the legacy collections. */
const guestReads = readAllows.filter(l => /guestOf\s*\(/.test(l));
const guestExclusions = readAllows.filter(l => /!\s*isGuest\s*\(\)/.test(l));
check('at least one read is granted to a guest', guestReads.length > 0,
  guestReads.length + ' grant(s), ' + guestExclusions.length + ' explicit exclusion(s)');
const unscoped = guestReads.filter(l => !/guestOf\(\s*poolId\s*\)/.test(l));
check('every guest read is scoped by guestOf(poolId)', unscoped.length === 0,
  unscoped.length ? unscoped.join(' | ') : 'never blanket, so ?pool= cannot widen it');

/* MOST guest reads reach guestOf through the poolReader() helper rather than naming it,
   so the check above only ever sees the one clause that spells it out. Without this, the
   gate would pass on a poolReader that had quietly lost its guest arm, or worse on one
   widened to a bare isGuest(), which is the unscoped case that lets ?pool= reach the
   Tour pool. Check the helper, not just the call sites. */
const readerDef = (src.match(/function\s+poolReader\s*\(poolId\)\s*{[^}]*}/) || [''])[0];
check('poolReader is the guest read path', /guestOf\(\s*poolId\s*\)/.test(readerDef),
  readerDef.replace(/\s+/g, ' ').trim() || 'poolReader not found');
check('poolReader is not widened to a bare isGuest()',
  readerDef.length > 0 && !/\|\|\s*isGuest\s*\(\)/.test(readerDef),
  'a bare isGuest() would ignore which pool the guest was invited to');
const readerUses = readAllows.filter(l => /poolReader\(\s*poolId\s*\)/.test(l));
check('the pool doc, its stages and its drafts read through poolReader',
  readerUses.length >= 3, readerUses.length + ' clause(s)');

/* guestOf itself must require BOTH the claim and the record */
const guestOfDef = (src.match(/function\s+guestOf\s*\(poolId\)\s*{[\s\S]*?}/) || [''])[0];
check('guestOf requires the signed claim', /isGuest\(\)/.test(guestOfDef));
check('guestOf requires the pool to be named in the claim',
  /poolId\s+in\s+request\.auth\.token/.test(guestOfDef),
  'so a guest cannot reach another pool by editing the URL');
check('guestOf requires the guest record to still exist', /exists\(guestDoc\(\)\)/.test(guestOfDef),
  'deleting the record revokes immediately, not in an hour');

/* ---- 5. THE BLOCKER: no email is reachable by a guest ---- */
check('no rule reads a members map off the pool document',
  !/resource\.data\.members|poolCfg\([^)]*\)\.members/.test(src),
  'addresses live in pools/{poolId}/members/{email}');

const memberBlock = (src.match(/match\s+\/members\/\{email\}\s*{[\s\S]*?}/) || [''])[0];
check('the members subcollection exists', memberBlock.length > 0);
check('a member document is readable only by the owner or that address',
  /allow read:\s*if owner\(\)\s*\|\|\s*\(signedIn\(\)\s*&&\s*email\s*==\s*em\(\)\)/.test(memberBlock),
  'so no player can read the other three either');
check('no guest can reach the members subcollection', !/guest/i.test(memberBlock));

/* config/roster is the SECOND leak path and is the one that gets forgotten */
const configBlock = (src.match(/match\s+\/config\/\{doc\}\s*{[\s\S]*?}/) || [''])[0];
check('config/{doc} excludes guests explicitly', /!isGuest\(\)/.test(configBlock),
  'it holds players and reviewers, both keyed by email');
const raceBlock = (src.match(/match\s+\/race\/\{doc=\*\*\}\s*{[\s\S]*?}/) || [''])[0];
check('the legacy race tree excludes guests', /!isGuest\(\)/.test(raceBlock));

/* ---- 6. the two scoped member updates still cannot be reached by a guest ---- */
const scoped = allows.filter(l => /affectedKeys\(\)/.test(l));
check('scoped updates are gated on inPool, not on a reader', scoped.length >= 2 &&
  scoped.every(l => /inPool\(poolId\)/.test(l)),
  scoped.length + ' scoped update clause(s)');

/* ---- 7. predictions open to a guest ONLY once locked ---- */
const predBlock = (src.match(/match\s+\/predictions\/\{seat\}\s*{[\s\S]*?\n\s*}/) || [''])[0];
const predRead = (predBlock.match(/allow read:[^;]*/) || [''])[0];
check('a guest reads predictions only when they are locked',
  /guestOf\(poolId\)\s*&&\s*predsLocked\(poolId\)/.test(predRead),
  'a blank panel where a finished side game should be is the failure this avoids');
check('a guest cannot write a prediction', !/guest/i.test((predBlock.match(/allow write:[^;]*/) || [''])[0]));

console.log('\n' + (ran - fails) + '/' + ran + ' invariants hold');
if (fails) {
  console.log('\nNOTE: these are INVARIANTS, not a compile. The rules have not been');
  console.log('compiled; `firebase deploy --only firestore:rules` is what compiles them.');
}
process.exit(fails ? 1 : 0);
