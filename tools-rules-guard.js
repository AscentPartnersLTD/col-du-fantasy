#!/usr/bin/env node
/* tools-rules-guard.js - assert the INVARIANTS of firestore.rules.
 *
 *   node tools-rules-guard.js
 *
 * WHAT THIS IS NOT. It is not a rules unit test and it is not a compiler. The real
 * tests live in tools-rules-tests/ and run against the Firestore emulator; this is
 * the cheap static gate that runs in a second alongside them.
 *
 * WHAT IT IS. A check of the handful of properties that are easy to break by hand
 * and expensive to get wrong under the SHOWROOM design:
 *
 *  1. THE PRODUCTION POOL BLOCK IS UNCHANGED from what is deployed. A guest never
 *     reads col-du-fantasy or vuelta-2026, so nothing about them needs to move, and
 *     the migration that used to live here is what made a five-step cutover
 *     necessary. If this check fails, somebody has reintroduced that risk.
 *  2. A VIEWER CAN NEVER REACH A PRODUCTION POOL, denied by NAME and not by a flag.
 *  3. A VIEWER NEVER WRITES. No allow-write clause names viewerOf, and a clause that
 *     names a showroom must require owner(): since 2026-11-17 the owner may seed a
 *     showroom copy's predictions, which the copy tool's own members scrub is what made
 *     necessary, and that is the only write clause the word showroom may appear in.
 *  4. config/roster is closed. It holds players and reviewers keyed by EMAIL under
 *     what used to be a blanket signedIn() read.
 *  5. NOTHING IS PUBLIC, and nothing still grants on signedIn() alone.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SRC = path.join(__dirname, 'firestore.rules');

let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(54) +
    (detail == null ? '' : String(detail)));
}

const raw = fs.readFileSync(SRC, 'utf8');

/* Comments carry the words "viewer" and "guest" everywhere by design, so every check
   below runs against the rules with comments stripped. A gate that reads its own prose
   is the same mistake as a text match standing in for a component. */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/* An allow clause runs from `allow` to its semicolon and OFTEN SPANS LINES: the two
   scoped member updates are five visual rows each. Parse whole statements. */
const allows = (src.match(/allow\s[^;]*;/g) || []).map(a => a.replace(/\s+/g, ' ').trim());
const writeAllows = allows.filter(l => /allow[^:]*\b(write|create|update|delete)\b/.test(l));
const readAllows = allows.filter(l => /allow[^:]*\bread\b/.test(l));

console.log('FIRESTORE RULES INVARIANTS');
console.log('  ' + allows.length + ' allow clauses, ' + readAllows.length + ' read, ' +
  writeAllows.length + ' write\n');

/* ---- 1. braces balance, the one syntax error a hand edit makes ---- */
const opens = (src.match(/{/g) || []).length, closes = (src.match(/}/g) || []).length;
check('braces balance', opens === closes, opens + ' open, ' + closes + ' close');

/* ---- 2. nothing is public, and nothing grants on signedIn() alone ---- */
check('no rule is unconditionally public',
  allows.filter(l => /:\s*if\s+true\s*;/.test(l)).length === 0);

/* `signedIn()` on its own is the shape that let a guest read config/roster. It is
   legitimate ONLY where a further term narrows it to the caller's own document. */
const bareSignedIn = allows.filter(l => {
  const cond = (l.split(/:\s*if\s/)[1] || '');
  if (!/signedIn\(\)/.test(cond)) return false;
  return !/em\(\)|owner\(\)|isMember\(\)|isPlayer\(\)|resource\.data\.members|viewerOf|showroomPool/.test(cond);
});
check('no clause grants on signedIn() alone', bareSignedIn.length === 0,
  bareSignedIn.length ? bareSignedIn.join(' | ') : 'every one is narrowed to the caller');

/* ---- 3. THE PRODUCTION BLOCK IS UNCHANGED ---- */
/* Compared against the rules as they stand on origin/main, which is what is deployed.
   This is the check that keeps the dropped migration dropped. */
let deployed = null;
try {
  deployed = execFileSync('git', ['show', 'origin/main:firestore.rules'],
    { cwd: __dirname, encoding: 'utf8' });
} catch (e) { /* no origin, see the skip below */ }

