#!/usr/bin/env node
/* tools-guest-verify.js - a guest session creates no game node and fires no game write.
 *
 *   node tools-guest-verify.js
 *
 * It lifts the SHIPPED code out of the built vuelta.html, the same way
 * tools-roster-verify.js, tools-draft-guard-verify.js and tools-opcard-verify.js
 * lift theirs, so this measures what deploys and not a transcription of it.
 *
 * TWO HALVES, and the second is the one that matters more.
 *
 *  1. NOTHING FORBIDDEN IS BUILT. Suppression is by NOT RENDERING, never by CSS: a
 *     display:none control is still in the DOM and one stylesheet mistake away from
 *     being usable. So the assertion is that the mount is untouched, not hidden.
 *  2. EVERY VIEW-ONLY CONTROL STAYS LIVE. A guest who cannot change a chart type is
 *     a guest looking at a locked screen, which is the opposite of welcome. A test
 *     that only checked for absence would pass on exactly that broken board, so the
 *     presence checks are not optional padding.
 *
 * THE PREDICATE IS `CAN_PLAY`, not `CAN_WRITE`. What it gates is whether a session
 * can change the GAME for AA, JB, JJ or JP. A remembered tab or a chart toggle is a
 * write to localStorage and is nobody else's business.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const REPO = __dirname;
const SRC = fs.readFileSync(path.join(REPO, 'vuelta.html'), 'utf8');

let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(54) +
    (detail == null ? '' : String(detail)));
}

/* ------------------------------------------------------------------ statics -- */
/* Every GAME write in the file, with the guard that is supposed to stand in front
   of it. This list is deliberately explicit rather than a regex sweep: a new write
   site added later will not appear here, and the count check below is what makes
   that visible instead of silently passing. */
console.log('GUEST ACCESS: THE SHIPPED BOARD\n');
console.log('EVERY GAME WRITE IS BEHIND CAN_PLAY');

const writeRe = /(?:draftRef\(\)\.(?:set|update)|jpRef\([^)]*\)\.set|db\.doc\('pools\/'\+poolId\)\.update|db\.runTransaction)/g;
const writes = SRC.match(writeRe) || [];
check('the board still has game writes to guard', writes.length >= 8, writes.length + ' call sites');

/* Each one must sit inside a function whose entry is gated. Rather than parse
   scopes, assert that CAN_PLAY appears often enough to cover them and that no
   guard was left as the old myCode-only form. */
