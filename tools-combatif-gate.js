/* The combatif gate.

   WHAT IT IS FOR. `combatif` on a scored stage doc names the day's official most
   combative rider, and it is what the Premio de la Combatividad is awarded from. On
   2026-09-01 three stages were found wrong at once: stage 7 and stage 10 had no value at
   all, and stage 9 carried stage 8's value. That third one is the shape this file exists
   to refuse. It was not a typo and it did not come from the race: it was pulled from a
   web search rather than from the official classification, and a web search for "Vuelta
   stage 9 most combative" returns the stage 8 story often enough to look like an answer.

   THE RULE, and both halves are load-bearing:

   1. `combatif` comes from the ICE BIND of rankingType-{year}-{stage} and from nowhere
      else. Not a web search, not a report, not a previous stage. If the bind cannot be
      read, the close STOPS. A missing value is recoverable; a wrong one is awarded.
   2. It must not equal the previous stage's value UNLESS the bind independently says so.
      A rider genuinely can be most combative twice running, so this is not a ban, it is a
      demand for evidence. What it refuses is the copy-forward, where the value matches
      the previous stage for no reason the feed supports.

   This is the same class as every other guard in this repo: the failure produced valid
   data that looked exactly like working software. Nothing threw, the card rendered, and
   the Premio tally would have been computed off it with full confidence.

   WHERE IT IS CALLED. tools/close-stage.js does not exist; every stage since 5 has been
   closed by hand from a signed-in browser console, and CLAUDE.md says so. So this gate is
   run by hand too, before the stage doc is written, and it is written as a pure function
   with no I/O precisely so it can be pasted into that console or required from a closer
   the day one gets built. `node tools-combatif-gate.js` runs the self-tests.

   Every refusal carries a SEPARATE named reason, because "it did not work" is what let
   three builds of the roster greyout ship. */

'use strict';

/* Fold to a comparable token: accents out, case out, punctuation out. The startlist
   writes "W. van Aert" and a feed writes "VAN AERT Wout", so a full-string equality test
   would refuse every correct value. Surname tokens are what actually compare. */
