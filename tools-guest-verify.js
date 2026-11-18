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
const { execFileSync } = require('child_process');
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

console.log('\nA VIEWER IS NAMED IN THE VIEWERS MAP');
/* isGuest was a server-minted claim while the plan had guests reading PRODUCTION pools.
   Under the showroom design they read a COPY carrying no real addresses, so the flag is
   derived from the `viewers` map on that copy, the same shape `members` already has.
   It is not a security boundary and does not need to be: every write is refused by the
   rules, so editing the flag in devtools renders a copied draft card and nothing more. */
check('isGuest derives from the viewers map',
  /isGuest=\(!isOwner && !myCode && !!\(\(pool\.viewers\|\|\{\}\)\[myEmail\]\)\)/.test(SRC),
  'no claim, so no claim plumbing in the login API');
check('a seated player is never a viewer', /!isOwner && !myCode &&/.test(SRC),
  'both halves required, or a player on a showroom reads as a guest');
check('the owner is never a viewer of his own board', /isGuest=\(!isOwner/.test(SRC));
check('the viewer state follows the document, not boot',
  (SRC.match(/isGuest=\(!isOwner && !myCode/g) || []).length >= 2,
  'set in loadPool AND refreshed by the pool snapshot');

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

console.log('\nPRODUCTION READS ARE EXACTLY AS THEY WERE');
/* THE MIGRATION IS GONE, and this section is what proves it stayed gone. A guest never
   reads a production pool, so the existing members rule already denies them and the
   board must read production the way it always did. Reintroducing the subcollection
   would bring back the five-step cutover that can lock all four players out. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
check('the seat still comes from the members map',
  /myCode=\(pool\.members\|\|\{\}\)\[myEmail\]\|\|null/.test(CODE) &&
  /myCode=\(p\.members\|\|\{\}\)\[myEmail\]\|\|null/.test(CODE),
  'loadPool and the pool snapshot, both unchanged');
check('no member subcollection read was left behind',
  !/\/members\/'\+myEmail|resolveSeat/.test(CODE),
  'a stray one would need the cutover to work');
check('the ORDER fallback is the members map again',
  /Object\.values\(pool\.members\|\|\{\}\)/.test(CODE) &&
  /Object\.values\(p\.members\|\|\{\}\)/.test(CODE));
check('the owner roster heal is back on the members map',
  /new FP\('members',em\)/.test(CODE) && /memberEmails:FV\.arrayUnion/.test(CODE),
  'left exactly as it was, per the brief');

console.log('\nTHE GUEST VIEW PILL');
check('the served HTML carries only an empty mount',
  /<div id="guestPill"><\/div>/.test(SRC),
  'built by a viewer session, never hidden by CSS');
check('the pill is built only for a viewer',
  /gp\.innerHTML = isGuest[\s\S]{0,900}Guest view[\s\S]{0,120}: '';/.test(SRC));
/* IT SAYS THE VISITS ARE LOGGED, which is new on 2026-11-18 and is the whole reason
   the wording changed. The board now records when a guest arrives and roughly how long
   they stay; telling them so is the difference between a record and a surveillance. */
check('and it says the visits are logged',
  /Guest view &middot; Visits to this preview are logged\./.test(SRC),
  'the reader is told they are being measured');
check('it still carries no account state',
  !/guestMeta[\s\S]{0,40}innerHTML|until[\s\S]{0,20}gv-pill/.test(SRC),
  'no name, no expiry: that is what diagnostics are for');

console.log('\nTHE GUEST PASS LINK');
/* THE STRIP IS LIFTED AND EXECUTED, not pattern-matched. __stripPass is a pure function
   on a string for exactly this reason: a regex over the source would prove the code
   contains the word `delete`, which is not the same claim as "the pass comes out and
   everything else survives". */
function liftStrip(src, which) {
  const a = src.indexOf('function __stripPass(search){');
  if (a < 0) return null;
  const b = src.indexOf('\n}', a);
  if (b < 0) return null;
  return new Function('search', src.slice(src.indexOf('{', a) + 1, b) + '\n');
}
/* The Tour board is read HERE rather than from the `TOUR` const, which is declared
   further down this file and would be in its temporal dead zone at this point. That is
   the same trap CLAUDE.md records against `STAGE` in loadRoster, and it throws rather
   than reading as undefined, so it is at least loud. */
const TOUR_SRC = fs.readFileSync(path.join(REPO, 'tour.html'), 'utf8');
const stripV = liftStrip(SRC, 'vuelta');
const stripT = liftStrip(TOUR_SRC, 'tour');
check('__stripPass ships on both boards', !!stripV && !!stripT);
if (stripV) {
  check('the pass comes out of a link that carried a pool',
    stripV('?pool=tour-showroom&pass=abc123') === '?pool=tour-showroom',
    stripV('?pool=tour-showroom&pass=abc123'));
  check('a bare pass link strips to nothing at all',
    stripV('?pass=abc123') === '', JSON.stringify(stripV('?pass=abc123')));
  check('it keeps every other parameter, in order',
    stripV('?pool=vuelta-showroom&pass=x&rr=1') === '?pool=vuelta-showroom&rr=1',
    stripV('?pool=vuelta-showroom&pass=x&rr=1'));
  check('a query with no pass is left alone',
    stripV('?pool=tour-showroom') === '?pool=tour-showroom');
  check('an empty query stays empty', stripV('') === '' && stripV(undefined) === '');
  check('it removes EVERY copy of the parameter',
    stripV('?pass=a&pass=b&pool=p') === '?pool=p', stripV('?pass=a&pass=b&pool=p'));
  check('both boards strip identically',
    stripT('?pool=tour-showroom&pass=abc123') === stripV('?pool=tour-showroom&pass=abc123'));
}
/* THE PASS IS TRIED BEFORE THE COOKIE. A guest on a fresh device has no cookie, so the
   token boot would fail first and flash the login card at somebody who was sent a link
   and has no code to type. */
check('the boot tries the pass before the cookie',
  /if\(GUEST_PASS\)\{ __guestPassBoot\(\); return; \}[\s\S]{0,80}auth\/token/.test(SRC),
  'or a guest sees the login card first');
check('the pass is stripped once the session exists',
  /signInWithCustomToken\(d\.firebaseToken\)\.then\(function\(\)\{\s*__clearPass\(\);/.test(SRC),
  'the cookie is set by then, so the link has done its whole job');
check('it is replaceState, never pushState',
  /history\.replaceState\(null,'',location\.pathname\+__stripPass/.test(SRC) &&
  !/pushState[\s\S]{0,40}__stripPass/.test(SRC),
  'Back must not walk into a spent link');
check('a refused link says ONE thing',
  (SRC.match(/That preview link is no longer valid/g) || []).length === 1,
  'the server makes missing, revoked and expired indistinguishable on purpose');
/* COMMENTS ARE STRIPPED BEFORE THIS ASKS. The boot's own comment explains why the three
   refusals are indistinguishable, so a naive scan finds the words `revoked` and
   `expired` in the very prose that exists to justify not showing them. A gate that reads
   its own explanation is the mistake tools-rules-guard.js already records. */
check('and it never says which of the three it was',
  !/revoked|expired/i.test(
    (/__guestPassBoot[\s\S]{0,2600}?\n\}/.exec(SRC) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, ' ')),
  'one message, whichever it was');

console.log('\nTHE ACTIVITY PING');
const ping = (/PING_EVERY_MS[\s\S]{0,2600}?\}, PING_EVERY_MS\);/.exec(SRC) || [''])[0];
check('the ping ships', ping.length > 0);
check('it pings once a minute', /PING_EVERY_MS=60\*1000/.test(ping));
check('a PLAYER board never pings', /if\(!isGuest\) return;/.test(ping),
  'the four players are not tracked');
check('a hidden tab never pings', /visibilityState!=='visible'\) return;/.test(ping));
check('an idle tab stops pinging', /Date\.now\(\)-lastAct>IDLE_AFTER_MS\) return;/.test(ping) &&
  /IDLE_AFTER_MS=2\*60\*1000/.test(ping), 'two minutes, so a tab on a second monitor stops counting');
