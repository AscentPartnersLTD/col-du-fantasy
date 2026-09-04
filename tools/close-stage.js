#!/usr/bin/env node
/* close-stage.js - compute and gate a stage close for Col du Fantasy.
 *
 *   node tools/close-stage.js 10
 *   node tools/close-stage.js 10 --emit          also writes the paste-in snippet
 *   node tools/close-stage.js 10 --pool vuelta-2026 --race vuelta
 *
 * THIS TOOL NEVER WRITES TO FIRESTORE. It computes the stage document, runs every
 * gate, prints what would be stored, and with --emit writes a browser console
 * snippet to apply it. That is the path every stage since 5 was closed by, and it
 * keeps a human between a computed result and four players' season.
 *
 * /api/score-stage exists and answers 405 to GET, so it accepts POST and is the
 * obvious way to remove the browser step. Its payload shape has NOT been read from
 * the coldufantasy-login repo, and this tool deliberately does not guess it. See
 * "Writing boardConfig, two traps" in CLAUDE.md for what guessing a write payload
 * costs in this stack.
 *
 * Sources, in order of authority:
 *   1. racecenter.<race>.es/api/rankingType-<year>-<stage>   the official result
 *   2. /api/pool-state                                        the pool and its draft
 *   3. the built board file                                   RIDERS, the bib table
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ config -- */

const RACES = {
  vuelta: {
    pool: 'vuelta-2026',
    year: 2026,
    host: 'racecenter.lavuelta.es',
    board: 'vuelta.src.html',
    nationalityRoster: 'BELGIAN_RIDERS',
    sideGame: 'Kasseistampers'
  }
  /* tour and giro get their entry here; nothing below this block is race-specific */
};

const FP_SCALE = { 1:50,2:44,3:40,4:36,5:33,6:30,7:28,8:26,9:24,10:22,
  11:20,12:19,13:18,14:17,15:16,16:15,17:14,18:13,19:12,20:11,
  21:10,22:9,23:8,24:7,25:6,26:5,27:4,28:3,29:2,30:1 };

const SEATS = ['AA','JB','JJ','JP'];

/* A partial feed is not a feed. Thresholds are FRACTIONS of the startlist so they
   travel to another race unchanged. See "A PARTIAL FEED IS NOT A FEED" in CLAUDE.md.

   0.75 MATCHES window.__ROSTER_MIN_FRACTION ON THE BOARD, and for the same reason.
   This was written as 0.85 and it FIRED ON A COMPLETE STAGE 13, where 155 of 184
   classified is 84.2%. That is ordinary grand-tour attrition, not a truncated read:
   a race routinely finishes near 150 of 184, so a floor calibrated on the early-race
   184-to-178 decline rejects every late stage. The board made this exact mistake at
   0.9 and lowered it; this file repeated it one directory over.

   Holding a finished stage is NOT the cautious direction. It is the mirror of the
   stage 8 failure and it costs the same, so the floor is a BACKSTOP for the two
   things this guard actually catches, a GC top-50 at 27 percent and an empty list,
   and the DELTA against the previous SCORED stage carries the weight. */
const MIN_FIELD_FRACTION = 0.75;   /* refuse a classification smaller than this */
const MAX_ONE_STAGE_LOSS = 12;     /* refuse an implausible one-stage drop */
const RACE_AUDIT_MIN     = 0.50;   /* share of bibs that must resolve to our startlist */

/* --------------------------------------------------------------- utilities -- */

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: Object.assign({ 'user-agent': 'close-stage/1' }, headers || {}) }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

async function getJson(url, headers) {
  const r = await get(url, headers);
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' from ' + url);
  /* Remote data fails LOUDLY. An empty body is a fault, never an empty result. */
  if (!r.body || !r.body.trim()) throw new Error('empty body from ' + url);
  return JSON.parse(r.body);
}

let failures = 0;
function gate(label, ok, detail) {
  if (!ok) failures++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(44) +
    (detail == null ? '' : detail));
}

