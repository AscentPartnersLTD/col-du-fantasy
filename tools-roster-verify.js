/* Runs the SHIPPED roster block out of the built vuelta.html against the REAL
   /api/break payloads saved from the live feed. Not a transcription: the code under
   test is lifted verbatim from the file that gets deployed. */
const fs = require('fs');
const path = require('path');
const REPO = __dirname;
const HERE = __dirname + '/tools-roster-fixtures';
const SRC = fs.readFileSync(REPO + '/vuelta.html', 'utf8');

// ---- the real startlist, out of the same file ----
const RIDERS = (function () {
  const line = SRC.split('\n').find(l => l.startsWith('const RIDERS = ['));
  return JSON.parse(line.slice('const RIDERS = '.length).trim().replace(/;$/, ''));
})();

// ---- the block under test ----
const START = 'window.__ACTIVE = null; window.__OUT = [];';
const END = '  return attempt(0);';
const i = SRC.indexOf(START);
const j = SRC.indexOf(END, i);
if (i < 0 || j < 0) throw new Error('roster block not found in vuelta.html');
const BLOCK = SRC.slice(i, SRC.indexOf('};', j) + 2)
  + ';window.riderIsOut = riderIsOut; window._markOut = _markOut;';

// ---- environment the block expects ----
const BEL = { 3:'J. Meeus',7:'G. Vermeersch',28:'C. Uijtdebroeks',31:'W. van Aert',44:'S. de Pestel',
  87:'T. Nys',103:'R. Debruyne',104:'L. de Vylder',108:'S. Sentjens',118:'F. van Tricht',
  126:'F. van den Bossche',127:'M. Vansevenant',144:'S. Moniquet',201:'J. Widar',
  202:'V. Braet',203:'L. Craps',204:'S. de Schuyteneer',207:'L. van Boven' };
const BELGIAN_RIDERS = Object.keys(BEL).map(b => ({ r: BEL[b], t: '', out: false }));
const USA_RIDERS = [];
const RACE_PROFILE = { id: 'vuelta' };
const BREAK_ENDPOINTS = ['https://api.coldufantasy.com/api/break'];
const sideGameOn = id => id === 'kasseistampers';
const _nrm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
let repaints = 0;
const _rosterRepaint = () => { repaints++; };
const window = {};

// stub fetch: serve the saved live payloads, or an injected one
let INJECT = null;
global.fetch = async function (url) {
  if (INJECT) { const d = INJECT; return { ok: true, json: async () => d }; }
  const m = /[?&]stage=(\d+)/.exec(url);
  const f = path.join(HERE, m[1] + '.json');
  if (!fs.existsSync(f)) return { ok: false, json: async () => null };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
};

new Function('window','RIDERS','BELGIAN_RIDERS','USA_RIDERS','RACE_PROFILE','BREAK_ENDPOINTS',
             'sideGameOn','_nrm','_rosterRepaint','fetch', BLOCK)
  (window, RIDERS, BELGIAN_RIDERS, USA_RIDERS, RACE_PROFILE, BREAK_ENDPOINTS,
   sideGameOn, _nrm, _rosterRepaint,
   /* late-bound on purpose: the block captures this as a parameter, so a test that
      swaps global.fetch must be dispatched to at CALL time, not at construction. */
   function () { return global.fetch.apply(null, arguments); });

let fail = 0;
const check = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail = 1; } };