function tokens(name) {
  return String(name == null ? '' : name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(function (t) { return t.length > 1; });   // drops the "W." initial
}

/* Two names refer to the same rider when one's tokens are contained in the other's.
   Deliberately NOT a fuzzy score: this is a gate, and a near miss must fail. */
function sameRider(a, b) {
  var A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return false;
  var small = A.length <= B.length ? A : B, big = A.length <= B.length ? B : A;
  return small.every(function (t) { return big.indexOf(t) >= 0; });
}

/* Pulls the winner of the combativity classification out of the ice bind.
   Position is a PLACING and a non-positive position is a status code, never a placing.
   That is the same trap `ite` carries, where a rider who did not finish stays in the
   array at position -1 and sorts ahead of the winner if it is not filtered. */
function combatifFromBind(bind) {
  if (!bind || typeof bind !== 'object') return { ok: false, why: 'no-bind', msg: 'no ice bind was read' };
  var rows = bind.rankings;
  if (!Array.isArray(rows) || !rows.length)
    return { ok: false, why: 'no-bind', msg: 'the ice bind carries no rankings' };
  var real = rows.filter(function (r) { return r && Number(r.position) > 0; });
  if (!real.length)
    return { ok: false, why: 'no-winner', msg: 'the ice bind has no classified rider' };
  real.sort(function (a, b) { return Number(a.position) - Number(b.position); });
  var top = real[0];
  if (Number(top.position) !== 1)
    return { ok: false, why: 'no-winner', msg: 'the ice bind has no rider in first place' };
  var name = top.name || top.lastname || '';
  var bib = top.bib == null ? null : top.bib;

  /* THE ICE BIND IS BIB-ONLY BY CONTRACT, and this gate refused every real stage until
     2026-09-09 because it demanded a name the bind has never carried. Measured on the
     live feed for stages 13 to 17: one row, position 1, fields bib/absolute/relative/
     bonus/penality/position/$rider, and NO name of any kind. The second hop to
     rankingType-{year}-{stage}:{_id} returns the identical row, so this is the contract
     and not the truncation the summary document carries.

     A nameless row is therefore NOT a failure. It is the normal shape, and the bib is a
     STRONGER identity than a name would be: it is what scores everywhere else in this
     repo. Resolution happens in the gate, which is where the startlist is available.

     Refusing here is what made the gate fail CLOSED on every stage, which looks like
     caution and is actually the gate never running at all. */
  if (!String(name).trim()) {
    if (bib == null)
      return { ok: false, why: 'no-winner',
        msg: 'the top row of the ice bind carries neither a name nor a bib' };
    return { ok: true, name: null, bib: bib };
  }
  return { ok: true, name: String(name), bib: bib };
}

/* THE GATE.

   opts.stage        the stage being closed
   opts.bind         the ice bind of rankingType-{year}-{stage}, as fetched
   opts.bindStage    the stage the bind ANSWERED for, when the document reports one
   opts.proposed     the value about to be written, or null to let the gate supply it
   opts.prevCombatif the previous SCORED stage's combatif, or null if there is none
   opts.riders       the startlist, for the bib check; optional

   Returns { ok:true, value, bib } or { ok:false, why, msg }. */
function combatifGate(opts) {
  opts = opts || {};
  var stage = Number(opts.stage);

  /* The bind must answer for the stage that was asked for. This is the same audit the
     board runs on every feed request, and it is the check that catches a copy-forward at
     its source rather than at its symptom. */
  if (opts.bindStage != null && Number(opts.bindStage) !== stage)
    return { ok: false, why: 'wrong-stage',
      msg: 'the ice bind answered for stage ' + opts.bindStage + ', not stage ' + stage };

  var got = combatifFromBind(opts.bind);
  if (!got.ok) return got;

  /* Resolve the bind's rider to a NAME before anything is compared against it. On a
     bib-only bind that resolution needs the startlist, and without one the gate has no
     way to say who the bind named, which is a refusal and never a pass. */
  var bindName = got.name;
  if (bindName == null) {
    if (!(Array.isArray(opts.riders) && opts.riders.length))
      return { ok: false, why: 'bib-only-no-startlist',
        msg: 'the ice bind names only bib ' + got.bib + ' and no startlist was supplied to resolve it' };
    var brow = opts.riders.filter(function (r) { return r && String(r.b) === String(got.bib); })[0];
    if (!brow)
      return { ok: false, why: 'unknown-bib',
        msg: 'the ice bind names bib ' + got.bib + ', which is not on the startlist' };
    bindName = brow.r;
  }

  /* No proposed value: the gate supplies the bind's answer, which is the only source it
     is ever allowed to come from. */
  var proposed = opts.proposed == null ? null : String(opts.proposed).trim();
  if (proposed === '') proposed = null;

  if (proposed !== null && !sameRider(proposed, bindName)) {
    /* Name the failure that actually happened. A proposed value that matches the previous
       stage and NOT the bind is the copy-forward, and calling it "not from the bind" would
       be true but would not tell the operator what they are looking at. */
    if (opts.prevCombatif != null && sameRider(proposed, opts.prevCombatif))
      return { ok: false, why: 'copy-forward',
        msg: 'the proposed combatif "' + proposed + '" is the previous stage\'s value and the '
           + 'ice bind for stage ' + stage + ' names "' + bindName + '" instead' };
    return { ok: false, why: 'not-from-bind',
      msg: 'the proposed combatif "' + proposed + '" is not what the ice bind for stage '
         + stage + ' names, which is "' + bindName + '"' };
  }

  /* The bib check, when a startlist is supplied. A name attached to the wrong bib does not
     error and does not look wrong, which is why this repo audits by bib rather than by
     name everywhere it can. */
  var bib = got.bib;
  if (bib != null && Array.isArray(opts.riders) && opts.riders.length) {
    var row = opts.riders.filter(function (r) { return r && String(r.b) === String(bib); })[0];
    if (!row)
      return { ok: false, why: 'unknown-bib',
        msg: 'the ice bind names bib ' + bib + ', which is not on the startlist' };
    if (!sameRider(row.r, bindName))
      return { ok: false, why: 'bib-name-mismatch',
        msg: 'the ice bind names "' + bindName + '" at bib ' + bib + ', which the startlist '
           + 'holds as "' + row.r + '"' };
    return { ok: true, value: row.r, bib: bib };
  }

  return { ok: true, value: proposed !== null ? proposed : bindName, bib: bib };
}

module.exports = { combatifGate: combatifGate, combatifFromBind: combatifFromBind, sameRider: sameRider };

/* ---------------- self-tests ---------------- */
if (require.main === module) {
  var fails = 0, ran = 0;
  function check(label, cond) {
    ran++;
    if (!cond) { fails++; console.log('FAIL  ' + label); }
    else console.log('ok    ' + label);
  }
  function bind(stage, rows) { return { rankings: rows }; }
  function row(pos, name, bib) { return { position: pos, name: name, bib: bib }; }

  /* The three live corrections of 2026-09-01. The names are the audit's, the shape is
     the feed's; these fixtures test the GATE, not the contents of any stage. */

  // Stage 7: no value stored, the bind names van Aert. The gate supplies it.
  var s7 = combatifGate({ stage: 7, bind: bind(7, [row(1, 'W. van Aert', 31), row(2, 'Someone Else', 99)]), bindStage: 7, proposed: null });
  check('stage 7 with no stored value takes the bind winner', s7.ok && s7.value === 'W. van Aert');

  // Stage 9: the stored value is stage 8's. The bind names Sivakov. THIS is the case.
  var s9 = combatifGate({ stage: 9, bind: bind(9, [row(1, 'P. Sivakov', 12)]), bindStage: 9,
    proposed: 'S. Fernandez', prevCombatif: 'S. Fernandez' });
  check('stage 9 copy-forward is refused', !s9.ok && s9.why === 'copy-forward');
  check('stage 9 refusal names the bind winner', /Sivakov/.test(s9.msg));

  // Stage 10: no value stored, the bind names Gogl.
  var s10 = combatifGate({ stage: 10, bind: bind(10, [row(1, 'M. Gogl', 141)]), bindStage: 10, proposed: null });
  check('stage 10 with no stored value takes the bind winner', s10.ok && s10.value === 'M. Gogl');

  /* A repeat IS allowed when the bind supports it. The rule demands evidence, it does not
     ban a rider from being most combative on consecutive days. */
  var rep = combatifGate({ stage: 9, bind: bind(9, [row(1, 'S. Fernandez', 55)]), bindStage: 9,
    proposed: 'S. Fernandez', prevCombatif: 'S. Fernandez' });
  check('a repeat the bind actually names is allowed', rep.ok && rep.value === 'S. Fernandez');

  /* A wrong value that is NOT the previous stage's is a different, separately named
     failure, so the message tells the operator which one they are looking at. */
  var wrong = combatifGate({ stage: 9, bind: bind(9, [row(1, 'P. Sivakov', 12)]), bindStage: 9,
    proposed: 'W. van Aert', prevCombatif: 'S. Fernandez' });
  check('a wrong value that is not the previous stage is not-from-bind', !wrong.ok && wrong.why === 'not-from-bind');

  /* The bind answering for another stage is refused before its contents are believed.
     A feed answering for a real stage is valid data about the wrong day. */
  var ws = combatifGate({ stage: 9, bind: bind(8, [row(1, 'S. Fernandez', 55)]), bindStage: 8, proposed: null });
  check('a bind answering for another stage is refused', !ws.ok && ws.why === 'wrong-stage');

  /* NO BIND MEANS STOP. It never falls back to the previous stage, which is the whole
     mechanism of the failure this gate closes. */
  var nb = combatifGate({ stage: 11, bind: null, proposed: null, prevCombatif: 'M. Gogl' });
  check('a missing bind stops rather than carrying the previous value', !nb.ok && nb.why === 'no-bind');
  var eb = combatifGate({ stage: 11, bind: bind(11, []), bindStage: 11, proposed: null, prevCombatif: 'M. Gogl' });
  check('an empty bind stops too', !eb.ok && eb.why === 'no-bind');

  /* A non-positive position is a status code and never a placing, the same trap `ite`
     carries where an unfiltered -1 sorts ahead of the winner. */
  var neg = combatifGate({ stage: 12, bind: bind(12, [row(-1, 'Did Not Finish', 7), row(1, 'A. Rider', 8)]), bindStage: 12, proposed: null });
  check('a negative position never wins the classification', neg.ok && neg.value === 'A. Rider');
  var allneg = combatifGate({ stage: 12, bind: bind(12, [row(-1, 'Did Not Finish', 7)]), bindStage: 12, proposed: null });
  check('a bind of nothing but status codes has no winner', !allneg.ok && allneg.why === 'no-winner');

  /* Name folding, so a correct value is never refused for spelling the same rider the way
     the board spells him rather than the way the feed does. */
  check('surname folding matches across formats', require('./tools-combatif-gate').sameRider('W. van Aert', 'VAN AERT Wout'));
  check('folding does not match two different riders', !require('./tools-combatif-gate').sameRider('P. Sivakov', 'S. Fernandez'));

  /* The bib check. A name on the wrong bib is silent and total everywhere else in this
     repo, so the gate resolves through the startlist when it is given one. */
  var RIDERS = [{ b: 31, r: 'W. van Aert' }, { b: 12, r: 'P. Sivakov' }];
  var okbib = combatifGate({ stage: 7, bind: bind(7, [row(1, 'VAN AERT Wout', 31)]), bindStage: 7, proposed: null, riders: RIDERS });
  check('the startlist spelling wins when the bib resolves', okbib.ok && okbib.value === 'W. van Aert');
  var badbib = combatifGate({ stage: 7, bind: bind(7, [row(1, 'VAN AERT Wout', 12)]), bindStage: 7, proposed: null, riders: RIDERS });
  check('a name on the wrong bib is refused', !badbib.ok && badbib.why === 'bib-name-mismatch');
  var nobib = combatifGate({ stage: 7, bind: bind(7, [row(1, 'VAN AERT Wout', 999)]), bindStage: 7, proposed: null, riders: RIDERS });
  check('a bib that is not on the startlist is refused', !nobib.ok && nobib.why === 'unknown-bib');
  /* ---- THE LIVE BIB-ONLY SHAPE, measured 2026-09-09 on stages 13 to 17 ----
     The ice bind carries ONE row with a bib and NO name of any kind, and the second hop
     returns the identical row, so this is the contract and not a truncation. Until this
     was fixed the gate refused every real stage with 'no-winner', which is a guard that
     fails CLOSED and therefore never runs: close-stage.js was resolving the bib itself
     and the gate was never in the path. Identity resolves through the BIB, which is the
     stronger check and the one the rest of this repo scores by. */
  var RID = [{ b: 96, r: 'E. Paleni' }, { b: 17, r: 'K. Vermaerke' }, { b: 136, r: 'A. Leknessund' }];
  function bibrow(pos, bib) { return { position: pos, bib: bib, absolute: 0, relative: 0, bonus: 0, penality: 0 }; }

  var bo = combatifGate({ stage: 17, bind: bind(17, [bibrow(1, 96)]), bindStage: 17, proposed: null, riders: RID });
  check('a bib-only bind resolves through the startlist', bo.ok && bo.value === 'E. Paleni' && bo.bib === 96);

  var bons = combatifGate({ stage: 17, bind: bind(17, [bibrow(1, 96)]), bindStage: 17, proposed: null });
  check('a bib-only bind with no startlist refuses rather than passing', !bons.ok && bons.why === 'bib-only-no-startlist');

  var bunk = combatifGate({ stage: 17, bind: bind(17, [bibrow(1, 999)]), bindStage: 17, proposed: null, riders: RID });
  check('a bib-only bind on an unknown bib is refused', !bunk.ok && bunk.why === 'unknown-bib');

  /* The copy-forward refusal must still fire when the bind is bib-only. This is the
     failure the whole file exists for and it must not be lost to the new path. */
  var bcf = combatifGate({ stage: 17, bind: bind(17, [bibrow(1, 96)]), bindStage: 17,
    proposed: 'K. Vermaerke', prevCombatif: 'K. Vermaerke', riders: RID });
  check('a bib-only bind still refuses a copy-forward', !bcf.ok && bcf.why === 'copy-forward');
  check('the bib-only copy-forward names the bind winner', /Paleni/.test(bcf.msg));

  /* Stage 16 is a genuine repeat of stage 14, two stages apart, and the bind says so.
     The rule compares against the PREVIOUS stage only, which was Leknessund. */
  var s16 = combatifGate({ stage: 16, bind: bind(16, [bibrow(1, 17)]), bindStage: 16,
    proposed: null, prevCombatif: 'A. Leknessund', riders: RID });
  check('stage 16 bib 17 resolves to Vermaerke against a Leknessund previous', s16.ok && s16.value === 'K. Vermaerke');

  var nb = combatifGate({ stage: 17, bind: bind(17, [{ position: 1, absolute: 0 }]), bindStage: 17, riders: RID });
  check('a row with neither name nor bib is still no-winner', !nb.ok && nb.why === 'no-winner');

  var neg = combatifGate({ stage: 17, bind: bind(17, [bibrow(-1, 17), bibrow(1, 96)]), bindStage: 17, proposed: null, riders: RID });
  check('a negative position never wins a bib-only bind', neg.ok && neg.value === 'E. Paleni');


  console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
  process.exit(fails ? 1 : 0);
}