if (deployed == null) {
  console.log('  [SKIP] production comparison            origin/main:firestore.rules unreadable');
} else {
  const norm = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
  const prodRead = /allow read:\s*if owner\(\) \|\| \(signedIn\(\) && em\(\) in resource\.data\.members\)/;
  check('the production pool read is the deployed one, plus viewerOf',
    prodRead.test(src) && prodRead.test(deployed),
    'untouched: a guest is denied by the rule that already exists');

  /* every production helper must still read the members MAP, not a subcollection */
  check('inPool still reads the members map off the pool doc',
    /function inPool\(poolId\)\s*{\s*return signedIn\(\) && poolExists\(poolId\) && \(em\(\) in poolCfg\(poolId\)\.members\)/.test(src),
    norm(src.match(/function inPool[^}]*}/)[0]).slice(0, 72));
  check('poolSeat still reads the members map',
    /function poolSeat\(poolId\)\s*{\s*return poolCfg\(poolId\)\.members\[em\(\)\]/.test(src));
  check('no members subcollection was left behind',
    !/match\s+\/members\//.test(src),
    'its absence is why there is no cutover');
  check('no guests collection was left behind', !/match\s+\/guests\//.test(src));
  check('no custom guest claim is relied on', !/request\.auth\.token\.get\('guest/.test(src),
    'access is the viewers map on the copy');

  /* the two scoped member updates survive verbatim */
  const scoped = allows.filter(l => /affectedKeys\(\)/.test(l));
  check('both scoped member updates survive, gated on inPool', scoped.length === 2 &&
    scoped.every(l => /inPool\(poolId\)/.test(l)), scoped.length + ' clause(s)');
}

/* ---- 4. a viewer can never reach production, by NAME ---- */
console.log('');
const prodFn = (src.match(/function prodPool\(poolId\)\s*{[^}]*}/) || [''])[0];
check('the production pools are named explicitly',
  /col-du-fantasy/.test(prodFn) && /vuelta-2026/.test(prodFn),
  'denied by name, so a stray showroom flag grants nothing');
const viewerFn = (src.match(/function viewerOf\(poolId\)\s*{[\s\S]*?\n    }/) || [''])[0];
check('viewerOf excludes production', /showroomPool\(poolId\)/.test(viewerFn));
check('showroomPool excludes production by name',
  /function showroomPool\(poolId\)\s*{\s*return !prodPool\(poolId\)/.test(src));
check('a showroom must declare itself', /showroom == true/.test(src),
  'the flag alone is not enough, and the name alone is not enough');
check('an invitation expires on its own',
  /request\.time < poolCfg\(poolId\)\.viewers\[em\(\)\]/.test(viewerFn),
  'a lapsed viewer stops working with no cleanup job');

/* ---- 5. a viewer never writes ---- */
console.log('');
/* THIS USED TO REFUSE BOTH `viewerOf` AND `showroom` in any write clause, and the
   second half was too broad. The invariant is that a VIEWER never writes, not that the
   word showroom may not appear: the owner may seed a showroom copy's predictions, which
   names showroomPool() in a write clause and is correct. So the two halves are now
   separate, and the second is NARROWER than what it replaced rather than relaxed: a
   write clause may name a showroom only while it also requires owner(). */
check('no write clause mentions a viewer',
  writeAllows.filter(l => /viewerOf/.test(l)).length === 0);
const showroomWrites = writeAllows.filter(l => /showroom/i.test(l));
/* THE COUNT IS ASSERTED, and that is not tidiness. Written as `.every()` alone these
   two checks PASSED VACUOUSLY on an injected regression: dropping `&& showroomPool`
   leaves `allow write: if owner();`, which this filter does not match, so the array is
   empty and every() is true. 27/27 held while the rule granted the owner predictions on
   BOTH production pools. The emulator suite caught it with four named failures and this
   gate did not, which is the fail-open shape in the gate written to catch it. */
check('exactly one write clause names a showroom', showroomWrites.length === 1,
  showroomWrites.length + ' clause(s); zero means the scope was dropped, not that none exists');
check('and it is owner-gated',
  showroomWrites.length === 1 && /owner\(\)/.test(showroomWrites[0]),
  'a viewer never writes, whatever the pool is flagged');
check('and it is not scoped by a seat the copy no longer carries',
  showroomWrites.length === 1 && !/poolSeat|inPool/.test(showroomWrites[0]),
  'the copy scrubs members, so a seat grant there is nobody');
/* The grant must reach ONLY predictions. Loose in the pool block it would cover every
   subcollection of every showroom. */
check('the showroom write is inside the predictions block',
  /match \/predictions\/\{seat\}[^}]*allow write: if owner\(\) && showroomPool\(poolId\);/
    .test(src),
  'one subcollection, not the whole copy');
const grants = readAllows.filter(l => /viewerOf\s*\(/.test(l));
check('viewer reads exist and are scoped by poolId',
  grants.length > 0 && grants.every(l => /viewerOf\(\s*poolId\s*\)/.test(l)),
  grants.length + ' grant(s)');
const readerDef = (src.match(/function poolReader\(poolId\)\s*{[^}]*}/) || [''])[0];
check('poolReader is the viewer read path', /viewerOf\(\s*poolId\s*\)/.test(readerDef));
check('poolReader is not widened past viewerOf',
  readerDef.length > 0 && !/signedIn\(\)\s*;|\|\|\s*signedIn\(\)/.test(readerDef));
check('a viewer reads predictions only when locked',
  /viewerOf\(poolId\) && predsLocked\(poolId\)/.test(src));

/* ---- 6. the legacy collections are closed ---- */
console.log('');
const cfg = (src.match(/match\s+\/config\/\{doc\}\s*{[\s\S]*?}/) || [''])[0];
check('config/{doc} is isMember(), not signedIn()',
  /allow read:\s*if isMember\(\)/.test(cfg),
  'it holds players and reviewers, both keyed by email');
const race = (src.match(/match\s+\/race\/\{doc=\*\*\}\s*{[\s\S]*?}/) || [''])[0];
check('the legacy race tree is isMember()', /allow read:\s*if isMember\(\)/.test(race));
const eng = (src.match(/match\s+\/engagement\/\{doc\}\s*{[\s\S]*?}/) || [''])[0];
check('top-level engagement writes are not signedIn()',
  /allow create, update:\s*if \(isPlayer\(\) \|\| owner\(\)\) && doc == em\(\)/.test(eng));
const up = (src.match(/match\s+\/userPools\/\{uid\}\s*{[\s\S]*?}/) || [''])[0];
check('a viewer reads their own userPools', /allow read:\s*if signedIn\(\) && \(uid == em\(\)/.test(up),
  'the switcher needs it');
/* NOT gated on isMember(): that locked out every pool member absent from the legacy
   config/roster, and the board writes this on every sign-in behind a catch(), so the
   denial was silent. Writing it grants nothing, which the emulator suite asserts. */
check('the userPools write is the caller own, not isMember()',
  /allow write:\s*if owner\(\) \|\| \(signedIn\(\) && uid == em\(\)\)/.test(up),
  'gating it on the legacy roster is a lockout, not a tightening');

/* ---- 7. the guest pass table and the visit log are OWNER ONLY ---- */
console.log('');
/* THE PASS ID IS THE CREDENTIAL. guestPasses is a list of every live link and every
   synthetic address, so one signed-in reader who should not have it is one reader who
   can sign in as every guest. guestVisits is a record about a person. Neither is read
   by a guest for any purpose: /auth/guest checks a pass server side through the admin
   SDK, which does not consult this file at all.

   ASSERTED BY COUNT AS WELL AS BY SHAPE, because `.every()` over clauses that match a
   collection passes VACUOUSLY when the match block has been deleted, which is how a
   27/27 was held on 2026-11-17 while the rule under test had been removed. */
['guestPasses', 'guestVisits'].forEach(function (coll) {
  const block = (src.match(new RegExp('match\\s+/' + coll + '/\\{[a-zA-Z]+\\}\\s*\\{[^}]*\\}')) || [''])[0];
  const clauses = (block.match(/allow\s[^;]*;/g) || []).map(a => a.replace(/\s+/g, ' ').trim());
  check(coll + ' has a match block', !!block, block ? clauses.length + ' clause(s)' : 'ABSENT');
  check(coll + ' grants ONLY the owner, read and write',
    clauses.length === 1 && /allow read, write:\s*if owner\(\);/.test(clauses[0]),
    clauses[0] || 'no clause');
  check('nothing else in the file mentions ' + coll,
    (src.match(new RegExp(coll, 'g')) || []).length === 1,
    'one match block, no second grant');
});
/* And the property that matters most, stated over the WHOLE file rather than per block:
   no clause anywhere grants a viewer or a member on either collection. */
check('no clause lets a guest near a pass or a visit',
  allows.filter(l => /guestPass|guestVisit/i.test(l)).length === 0,
  'they are reached only through the two match blocks above');

console.log('\n' + (ran - fails) + '/' + ran + ' invariants hold');
if (fails) {
  console.log('\nNOTE: these are INVARIANTS, not a compile. The emulator tests in');
  console.log('tools-rules-tests/ are what actually exercise the rules.');
}
process.exit(fails ? 1 : 0);