(async function () {
  /* Read the fraction from the board rather than printing a literal: the constant
     moved from 0.9 to 0.75 and a hardcoded label would have gone on claiming 90. */
  console.log('startlist ' + RIDERS.length + ', floor ' + window.__rosterFloor()
    + ' (' + Math.round(window.__ROSTER_MIN_FRACTION * 100) + ' percent)');

  console.log('');
  console.log('=== THE REAL CASE: pool has scored 1,2,4,5,6,7 (stage 3 void, 8 in draft) ===');
  await window.__loadRoster([1, 2, 4, 5, 6, 7]);
  console.log('  state ' + window.__ROSTER_STATE + '  stage ' + window.__ROSTER_STAGE +
              '  classified ' + window.__ROSTER_COUNT + '  out ' + window.__OUT.length);
  console.log('  refused: ' + JSON.stringify(window.__ROSTER_REFUSED));
  const outBibs = window.__OUT.map(r => r.b).sort((a, b) => a - b);
  console.log('  out bibs: ' + JSON.stringify(outBibs));
  console.log('  out names: ' + window.__OUT.map(r => r.r).join(', '));
  check(window.__ROSTER_STATE === 'ok', 'must resolve');
  check(window.__ROSTER_STAGE === 7, 'must use stage 7, the most recent scored stage');
  check(window.__ROSTER_COUNT === 178, 'must classify 178');
  check(window.__OUT.length === 6, 'GROUND TRUTH: exactly 6 riders out, got ' + window.__OUT.length);
  check(JSON.stringify(outBibs) === JSON.stringify([28, 67, 143, 163, 194, 208]),
        'GROUND TRUTH: out bibs must be 28,67,143,163,194,208');

  const belOut = BELGIAN_RIDERS.filter(u => u.out).map(u => u.r);
  console.log('  Belgians marked out: ' + belOut.length + ' -> ' + JSON.stringify(belOut));
  console.log('  Belgians selectable: ' + (BELGIAN_RIDERS.length - belOut.length) + ' of ' + BELGIAN_RIDERS.length);
  check(belOut.length === 1, 'GROUND TRUTH: exactly ONE Belgian out, got ' + belOut.length);
  check(belOut[0] === 'C. Uijtdebroeks', 'GROUND TRUTH: the one Belgian must be Uijtdebroeks');
  check(BELGIAN_RIDERS.length - belOut.length === 17, 'GROUND TRUTH: 17 Belgians selectable');
  check(window.riderIsOut('W. van Aert') === false, 'van Aert must be SELECTABLE, he finished third');
  check(window.riderIsOut('J. Meeus') === false, 'Meeus must be selectable');
  check(window.riderIsOut('S. Sentjens') === false, 'Sentjens must be selectable');

  console.log('');
  console.log('=== the void stage alone: empty classification, must fail OPEN ===');
  await window.__loadRoster([3]);
  console.log('  state ' + window.__ROSTER_STATE + '  why "' + window.__ROSTER_WHY + '"  out ' + window.__OUT.length);
  check(window.__ROSTER_STATE === 'unknown', 'void stage must not resolve');
  check(window.__ACTIVE === null && window.__OUT.length === 0, 'nobody may be marked out');
  check(BELGIAN_RIDERS.every(u => !u.out), 'out flags must be CLEARED on failure, not left behind');

  console.log('');
  console.log('=== an unraced stage alone: empty, must fail OPEN ===');
  await window.__loadRoster([8]);
  console.log('  state ' + window.__ROSTER_STATE + '  why "' + window.__ROSTER_WHY + '"');
  check(window.__ROSTER_STATE === 'unknown', 'unraced stage must not resolve');

  console.log('');
  console.log('=== the bug that caused all this: a GC top 50 offered as finishers ===');
  const gc50 = { race: 'vuelta', stage: '8', finished: Array.from({ length: 50 }, (_, k) => ({ bib: [11,21,1,161,41][k % 5] + k, pos: k + 1 })) };
  INJECT = gc50;
  await window.__loadRoster([7]);
  INJECT = null;
  console.log('  state ' + window.__ROSTER_STATE + '  refused: ' + JSON.stringify(window.__ROSTER_REFUSED));
  check(window.__ROSTER_STATE === 'unknown', 'a 50-row answer must be REFUSED, not used');
  check(BELGIAN_RIDERS.every(u => !u.out), 'no Belgian may be marked out by a refused roster');

  console.log('');
  console.log('=== wrong race answered: must be refused, per the race audit rule ===');
  INJECT = { race: 'tour', stage: '7', finished: RIDERS.map((r, k) => ({ bib: r.b, pos: k + 1 })) };
  await window.__loadRoster([7]);
  INJECT = null;
  console.log('  state ' + window.__ROSTER_STATE + '  why "' + window.__ROSTER_WHY + '"');
  check(window.__ROSTER_STATE === 'unknown', 'a reply for the wrong race must be refused');

  console.log('');
  console.log('=== walk-back: newest scored stage short, older one good ===');
  let calls = 0;
  const realFetch = global.fetch;
  global.fetch = async function (url) {
    calls++;
    const m = /[?&]stage=(\d+)/.exec(url);
    if (m[1] === '7') return { ok: true, json: async () => ({ race: 'vuelta', stage: '7', finished: [] }) };
    return realFetch(url);
  };
  await window.__loadRoster([1, 2, 4, 5, 6, 7]);
  global.fetch = realFetch;
  console.log('  state ' + window.__ROSTER_STATE + '  stage ' + window.__ROSTER_STAGE +
              '  count ' + window.__ROSTER_COUNT + '  refused ' + JSON.stringify(window.__ROSTER_REFUSED));
  check(window.__ROSTER_STATE === 'ok', 'must resolve from an older scored stage');
  check(window.__ROSTER_STAGE === 6 && window.__ROSTER_COUNT === 178, 'must land on stage 6 with 178');

  console.log('');
  console.log('=== disabled: no request, nobody out ===');
  window.__ROSTER_ENABLED = false;
  await window.__loadRoster([1, 2, 4, 5, 6, 7]);
  window.__ROSTER_ENABLED = true;
  console.log('  state ' + window.__ROSTER_STATE + '  out ' + window.__OUT.length);
  check(window.__ROSTER_STATE === 'off' && window.__OUT.length === 0, 'disabled must mark nobody out');

  console.log('');
  console.log(fail ? '*** SOME CHECKS FAILED ***' : 'ALL CHECKS PASSED');
  process.exit(fail);
})();
