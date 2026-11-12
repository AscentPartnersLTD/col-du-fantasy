#!/usr/bin/env node
/* tools-reads-verify.js - the generated reads, against every shape a stage can take.
 *
 *   node tools-reads-verify.js
 *   node tools-reads-verify.js --repo <path to coldufantasy-login>
 *
 * The reads are DRAFTED, not authored. That is the whole risk: a sentence assembled from
 * the same numbers the table already shows can read like a judgement while carrying none.
 * The guard against that is not taste, it is rules that can be checked, so this asserts
 * the ones that matter and prints the output for a human to read.
 *
 * The cases below are the real shapes this race has produced: a stage winner, a card
 * carried by one pick, a card that scored nothing, an abandon, a missed pick, a tie on
 * the day, a one point card, and a void stage.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_API_REPO = path.resolve(__dirname, '..', 'coldufantasy-login');
function apiRepo() {
  const i = process.argv.indexOf('--repo');
  return i >= 0 ? process.argv[i + 1] : DEFAULT_API_REPO;
}

let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(54) +
    (detail == null ? '' : String(detail)));
}

function card(seat, picks, fantasy, placement, rank) {
  return { seat, name: seat, picks, fantasy, placement, rank };
}
const P = (r, f, extra) => Object.assign({ r, f }, extra || {});

async function main() {
  const repo = apiRepo();
  const p = path.join(repo, 'lib', 'reads.js');
  if (!fs.existsSync(p)) {
    console.log('[SKIP] the coldufantasy-login clone is not at ' + repo);
    console.log('       Nothing was checked. This is NOT a pass.');
    process.exit(0);
  }
  const { draftReads } = await import('file:///' + p.replace(/\\/g, '/'));

  function gen(cards, stageDoc) {
    return draftReads({ cards, stageDoc: stageDoc || { type: 'Flat', win: 'X', voidStage: false } },
      { scaleTop: 30 });
  }

  /* ---- the real stage 17, which is the everyday shape ---- */
  console.log('A NORMAL STAGE');
  const s17 = [
    card('JJ', [P('M. Brennan', 1), P('T. de Jong', 23)], 58, 24, 8),
    card('JP', [P('J. Meeus', 2), P('W. van Aert', 19)], 56, 21, 8),
    card('AA', [P('B. Coquard', 10), P('V. Braet', 13)], 40, 23, 9),
    card('JB', [P('M. Cort', 3), P('V. Albanese', 133)], 40, 136, 11)
  ];
  const r17 = gen(s17, { type: 'Flat', win: 'M. Brennan', voidStage: false });
  Object.keys(r17).forEach(k => console.log('   ' + k + ': ' + r17[k]));

  check('every seat gets a read', Object.keys(r17).length === 4);
  check('both riders are named in every read',
    s17.every(c => c.picks.every(pk => r17[c.seat].indexOf(pk.r.replace(/^[A-Z]\. /, '')) >= 0)));
  check('the stage winner is called the stage winner', /the stage winner/.test(r17.JJ));
  check('a seat that did not win is not', !/the stage winner/.test(r17.AA));
  check('the best card of the day says so', /best card of the day/.test(r17.JJ));
  check('a tie shares a rank rather than inventing an order',
    /third of the four/.test(r17.AA) && /third of the four/.test(r17.JB),
    'AA and JB both on 40');
  check('surnames only, no initials', !/\b[A-Z]\.\s/.test(Object.values(r17).join(' ')));
  check('small finishes are words, deep ones are digits',
    /twenty third/.test(r17.JJ) && /133rd/.test(r17.JB));

  /* ---- the shapes that are easy to get wrong ---- */
  console.log('\nTHE AWKWARD SHAPES');

  const zero = gen([
    card('JB', [P('B. Coquard', 125), P('O. Aular', 148)], 0, 273, 15),
    card('AA', [P('X. One', 2), P('Y. Two', 4)], 80, 6, 3)
  ]);
  console.log('   zero card: ' + zero.JB);
  check('a card that scored nothing says so once, not twice',
    (zero.JB.match(/Fantasy Points/g) || []).length === 1, zero.JB);
  check('a zero card reports Placement instead of a ranking', /273 on Placement/.test(zero.JB));

  const dnf = gen([
    card('JP', [P('W. van Aert', 22), P('T. Pogacar', 174, { dnf: true })], 9, 196, 13),
    card('AA', [P('X. One', 2), P('Y. Two', 4)], 80, 6, 3)
  ]);
  console.log('   abandon:   ' + dnf.JP);
  check('an abandon is called an abandon, never a finish position',
    /abandoning/.test(dnf.JP) && dnf.JP.indexOf('174') < 0, dnf.JP);
  check('the abandoned rider is not named twice',
    (dnf.JP.match(/Pogacar/g) || []).length === 1);

  const missed = gen([
    card('JB', [P('M. Brennan', 24)], 7, 106, 12),
    card('AA', [P('X. One', 2), P('Y. Two', 4)], 80, 6, 3)
  ]);
  console.log('   missed:    ' + missed.JB);
  check('a missed pick uses the wording the stored reads use',
    /Only one pick was entered/.test(missed.JB));

  const one = gen([
    card('JJ', [P('J. Omrzel', 30), P('U. Berrade', 80)], 1, 110, 15),
    card('AA', [P('X. One', 2), P('Y. Two', 4)], 80, 6, 3)
  ]);
  console.log('   one point: ' + one.JJ);
  check('one point is singular', /One point/.test(one.JJ) && !/One points/.test(one.JJ));

  /* ---- the writing rules ---- */
  console.log('\nTHE WRITING RULES');
  const all = [r17, zero, dnf, missed, one]
    .map(o => Object.values(o).join(' ')).join(' ');
  let en = 0, em = 0;
  for (const ch of all) { if (ch === '–') en++; if (ch === '—') em++; }
  check('no en dashes', en === 0, String(en));
  check('no em dashes', em === 0, String(em));
  check('no undefined, null or NaN reaches the prose',
    !/\b(undefined|null|NaN)\b/.test(all));
  check('no [object Object]', all.indexOf('[object Object]') < 0);
  check('nothing is said about the person, only the picks',
    !/\b(lazy|careless|poor|bad|foolish|should have|deserved)\b/i.test(all));

  /* THE CLOSING RULE. The weakest card of the day gets its number and a full stop.
     Ranking it last adds nothing the table already shows and it is the sentence a person
     reads about their own afternoon. */
  const spread = gen([
    card('A', [P('R. One', 1), P('R. Two', 2)], 94, 3, 3),
    card('B', [P('R. Three', 5), P('R. Four', 6)], 63, 11, 7),
    card('C', [P('R. Five', 9), P('R. Six', 10)], 46, 19, 11),
    card('D', [P('R. Seven', 40), P('R. Eight', 41)], 0, 81, 15)
  ]);
  console.log('   weakest:   ' + spread.D);
  check('the weakest card is not ranked last at the reader',
    !/fourth of the four/.test(spread.D) && !/worst|weakest|lowest/.test(spread.D), spread.D);

  /* ---- a void stage ---- */
  console.log('\nA VOID STAGE');
  const voided = draftReads(
    { cards: s17, stageDoc: { type: 'Mountain', win: 'Cancelled', voidStage: true } },
    { scaleTop: 30 });
  check('a void stage is drafted no reads at all', Object.keys(voided).length === 0,
    'a read would be prose about a race that did not happen');

  /* ---- the scale travels ---- */
  console.log('\nTHE SCALE IS NOT TYPED IN');
  const tour = draftReads({ cards: [card('AA', [P('R. One', 12), P('R. Two', 40)], 4, 52, 6)],
    stageDoc: { type: 'Flat', win: 'R. Zero', voidStage: false } }, { scaleTop: 15 });
  check('a top-15 race says fifteen, not thirty', /fifteen/.test(tour.AA) || !/thirty/.test(tour.AA),
    tour.AA);

  console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
