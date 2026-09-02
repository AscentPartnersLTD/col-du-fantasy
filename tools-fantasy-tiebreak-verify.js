/* THE FANTASY POINTS TIEBREAK, under test.

   WHY THIS FILE EXISTS. On 2026-09-02 stage 11 left AA and JJ level on 438 Fantasy
   Points, the system of record. The order was computed as
   `Object.keys(OURS.fantasy).sort((a,b)=>fantasy[b]-fantasy[a])`, and on a tie a stable
   sort falls back to key insertion order. Those keys are seeded from PL4, which is
   CDF.order, which is pool.order, which is THE DRAFT ROTATION. So the leader of a tie was
   whichever tied seat happened to draft earlier that day, and the rotation moves every
   single stage. Two seats level on the system of record could swap the lead with nobody
   scoring a point.

   That is not only a display fault. The persona engine keys off this same order, and
   `orderChanged` re-draws ALL FOUR personas whenever it fires. The winner tier has three
   unworn names left with ten stages to go, so a tie flip-flopping on the rotation would
   have burned the bank for no reason anyone could see.

   Allen's rule, 2026-09-02, in order: Arlequin (most distinct teams, counting all stages
   including void ones), then Rank lowest, then Placement lowest, then genuinely shared
   with the board SAYING so. A seat drafting from more teams is reading more of the field.

   Like tools-roster-verify.js and tools-draft-guard-verify.js, this lifts the shipped
   block VERBATIM out of the BUILT vuelta.html and runs it. It is the shipped code under
   test, not a transcription of it. Run: node tools-fantasy-tiebreak-verify.js */

'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'vuelta.html'), 'utf8');
const START = 'const FAN_STANDING = (function(){';
const END = '  arlequin:Object.assign({},ARLEQUIN_TEAMS), note:FAN_TIEBREAK_NOTE };';
const i = SRC.indexOf(START), j = SRC.indexOf(END);
if (i < 0 || j < 0) { console.error('could not lift the block out of vuelta.html'); process.exit(1); }
const BLOCK = SRC.slice(i, j + END.length);

/* The lifted block closes over OURS, ARLEQUIN_TEAMS and PL4, and assigns
   window.__fanTiebreak. Those are the only things it needs, so they are the only things
   supplied. */
function run(PL4, fantasy, arlequin, rank, placement) {
  const OURS = { fantasy: fantasy, rank: rank, placement: placement };
  const ARLEQUIN_TEAMS = arlequin;
  const window = {};
  /* The lifted region also carries the placeLeader/rankLeader line, which is not what is
     under test here but has to resolve for the block to run. Both are ascending, which is
     correct for Placement and Rank. */
  const asc = o => Object.keys(o).sort((a, b) => (o[a] || 0) - (o[b] || 0));
  const placeOrder = asc(placement), rankOrder = asc(rank);
  const fn = new Function('PL4', 'OURS', 'ARLEQUIN_TEAMS', 'window', 'placeOrder', 'rankOrder',
    BLOCK + '\n; return { FAN_STANDING: FAN_STANDING, fanOrder: fanOrder, fanLeader: fanLeader, note: FAN_TIEBREAK_NOTE };');
  return fn(PL4.slice(), OURS, ARLEQUIN_TEAMS, window, placeOrder, rankOrder);
}

let ran = 0, bad = 0;
function ck(label, cond) { ran++; if (!cond) { bad++; console.log('FAIL  ' + label); } else console.log('ok    ' + label); }

/* ---- the live stage 11 state, which is what prompted the rule ---- */
const SEATS = ['AA', 'JB', 'JJ', 'JP'];
const FAN  = { AA: 438, JB: 351, JJ: 438, JP: 384 };
const ARL  = { AA: 11,  JB: 10,  JJ: 16,  JP: 8   };
const RANK = { AA: 84,  JB: 93,  JJ: 88,  JP: 95  };
const PLC  = { AA: 956, JB: 980, JJ: 548, JP: 878 };

console.log('== the live tie, stage 11 ==');
const live = run(['AA', 'JJ', 'JP', 'JB'], FAN, ARL, RANK, PLC);
ck('AA and JJ are level on 438, the system of record', FAN.AA === FAN.JJ);
ck('the leader is JJ, not AA', live.fanLeader === 'JJ');
ck('the tie was broken by the Arlequin', live.FAN_STANDING.brokenBy === 'Arlequin');
ck('the note names the board that broke it', /Arlequin breaks the tie/.test(live.note));
ck('the note carries the margin, 16 teams to 11', /16 teams to 11/.test(live.note));
ck('full order is JJ, AA, JP, JB', live.fanOrder.join() === 'JJ,AA,JP,JB');

/* ---- INSERTION ORDER MUST NEVER DECIDE A LEADER ----
   This is the actual defect. Every permutation of pool.order must give the same leader. */
console.log('\n== insertion order decides nothing ==');
function perms(a) {
  if (a.length <= 1) return [a];
  const o = [];
  a.forEach(function (x, k) {
    perms(a.slice(0, k).concat(a.slice(k + 1))).forEach(function (r) { o.push([x].concat(r)); });
  });
  return o;
}
const all = perms(SEATS);
const leaders = new Set(), orders = new Set();
all.forEach(function (p) {
  const r = run(p, FAN, ARL, RANK, PLC);
  leaders.add(r.fanLeader); orders.add(r.fanOrder.join());
});
ck('all 24 rotations of pool.order give ONE leader', leaders.size === 1);
ck('and that leader is JJ', [...leaders][0] === 'JJ');
ck('all 24 rotations give the identical full order', orders.size === 1);

