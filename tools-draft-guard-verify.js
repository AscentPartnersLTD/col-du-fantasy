/* Runs the SHIPPED pending-draft reset guard and write-storm monitor out of the built
   vuelta.html. Not a transcription: the code under test is lifted verbatim from the file
   that gets deployed, the same way tools-roster-verify.js does it.

   WHAT THIS IS FOR. On 2026-09-01 the pending-draft reset in subscribe() turned into a
   two-session write fight and ran at about 750 writes a minute for hours on
   pools/vuelta-2026/drafts/11. Nothing logged, because the failure path was `catch(e){}`
   and the success path was silent, so the only symptom was a badge moving on a phone.

   The CAUSE is fixed by the pool listener, which keeps ORDER current so two sessions stop
   disagreeing. These two pieces are the BACKSTOP and the ALARM, and a backstop nobody
   exercises is a comment. So they are tested here, without a browser.

   Run: node tools-draft-guard-verify.js */

'use strict';
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/vuelta.html', 'utf8');

// ---- the block under test, lifted verbatim ----
const START = 'const DRAFT_RESET_MAX';
const END = "console.info('[CDF] draft write storm cleared on '+draftRef().path);";
const i = SRC.indexOf(START);
const j = SRC.indexOf(END, i);
if (i < 0 || j < 0) throw new Error('draft guard block not found in vuelta.html');
const BLOCK = SRC.slice(i, SRC.indexOf('}', j) + 1) + '\n}';

// ---- the environment the block expects ----
let ORDER = ['JB', 'AA', 'JJ', 'JP'];
let STAGE = '11';
const draftRef = () => ({ path: 'pools/vuelta-2026/drafts/' + STAGE });
const warns = [], infos = [];
const console2 = { warn: m => warns.push(String(m)), info: m => infos.push(String(m)), log: () => {} };
const window = {};

const api = new Function('ORDER', 'STAGE', 'draftRef', 'console', 'window',
  BLOCK + '\n; return {mayResetDraft, noteResetAttempt, noteSnapshot, _resetGuard, DRAFT_RESET_MAX, DRAFT_RESET_COOLDOWN_MS, STORM_SNAPSHOTS};'
)(ORDER, STAGE, draftRef, console2, window);

// ---- harness ----
let ran = 0, fails = 0;
function check(label, cond) {
  ran++;
  if (!cond) { fails++; console.log('FAIL  ' + label); } else console.log('ok    ' + label);
}
function resetAll() {
  api._resetGuard.stage = null; api._resetGuard.count = 0; api._resetGuard.last = 0;
  window.__draftDiag.snaps = []; window.__draftDiag.storm = false;
  window.__draftDiag.resets = 0; window.__draftDiag.refusedResets = 0;
  warns.length = 0; infos.length = 0;
}

/* ---- the budget ---- */
resetAll();
let allowed = 0;
for (let n = 0; n < 10; n++) {
  if (api.mayResetDraft()) { allowed++; api.noteResetAttempt(); api._resetGuard.last = 0; } // ignore cooldown here
}
check('the reset budget is capped at DRAFT_RESET_MAX per stage', allowed === api.DRAFT_RESET_MAX);
check('DRAFT_RESET_MAX is small enough to be a backstop, not a policy', api.DRAFT_RESET_MAX <= 5);

/* THE ONE THAT MATTERS. Under the old code every snapshot wrote, so a fight ran forever.
   A thousand attempts must now cost a handful of writes. */
resetAll();
let writes = 0;
for (let n = 0; n < 1000; n++) { if (api.mayResetDraft()) { writes++; api.noteResetAttempt(); api._resetGuard.last = 0; } }
check('1000 disagreeing snapshots cost at most DRAFT_RESET_MAX writes', writes === api.DRAFT_RESET_MAX);

/* ---- the cooldown ---- */
resetAll();
check('the first attempt is allowed', api.mayResetDraft() === true);
api.noteResetAttempt();
check('a second attempt inside the cooldown is refused', api.mayResetDraft() === false);
api._resetGuard.last = Date.now() - api.DRAFT_RESET_COOLDOWN_MS - 1;
check('the same attempt is allowed once the cooldown has passed', api.mayResetDraft() === true);
check('the cooldown is long enough to outlast a round trip', api.DRAFT_RESET_COOLDOWN_MS >= 1000);

/* ---- a NEW stage gets a fresh budget ---- */
resetAll();
while (api.mayResetDraft()) { api.noteResetAttempt(); api._resetGuard.last = 0; }
check('the budget is spent', api.mayResetDraft() === false);
api._resetGuard.stage = '12';   // the guard keys on STAGE; simulate the stage moving on
api._resetGuard.count = 0; api._resetGuard.last = 0;
check('a different stage starts with a fresh budget', api.mayResetDraft() === true);

/* ---- the storm monitor ---- */
resetAll();
for (let n = 0; n < api.STORM_SNAPSHOTS - 1; n++) api.noteSnapshot({ order: ['JJ', 'JP', 'JB', 'AA'] });
check('below the threshold nothing is reported', window.__draftDiag.storm === false && warns.length === 0);
api.noteSnapshot({ order: ['JJ', 'JP', 'JB', 'AA'] });
check('at the threshold a storm is declared', window.__draftDiag.storm === true);
check('the storm warns exactly once, not once per snapshot', warns.length === 1);
for (let n = 0; n < 50; n++) api.noteSnapshot({ order: ['JJ', 'JP', 'JB', 'AA'] });
check('50 more snapshots do not add 50 more warnings', warns.length === 1);

/* The warning has to be USEFUL. "Something is wrong" is what a moving pill already said;
   the point of the alarm is that it names both orders and the document. */
const w = warns[0] || '';
check('the warning names the document', /drafts\/11/.test(w));
check('the warning names this board order', /JB,AA,JJ,JP/.test(w));
check('the warning names the competing order', /JJ,JP,JB,AA/.test(w));
check('the warning says what to do about it', /reload|close/i.test(w));

/* ---- it clears ---- */
resetAll();
for (let n = 0; n < api.STORM_SNAPSHOTS; n++) api.noteSnapshot({ order: ['JJ', 'JP', 'JB', 'AA'] });
check('storm set', window.__draftDiag.storm === true);
window.__draftDiag.snaps = [];                     // the window has rolled past
api.noteSnapshot({ order: ORDER });
check('a quiet window clears the storm', window.__draftDiag.storm === false);
check('clearing is announced', infos.some(m => /storm cleared/.test(m)));

/* A normal draft never trips it: eight picks, one snapshot each, spread over minutes. */
resetAll();
let now = 0;
const realNow = Date.now;
Date.now = () => now;
for (let n = 0; n < 8; n++) { now += 30000; api.noteSnapshot({ order: ORDER }); }
Date.now = realNow;
check('a real eight-pick draft never trips the monitor', window.__draftDiag.storm === false && warns.length === 0);

console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
if (fails) process.exit(1);