/* -------------------------------------------------------- the board's tables -- */

/* RIDERS is the bib table, and a wrong bib is silent and total. It is read from the
   board rather than retyped, so there is exactly one copy of it in the project. */
function readBoardTables(boardFile) {
  const src = fs.readFileSync(path.join(REPO, boardFile), 'utf8');

  const rl = src.split('\n').find(l => l.startsWith('const RIDERS = ['));
  if (!rl) throw new Error('RIDERS array not found in ' + boardFile);
  const RIDERS = JSON.parse(rl.slice(rl.indexOf('['), rl.lastIndexOf(']') + 1));

  const nameByBib = {}, teamByBib = {}, bibByName = {};
  RIDERS.forEach(r => { nameByBib[r.b] = r.r; teamByBib[r.b] = r.t; bibByName[r.r] = r.b; });

  /* the nationality side game's roster, for the top-national call */
  let national = [];
  const marker = 'const BELGIAN_RIDERS=[';
  const bi = src.indexOf(marker);
  if (bi >= 0) {
    const blk = src.slice(bi, src.indexOf('];', bi));
    national = Array.from(blk.matchAll(/\{r:"([^"]+)"/g)).map(m => m[1]);
  }

  return { RIDERS, nameByBib, teamByBib, bibByName, national };
}

/* ------------------------------------------------------- the official result -- */

/* The rankingType document is a map of binds. Each carries `type`, a `rankings`
   array and an `_id`. THE SUMMARY IS NOT THE CLASSIFICATION: on some stages the
   `ite` bind arrives holding only the leaders, and the full document is a second
   hop to `rankingType-<year>-<stage>:<_id>`. Pick the richest bind of the type,
   then hop if it still looks short. See "The summary document is NOT the
   classification" in CLAUDE.md. */
function bindsOfType(doc, type) {
  return Object.keys(doc).map(k => doc[k])
    .filter(x => x && x.type === type && Array.isArray(x.rankings))
    .sort((a, b) => b.rankings.length - a.rankings.length);
}

async function officialResult(race, stage) {
  const base = 'https://' + race.host + '/api/rankingType-' + race.year + '-' + stage;
  const doc = await getJson(base);

  let bind = bindsOfType(doc, 'ite')[0];
  if (!bind) throw new Error('no stage-result (ite) bind in ' + base);

  /* second hop, only if the bind looks truncated relative to its siblings */
  const gc = bindsOfType(doc, 'itg')[0];
  if (gc && bind.rankings.length < gc.rankings.length && bind._id) {
    try {
      const full = await getJson(base + ':' + bind._id);
      const better = bindsOfType(full, 'ite')[0];
      if (better && better.rankings.length > bind.rankings.length) bind = better;
    } catch (e) { /* the hop is an improvement, never a requirement */ }
  }

  const rows = bind.rankings.map(r => ({ bib: r.bib, pos: Number(r.position) }));
  return {
    started: rows.length,
    classified: rows.filter(r => r.pos >= 1).sort((a, b) => a.pos - b.pos),
    withdrawn: rows.filter(r => r.pos < 1),
    combativity: (bindsOfType(doc, 'ice')[0] || { rankings: [] }).rankings
  };
}

/* ------------------------------------------------------------------- gates -- */

function runGates(res, prevClassified, tables, draft) {
  console.log('\nGATES');

  const N = tables.RIDERS.length;
  const cl = res.classified;

  gate('classification is non-empty', cl.length > 0, cl.length + ' classified');

  const contiguous = cl.every((r, i) => r.pos === i + 1);
  gate('positions are contiguous from 1', contiguous,
    cl.length ? '1-' + cl[cl.length - 1].pos : '');

  gate('field is not a partial read',
    cl.length >= N * MIN_FIELD_FRACTION,
    cl.length + ' of ' + N + ' startlist, ' + (cl.length / N * 100).toFixed(1) + '%, floor ' +
    (MIN_FIELD_FRACTION * 100) + '%');

  /* The DELTA is the sharper test. Rosters shrink slowly and monotonically, so the
     right baseline is the PREVIOUS stage, never a figure several stages old. */
  if (prevClassified != null) {
    const delta = cl.length - prevClassified;
    gate('one-stage attrition is plausible',
      delta <= 0 && delta >= -MAX_ONE_STAGE_LOSS,
      'previous stage classified ' + prevClassified + ', now ' + cl.length + ', delta ' + delta);
    gate('every starter is accounted for',
      res.started === prevClassified,
      'rows ' + res.started + ' vs previous classified ' + prevClassified +
      ' (classified ' + cl.length + ' + withdrawn ' + res.withdrawn.length + ')');
  } else {
    gate('one-stage attrition is plausible', true, 'no previous stage to compare');
  }

  /* The board NAMES its race and AUDITS the reply. Bib numbers collide across races,
     so the check is whether the bibs resolve to riders we hold. */
  const known = cl.filter(r => tables.nameByBib[r.bib]).length;
  const share = cl.length ? known / cl.length : 0;
  gate('reply is for the race we asked for', share >= RACE_AUDIT_MIN,
    (share * 100).toFixed(1) + '% of bibs resolve to our startlist, threshold ' +
    (RACE_AUDIT_MIN * 100) + '%');

  /* A pick that does not resolve to a bib stops the close. Never fall back to
     name matching: the bib is what scores. */
  const unresolved = (draft.picks || []).filter(p => !tables.bibByName[p.rider]);
  gate('every pick resolves to a bib', unresolved.length === 0,
    unresolved.length ? unresolved.map(p => p.rider).join(', ') : (draft.picks || []).length + ' picks');

  gate('draft is complete', draft.status === 'complete',
    'status ' + draft.status + ', pickCount ' + draft.pickCount);

  return failures === 0;
}

/* ------------------------------------------------------------------ scoring -- */

function scoreStage(res, draft, tables) {
  const posByBib = {};
  res.classified.forEach(r => posByBib[r.bib] = r.pos);
  const lastClassified = res.classified.length ? res.classified[res.classified.length - 1].pos : 0;

  /* An abandoned rider is NOT a missed pick. Fantasy 0, Rank last, Placement one
     behind the last classified finisher. Zero is not safe on Placement, where
     lowest leads: it would make abandoning the best day of the four. */
  const ABANDON_F = lastClassified + 1;

  const picks = {};
  SEATS.forEach(s => picks[s] = []);
  (draft.picks || []).forEach(p => {
    const bib = tables.bibByName[p.rider];
    const f = posByBib[bib];
    const rec = { r: p.rider, f: f == null ? ABANDON_F : f };
    /* 174 is a SCORE, not a finishing position. Without this flag the board prints
       "174th" for a rider who abandoned, which is an invented finish. */
    if (f == null) rec.dnf = true;
    picks[p.player].push(rec);
  });
  SEATS.forEach(s => picks[s].sort((a, b) => a.f - b.f));

  const days = {};
  SEATS.forEach(s => days[s] = picks[s].reduce((a, b) => a + b.f, 0));

  const fantasy = {};
  SEATS.forEach(s => fantasy[s] = picks[s].reduce((a, b) => a + (FP_SCALE[b.f] || 0), 0));

  const flat = [];
  SEATS.forEach(s => picks[s].forEach(p => flat.push({ s, f: p.f })));
  flat.sort((a, b) => a.f - b.f);
  const rank = {}; SEATS.forEach(s => rank[s] = 0);
  let seen = 0, rk = 0, prev = null;
  flat.forEach(x => { seen++; if (prev === null || x.f > prev) rk = seen; rank[x.s] += rk; prev = x.f; });

  return { picks, days, fantasy, rank, abandonF: ABANDON_F, posByBib };
}

/* The tiebreaker SEPARATES EQUALS, it never PROMOTES. A tiebreaker cannot rescue a
   wrong first choice; it only decides between seats that all named the top rider. */
function nationalityGame(draft, tables, scored) {
  const finOf = n => {
    const bib = tables.bibByName[n];
    return bib == null ? null : scored.posByBib[bib];
  };
  const ranked = tables.national
    .map(n => ({ n, f: finOf(n) }))
    .filter(x => x.f != null)
    .sort((a, b) => a.f - b.f);
  if (!ranked.length) return null;

  const top = ranked[0];
  const kassei = draft.kassei || {};
  const named = SEATS.filter(s => Array.isArray(kassei[s]) && kassei[s][0] === top.n);

  let correct = named;
  if (named.length > 1) {
    const tb = named.map(s => ({ s, f: finOf(kassei[s][1]) }))
      .map(x => ({ s: x.s, f: x.f == null ? Infinity : x.f }))
      .sort((a, b) => a.f - b.f);
    correct = tb.length && tb[0].f !== Infinity ? [tb[0].s] : [];
  }
  return { top: top.n, f: top.f, correct, ranked: ranked.slice(0, 5), named };
}

/* -------------------------------------------------------------------- main -- */

async function main() {
  const args = process.argv.slice(2);
  const stage = Number(args[0]);
  if (!stage) { console.error('usage: node tools/close-stage.js <stage> [--race vuelta] [--breakaway --break-thru N] [--emit]'); process.exit(2); }
  const raceKey = (args.includes('--race') ? args[args.indexOf('--race') + 1] : 'vuelta');
  const race = RACES[raceKey];
  if (!race) { console.error('unknown race ' + raceKey); process.exit(2); }
  const pool = args.includes('--pool') ? args[args.indexOf('--pool') + 1] : race.pool;

  const KEY = process.env.CDF_KEY;
  if (!KEY) {
    console.error('CDF_KEY is not set. It is the x-cdf-key for /api/pool-state.');
    console.error('PowerShell:  $env:CDF_KEY = "<key>"');
    process.exit(2);
  }

  console.log('CLOSE STAGE ' + stage + '   pool ' + pool + '   race ' + raceKey);
  console.log('NOTHING IS WRITTEN BY THIS TOOL.\n');

  const tables = readBoardTables(race.board);
  console.log('  startlist: ' + tables.RIDERS.length + ' riders from ' + race.board);
  console.log('  ' + race.sideGame + ' roster: ' + tables.national.length);

  const ps = await getJson('https://api.coldufantasy.com/api/pool-state?pool=' + pool + '&stage=' + stage,
    { 'x-cdf-key': KEY });
  const draft = ps.draft;
  if (!draft) throw new Error('no draft document for stage ' + stage);
  const already = (ps.stages || []).some(s => s && s.n === stage);
  console.log('  pool startStage ' + ps.poolDoc.startStage + ', scored ' + JSON.stringify(ps.scoredStages));
  if (already) console.log('  NOTE: a stage document for ' + stage + ' already exists. This would overwrite it.');

  const res = await officialResult(race, stage);

  /* previous stage = the most recent SCORED stage, which already excludes void ones */
  const prevN = (ps.scoredStages || []).filter(n => n < stage).pop();
  let prevClassified = null;
  if (prevN) {
    try { prevClassified = (await officialResult(race, prevN)).classified.length; } catch (e) {}
  }
  console.log('  official stage ' + stage + ': started ' + res.started + ', classified ' +
    res.classified.length + ', withdrawn ' + res.withdrawn.length +
    (prevN ? '   (previous scored stage ' + prevN + ': ' + prevClassified + ')' : ''));

  if (!runGates(res, prevClassified, tables, draft)) {
    console.log('\n' + failures + ' gate(s) failed. Nothing computed. Fix the input, not the gate.');
    process.exit(1);
  }

  const scored = scoreStage(res, draft, tables);
  const nat = nationalityGame(draft, tables, scored);
  const winBib = res.classified[0].bib;

  /* route and type come from the CALENDAR, boardConfig.race, which is the source of
     truth for them. They are NOT decorative: stageCard prints st.route directly and
     st.type drives the profile art, the archetype buckets and the sprint-wins test,
     so a doc without them renders "undefined" on the most-read card on the board. */
  const raceRow = ((ps.poolDoc.boardConfig || {}).race || []).find(r => r && r.n === stage) || {};

  /* Operator judgment, passed in rather than typed into the snippet afterwards, so the
     emitted values cannot drift from the ones the gates just checked. */
  const breakaway = args.includes('--breakaway');
  const breakThru = args.includes('--break-thru') ? Number(args[args.indexOf('--break-thru') + 1]) : null;
  if (breakaway && !(breakThru > 0)) {
    console.error('\n--breakaway needs --break-thru <finish position the break came in by>.');
    process.exit(2);
  }

  const stageDoc = {
    n: stage,
    route: raceRow.route || null,
    type: raceRow.type || null,
    win: tables.nameByBib[winBib] || String(winBib),
    combatif: res.combativity.length ? (tables.nameByBib[res.combativity[0].bib] || null) : null,
    breakaway: breakaway,
    breakThru: breakaway ? breakThru : null,
    voidStage: false,
    voidLabel: null,
    days: scored.days,
    picks: scored.picks,
    scored: true
  };
  if (!stageDoc.route || !stageDoc.type) {
    console.error('\nno route/type on the boardConfig.race row for stage ' + stage +
      '. The stage card reads both. Fix the calendar row first.');
    process.exit(2);
  }
  if (nat) stageDoc.kassei = { top: nat.top, f: nat.f, correct: nat.correct };

  console.log('\nSTAGE DOCUMENT');
  console.log('  win        ' + stageDoc.win + '  (' + (tables.teamByBib[winBib] || '?') + ')');
  console.log('  combatif   ' + (stageDoc.combatif || 'not in the feed'));
  SEATS.forEach(s => console.log('  ' + s + '  Placement ' + String(scored.days[s]).padStart(3) +
    '  Fantasy ' + String(scored.fantasy[s]).padStart(2) + '  Rank ' + String(scored.rank[s]).padStart(2) +
    '   ' + scored.picks[s].map(p => p.r + ' ' + p.f + (p.dnf ? ' DNF' : '')).join(',  ')));
  const rankTotal = SEATS.reduce((a, s) => a + scored.rank[s], 0);
  console.log('  rank total ' + rankTotal + (rankTotal === 36 ? '  ok' : '  MISMATCH, must be 36'));
  if (nat) {
    console.log('  ' + race.sideGame + ': top ' + nat.top + ' ' + nat.f + 'th, named by ' +
      (nat.named.length ? nat.named.join('/') : 'nobody') + ', correct ' + JSON.stringify(nat.correct));
  }

  /* Both awards are DERIVED by the board at render time from breakaway, breakThru,
     combatif and picks. Nothing about them is stored. They are printed here so the
     close can be checked against what the board will actually show. */
  console.log('\nAWARDS THE BOARD WILL DERIVE');
  if (breakaway) {
    let best = null;
    SEATS.forEach(s2 => scored.picks[s2].forEach(p => {
      if (!p.dnf && p.f <= breakThru && (!best || p.f < best.f)) best = { s: s2, r: p.r, f: p.f };
    }));
    console.log('  Seleccion    ' + (best ? best.s + ', ' + best.r + ' ' + best.f + 'th (break at <= ' +
      breakThru + ')' : 'nobody drafted inside the break'));
  } else {
    console.log('  Seleccion    not a breakaway stage, no award');
  }
  const cb = stageDoc.combatif;
  const nrm = x => String(x || '').toUpperCase().replace(/^[A-Z]\.\s*/, '').replace(/[^A-Z]/g, '');
  const prix = [];
  if (cb) SEATS.forEach(s2 => scored.picks[s2].forEach(p => {
    if (nrm(p.r) === nrm(cb)) prix.push(s2 + ', ' + p.r + ' ' + p.f + 'th');
  }));
  console.log('  Premio       ' + (prix.length ? prix.join('; ') : 'nobody drafted ' + (cb || 'the combatif')));

  /* A seat whose two picks both score zero Fantasy Points takes a Double Goose. It is
     recomputed at render time and never stored; printed here for the same reason. */
  const geese = SEATS.filter(s2 => scored.fantasy[s2] === 0 && scored.picks[s2].some(p => !p.dnf));
  console.log('  Double Goose ' + (geese.length ? geese.join(', ') : 'none'));

  console.log('\nSTILL NEEDS YOUR CALL, and is not derivable from the feed:');
  console.log('  extra       the race-row note for the board');

  if (args.includes('--emit')) {
    const out = path.join(REPO, 'close-stage-' + stage + '.snippet.js');
    fs.writeFileSync(out, snippet(pool, stage, stageDoc, ps));
    console.log('\nwrote ' + path.relative(REPO, out));
    console.log('Paste it into a signed-in board tab as the owner. Read the values back after.');

    /* The same values, machine-readable, so a writer consumes the numbers the gates
       checked rather than a re-typed copy of them. ONE computation, per the standard
       rule. The rotation is derived here and not by the caller: pool.order is the
       order of the CURRENT upcoming stage, so advancing the stage rotates it by one
       seat, which is what every drafts/{n}.order in the season already shows. */
    const curOrder = Array.isArray(ps.poolDoc.order) ? ps.poolDoc.order.slice() : [];
    const nextOrder = curOrder.length ? curOrder.slice(1).concat(curOrder.slice(0, 1)) : [];
    const payload = {
      pool: pool,
      stage: stage,
      data: stageDoc,
      advance: { startStage: stage + 1, order: nextOrder },
      race: ((ps.poolDoc.boardConfig || {}).race || []).map(r =>
        r && r.n === stage ? Object.assign({}, r, { upcoming: false, win: stageDoc.win }) : r)
    };
    const jout = path.join(REPO, 'close-stage-' + stage + '.payload.json');
    fs.writeFileSync(jout, JSON.stringify(payload, null, 2));
    console.log('wrote ' + path.relative(REPO, jout));
    console.log('  order rotates ' + JSON.stringify(curOrder) + ' -> ' + JSON.stringify(nextOrder) +
      ', startStage ' + stage + ' -> ' + (stage + 1));
  } else {
    console.log('\nRe-run with --emit to write the paste-in snippet.');
  }
}

/* The snippet is generated rather than hand-written so the values cannot drift from
   the ones the gates just checked. It deliberately does NOT touch next2: leaving
   that field unset is what keeps the Stats card deriving the next stage correctly. */
function snippet(pool, stage, stageDoc, ps) {
  /* Set only what the close knows. `extra` is LEFT AS IT IS rather than filled with a
     placeholder: a placeholder that survives a paste publishes itself to the board,
     and blanking it silently would drop a note somebody wrote. Edit it deliberately
     if the row wants a different one, remembering that a race-row extra SHADOWS a
     sharedUpcoming intel block. */
  const race = ((ps.poolDoc.boardConfig || {}).race || []).map(r =>
    r && r.n === stage ? Object.assign({}, r, { upcoming: false, win: stageDoc.win }) : r);
  return `/* Stage ${stage} close for ${pool}. Generated by tools/close-stage.js.
   Paste into a signed-in board tab as the owner, then read the values back.
   Set the extra note on the race row before running. Do NOT add next2. */
(async () => {
  const stageDoc = ${JSON.stringify(stageDoc, null, 2)};

  await db.doc('pools/${pool}/stages/${stage}').set(stageDoc);
  await db.doc('pools/${pool}').update({ startStage: ${stage + 1} });

  /* config.race is an ARRAY and replaces wholesale, so all ${race.length} rows go back. */
  await db.doc('pools/${pool}').update({ 'boardConfig.race': ${JSON.stringify(race)} });

  const back = await db.doc('pools/${pool}/stages/${stage}').get();
  console.log('stored:', back.data());
  console.log('startStage:', (await db.doc('pools/${pool}').get()).data().startStage);
})();
`;
}

main().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