const canPlayGuards = (SRC.match(/if\(!CAN_PLAY\(\)/g) || []).length;
check('CAN_PLAY guards are present at the entry points', canPlayGuards >= 8,
  canPlayGuards + ' guard(s)');
check('CAN_PLAY is defined once', (SRC.match(/function CAN_PLAY\(\)/g) || []).length === 1);
check('CAN_PLAY covers the owner as well as a seat',
  /function CAN_PLAY\(\)\{ return !!myCode \|\| isOwner; \}/.test(SRC),
  'the owner enters picks for players');

/* the old guards must be gone, or a site is protected by the weaker test */
check('no game write is still guarded by a bare myCode test',
  !/if\(!myCode\|\|!draft\)/.test(SRC) && !/if\(isOwner\|\|myCode\)\{/.test(SRC) &&
  !/if\(!myCode && !isOwner\)/.test(SRC),
  'a bare myCode test lets the owner through inconsistently');

console.log('\nTHE GUEST FLAG COMES FROM THE SERVER');
check('isGuest is read from a signed claim', /_idr&&_idr\.claims&&_idr\.claims\.guest/.test(SRC),
  'never from anything the page can decide for itself');
check('a guest is never the owner', /claims\.guest\)&&!isOwner/.test(SRC));
check('a guest never resolves a seat', /myCode=isGuest\?null:await resolveSeat\(\)/.test(SRC));

console.log('\nSUPPRESSED BY NOT RENDERING, NEVER BY CSS');
const draftFn = SRC.slice(SRC.indexOf('function renderDraft()'),
  SRC.indexOf('function renderDraft()') + 2600);
check('the live draft builds NO node for a guest',
  /if\(isGuest\)\{[\s\S]{0,220}innerHTML='';[\s\S]{0,40}return;/.test(draftFn),
  'mount emptied and returned, not hidden');
check('the locked strip IS kept for a guest',
  /if\(isGuest\)\{\s*if\(done && picks\.length\)\{ renderMini\(picks\); return; \}/.test(draftFn),
  'the best surface on the board is story, not control');
check('the guest branch sits ABOVE the draft-done POST',
  draftFn.indexOf('if(isGuest)') < draftFn.indexOf('api/draft-done'),
  'so a watcher never fires it');

/* no display:none suppression crept in */
const cssSuppression = /\.(?:guest|is-guest)\b[^{]*\{[^}]*display\s*:\s*none/i.test(SRC);
check('no CSS class hides a control from guests', !cssSuppression,
  'a hidden control is still reachable');

console.log('\nTHE VIEW-ONLY EXPERIENCE STAYS LIVE');
/* These are the controls Allen named. Each must be reachable with no seat, so none
   of them may consult CAN_PLAY or myCode. */
const viewOnly = [
  ['the anthem', /var KAS_SRC=/, /KAS_SRC[\s\S]{0,1200}?CAN_PLAY/],
  ['the See Placement toggle', /class="pt-btn sc-toggle on"/, null],
  ['tab switching', /data-tab="overview"/, null],
  ['the unpicked-teams explorer', /id="unpickedBtn"/, null],
  ['the locked predictions matrix', /JP_LOCKED && JP_ALL/, null]
];
viewOnly.forEach(([name, present]) => {
  check(name + ' is still in the board', present.test(SRC));
});
check('the anthem does not consult CAN_PLAY',
  !/KAS_AUDIO[\s\S]{0,400}CAN_PLAY/.test(SRC),
  'it changes only the listener\'s own browser');
check('tapping a rider with no seat opens the bio rather than picking',
  /if\(!CAN_PLAY\(\)\)\{ window\.__kasOpen=r; renderKassei\(\); return; \}/.test(SRC) &&
  /if\(!CAN_PLAY\(\) \|\| isOut\)\{ window\.__merOpen=r; renderMerica\(\); return; \}/.test(SRC),
  'the observer experience the board already had');

console.log('\nNO ADDRESS IS READ FROM THE POOL DOCUMENT');
/* Checked against the source with BLOCK COMMENTS STRIPPED. The first version of this
   check failed on the comment that explains the change ("pool.members is GONE from the
   document"), which is a gate reading its own prose and calling it evidence. Only //
   line comments are left alone, because stripping them would eat every https:// URL. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
check('the board no longer reads a members map',
  !/pool\.members|p\.members\|\||\(pool\.members\|\|\{\}\)/.test(CODE),
  'addresses live in pools/{poolId}/members/{email}');
check('the second copy of the addresses is gone too', !/memberEmails/.test(CODE),
  'memberEmails was the same four addresses on the same document');
check('the seat comes from one member document',
  /db\.doc\('pools\/'\+poolId\+'\/members\/'\+myEmail\)/.test(SRC),
  'each session reads exactly its own');
check('a failed seat read degrades to a watcher, never to an exception',
  /catch\(e\)\{ diag\('seat read failed[\s\S]{0,60}return null; \}/.test(SRC),
  'the sign-in path must not throw');
check('the ORDER fallback carries no addresses',
  /Object\.keys\(pool\.names\|\|\{\}\)/.test(SRC) && /Object\.keys\(p\.names\|\|\{\}\)/.test(SRC));

console.log('\nTHE SPONSOR BAND');
check('an empty sponsor list renders nothing at all',
  /if\(band\) band\.remove\(\);/.test(SRC),
  'not three tiles reading Available');
check('a sponsor still brings the band back', /CDF\.boardConfig\.sponsors/.test(SRC));

console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