check('it sends a board and a tab and NOTHING else',
  /body:JSON\.stringify\(\{board:poolId\|\|'',tab:tabInView\(\)\}\)/.test(ping),
  'identity is the cookie\'s job, and only the cookie\'s');
check('it never sends an email, a pass or a visit id',
  !/email|passId|visitId/.test(ping), 'a body that named one could write against anybody');
check('every failure is swallowed', /\.catch\(function\(\)\{\}\)/.test(ping),
  'a missing minute in a report must not be visible to the person reported on');
check('the ping is on the Tour board too',
  /PING_EVERY_MS=60\*1000/.test(TOUR_SRC) && /if\(!isGuest\) return;/.test(TOUR_SRC),
  'a defect fixed on one board and not the other is how RACE_OVER hid for two months');

console.log('\nTHE INVITE SNIPPET');
/* A dotted field path cannot carry an email, and escaping the dots does NOT save it:
   the JavaScript parser resolves '.' before Firestore sees the string, so the
   write lands as a NESTED map, viewers -> a@b -> com, and the invitation silently does
   not work because the rule looks for a key and finds a sub-map. Caught by reading the
   tool's own output rather than by a test; guarded here so it cannot come back. */
/* Comments stripped first. The tool EXPLAINS the dotted-path bug in its own header,
   so a gate reading the raw file finds the very string it is forbidding and fails on
   a correct file. Same mistake as matching "pool.members is GONE" one section up. */