/* Demonstrate the OLD behavior on the same numbers, so the regression is recorded rather
   than asserted. This is the code that shipped until 2026-09-02. */
const oldLeaders = new Set();
all.forEach(function (p) {
  const f = {};
  p.forEach(function (s) { f[s] = FAN[s]; });
  oldLeaders.add(Object.keys(f).sort(function (a, b) { return f[b] - f[a]; })[0]);
});
ck('the OLD insertion-order sort gave more than one leader on this same tie', oldLeaders.size > 1);
console.log('      old leaders across rotations: ' + [...oldLeaders].sort().join(', '));

/* ---- the chain, step by step ---- */
console.log('\n== the tiebreak chain ==');
/* These fixtures use two seats, A and B, so PL4 is those two. Passing the four real seat
   codes here would sort seats that carry no fixture data. */
const AB = ['A', 'B'];
const s1 = run(AB, { A: 10, B: 10 }, { A: 5, B: 3 }, { A: 50, B: 40 }, { A: 100, B: 90 });
ck('step 1, Arlequin decides on most teams', s1.fanLeader === 'A' && s1.FAN_STANDING.brokenBy === 'Arlequin');
const s2 = run(AB, { A: 10, B: 10 }, { A: 4, B: 4 }, { A: 40, B: 50 }, { A: 100, B: 90 });
ck('step 2, level Arlequin falls to Rank, lowest leads', s2.fanLeader === 'A' && s2.FAN_STANDING.brokenBy === 'Rank');
const s3 = run(AB, { A: 10, B: 10 }, { A: 4, B: 4 }, { A: 40, B: 40 }, { A: 90, B: 100 });
ck('step 3, level Rank falls to Placement, lowest leads', s3.fanLeader === 'A' && s3.FAN_STANDING.brokenBy === 'Placement');
const s4 = run(AB, { A: 10, B: 10 }, { A: 4, B: 4 }, { A: 40, B: 40 }, { A: 90, B: 90 });
ck('step 4, everything level is genuinely SHARED', s4.FAN_STANDING.brokenBy === 'shared');
ck('       and the board says so rather than picking one', /Lead shared on Fantasy Points by A and B/.test(s4.note));
ck('       a shared lead lists every tied seat', s4.FAN_STANDING.shared.join() === 'A,B');
/* A shared lead must still be order-stable, or the personas churn on it. */
const s4b = run(['B', 'A'], { A: 10, B: 10 }, { A: 4, B: 4 }, { A: 40, B: 40 }, { A: 90, B: 90 });
ck('       and a shared lead is still identical under a rotation', s4b.fanOrder.join() === s4.fanOrder.join());

/* Rank and Placement are LOWEST-leads. Getting either direction backwards is the silent
   failure CLAUDE.md records under Per-race scoring profiles, so both are pinned. */
const dirR = run(AB, { A: 10, B: 10 }, { A: 4, B: 4 }, { A: 99, B: 1 }, { A: 100, B: 100 });
ck('Rank direction: the LOWER Rank total leads', dirR.fanLeader === 'B');
const dirP = run(AB, { A: 10, B: 10 }, { A: 4, B: 4 }, { A: 40, B: 40 }, { A: 999, B: 1 });
ck('Placement direction: the LOWER Placement total leads', dirP.fanLeader === 'B');

/* ---- no tie at all ---- */
console.log('\n== no tie ==');
const nt = run(SEATS, { AA: 400, JB: 300, JJ: 350, JP: 320 }, ARL, RANK, PLC);
ck('a clear leader reports no tiebreak', nt.FAN_STANDING.brokenBy === null);
ck('and the note is empty, so no render site needs a guard', nt.note === '');

/* ---- THE PERSONA CONSEQUENCE, which is the expensive half ----
   orderChanged is `prevOrder.some((p,i)=>...)` against the stored ledger order. With the
   tie intact, a rotation must produce the IDENTICAL array and therefore no movement. */
console.log('\n== the persona engine sees no movement while the tie holds ==');
function orderChanged(prev, cur) {
  return prev.length !== cur.length || cur.some(function (p, i) { return prev[i] !== p; });
}
const base = run(['AA', 'JJ', 'JP', 'JB'], FAN, ARL, RANK, PLC).fanOrder;
let churn = 0;
all.forEach(function (p) { if (orderChanged(base, run(p, FAN, ARL, RANK, PLC).fanOrder)) churn++; });
ck('zero re-draws across all 24 rotations with the tie intact', churn === 0);
console.log('      (each re-draw would burn one of only 3 unworn winner-tier personas)');

/* The rotation that actually happens tonight: stage 11 order to stage 12 order. */
const before = run(['JB', 'AA', 'JJ', 'JP'], FAN, ARL, RANK, PLC).fanOrder;
const after  = run(['AA', 'JJ', 'JP', 'JB'], FAN, ARL, RANK, PLC).fanOrder;
ck('the stage 11 to stage 12 rotation moves nothing', !orderChanged(before, after));
ck('and the stored ledger order JJ,AA,JP,JB still matches, so no re-draw at all',
   !orderChanged(['JJ', 'AA', 'JP', 'JB'], after));

/* A real change must still be detected, or the guard has been disabled rather than fixed. */
const moved = run(SEATS, { AA: 438, JB: 351, JJ: 400, JP: 384 }, ARL, RANK, PLC).fanOrder;
ck('a genuine change on Fantasy Points IS still detected', orderChanged(base, moved));

console.log('\n' + (ran - bad) + '/' + ran + ' checks passed');
process.exit(bad ? 1 : 0);