/* showroom-invite.js was SPLIT into guest-add.js and guest-remove.js, the two names the
   brief and the runbook use. Both are checked, because a revocation that silently does
   nothing is worse than one that errors. */
const ADD_RAW = fs.readFileSync(path.join(REPO, 'tools', 'guest-add.js'), 'utf8');
const RM_RAW = fs.readFileSync(path.join(REPO, 'tools', 'guest-remove.js'), 'utf8');
const ADD = ADD_RAW.replace(/\/\*[\s\S]*?\*\//g, ' ');
const RM = RM_RAW.replace(/\/\*[\s\S]*?\*\//g, ' ');
check('the invite writes viewers through FieldPath',
  /new FP\("viewers", EMAIL\)/.test(ADD),
  'segments unparsed, the idiom the board already uses');
check('it never emits a dotted viewers path', !/["']viewers\./.test(ADD),
  'that would write viewers -> a@b -> com');
check('revocation is a key removal', /FV\.delete\(\)/.test(RM));
check('an invitation must carry an expiry', /an expiry date is required/.test(ADD_RAW));
check('a past expiry is refused', /is in the past/.test(ADD_RAW));
/* THE REFUSAL THE BRIEF ASKED FOR. A guest who is also a member holds the member grant
   too, and that is a draft WRITE. The check has to run in the owner's session because
   only an owner can read every members map, so it lives inside the emitted snippet. */
check('the invite refuses an address already in some pool members map',
  /already a MEMBER of/.test(ADD) && /db\.collection\("pools"\)\.get\(\)/.test(ADD),
  'read live, in the owner session, before anything is written');
check('the revoke refuses to touch a member too', /is a MEMBER of/.test(RM),
  'that is a player, and removing one is a different decision');
check('both snippets are dry run first',
  /const APPLY = false/.test(ADD) && /const APPLY = false/.test(RM),
  'the destructive direction is never what a forgotten flag gives you');
check('both snippets read back what they wrote',
  /the write did not land/.test(ADD) && /the write did not land/.test(RM),
  'a write that returned is not a write that landed');
check('the expiry is written as a real Date, not an ISO string',
  /UNTIL = new Date\(/.test(ADD),
  'firestore.rules requires `is timestamp` by name');
check('the owner cannot be invited as a guest of his own boards',
  /that is the owner address/.test(ADD_RAW));

/* ===================================================================================
   THE TOUR BOARD, which this gate did not look at until now.
   tour.html, index.html and tour-staging.html are all built from board.src.html, and
   POOL_PAGE sends tour-showroom to tour.html. So a guest opening the Tour showroom gets
   a DIFFERENT file with its own write sites: no jersey predictions, no Kassei, no pool
   subscription, but a snake draft, a Merica side game and a bump control that the
   Vuelta checks above say nothing about.
   Checking only the Vuelta and calling the feature verified is the exact shape of
   "a partial feed is not a feed".
   =================================================================================== */
console.log('\nTHE TOUR BOARD (board.src.html -> tour.html)');
const TOUR = fs.readFileSync(path.join(REPO, 'tour.html'), 'utf8');
check('CAN_PLAY exists on the Tour board', /function CAN_PLAY\(\)\{ return !!myCode \|\| isOwner; \}/.test(TOUR),
  'the same one predicate, not a second idea of who may play');
check('isGuest is derived from the viewers map',
  /isGuest=\(!isOwner && !myCode && !!\(\(pool\.viewers\|\|\{\}\)\[myEmail\]\)\)/.test(TOUR));
check('isGuest is reset when a session signs in', /\n  isGuest=false;/.test(TOUR),
  'so switching back from a showroom cannot carry the flag');
check('the snake draft pick is gated', /async function submitPick\(forCode,label\)\{ if\(!CAN_PLAY\(\)\) return;/.test(TOUR));
check('the judge bump is gated', /async function doBump\(\)\{ if\(!CAN_PLAY\(\)\) return;/.test(TOUR));
check('opening a missing draft is gated', /if\(!snap\.exists\)\{ if\(CAN_PLAY\(\)\)\{/.test(TOUR));
check('rewriting the pick order is gated', /JSON\.stringify\(ORDER\)\)\{ if\(CAN_PLAY\(\)\)\{/.test(TOUR));
check('the Merica pick is gated', /if\(!CAN_PLAY\(\) \|\| isOut\)\{ window\.__merOpen=r;/.test(TOUR),
  'and still opens the bio, which is the observer experience');
check('the userPools write is gated', /if\(CAN_PLAY\(\)\)\{ db\.doc\('userPools\/'\+myEmail\)/.test(TOUR));
check('the Tour live draft builds NO node for a guest',
  /if\(isGuest\)\{\s*if\(done && picks\.length\)\{ renderMini\(picks\); return; \}/.test(TOUR),
  'mount emptied and returned, not hidden');
check('the Tour guest branch sits ABOVE the draft-done POST',
  TOUR.indexOf('if(isGuest){') < TOUR.indexOf('__cdfDonePing'),
  'so a watcher never fires it');
check('the Tour board has the guest pill mount', /<div id="guestPill"><\/div>/.test(TOUR));
check('the Tour pill is built only for a viewer',
  /gp\.innerHTML = isGuest/.test(TOUR));
check('tour-showroom routes to the Tour board',
  /'tour-showroom':'\/tour\.html'/.test(TOUR) && /'vuelta-showroom':'\/vuelta\.html'/.test(TOUR),
  'POOL_PAGE, which poolHref and the reroute both call');
check('the Vuelta board routes the showrooms too',
  /'tour-showroom':'\/tour\.html'/.test(SRC) && /'vuelta-showroom':'\/vuelta\.html'/.test(SRC),
  'both files carry the map; a guest can land on either');
/* index.html and tour.html must stay byte-identical, which build_boards.py guarantees
   and nothing else checks once a hand edit is possible. */
check('index.html is still byte-identical to tour.html',
  fs.readFileSync(path.join(REPO, 'index.html'), 'utf8') === TOUR);
check('the showroom manifests exist',
  fs.existsSync(path.join(REPO, 'tour-showroom.webmanifest')) &&
  fs.existsSync(path.join(REPO, 'vuelta-showroom.webmanifest')));

/* The --emit snippet is JavaScript that nothing compiles until it is pasted into a
   console on the day. So it is PARSED HERE. A snippet that only fails when pasted is
   worse than no snippet, because it fails at the moment of least patience. */
console.log('\nTHE SHOWROOM COPY --emit SNIPPET');
const EMIT = execFileSync(process.execPath,
  [path.join(REPO, 'tools', 'showroom-copy.js'), '--emit'],
  { cwd: REPO, encoding: 'utf8' });
let emitParses = true, emitWhy = String(EMIT.split('\n').length) + ' lines';
try { new Function('db', EMIT); } catch (e) { emitParses = false; emitWhy = e.message; }
check('the emitted snippet parses', emitParses, emitWhy);
check('it is dry run first', /const APPLY = false/.test(EMIT),
  'the destructive direction is never what a forgotten flag gives you');
check('it refuses a production target before any work',
  /is a production pool/.test(EMIT) && EMIT.indexOf('is a production pool') < EMIT.indexOf('function scrub'),
  'checked first, not after the read');
check('the scrub is SPLICED, not a second copy',
  /function scrub\(value, report, path\)/.test(EMIT) && /function findEmails/.test(EMIT),
  'a second scrubber is one that drifts, and the drifted one misses a field');
check('it re-scans and refuses a surviving address',
  /an address survived the scrub/.test(EMIT));
check('it empties the members map', /pool\.members = \{\};/.test(EMIT));
check('it drops memberEmails', /delete pool\.memberEmails;/.test(EMIT));
check('it does not copy engagement', !/"engagement"/.test(EMIT.split('COPY_COLLECTIONS')[1] || '') &&
  /its document ids are addresses/.test(EMIT));
check('it reads back what it wrote', /the write did not land/.test(EMIT));

console.log('\nTHE SPONSOR BAND');
check('an empty sponsor list renders nothing at all',
  /if\(band\) band\.remove\(\);/.test(SRC),
  'not three tiles reading Available');
check('a sponsor still brings the band back', /CDF\.boardConfig\.sponsors/.test(SRC));

console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
