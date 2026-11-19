#!/usr/bin/env node
/* tools/demo-build.js - build tour-demo: the playable mid-race board.
 *
 *   node tools/demo-build.js            print the owner-console snippet
 *
 * WHAT IT MAKES. A copy of `sandbox`, backfilled with col-du-fantasy stages 1 to 13 so
 * the board reads as a real season through stage 17, with stage 18 open and one pick
 * already made. A guest holding a seat in `viewerSeats` plays that seat and nothing
 * else anywhere.
 *
 * IT WRITES NOTHING ITSELF. It prints a snippet to paste into a signed-in OWNER board
 * console, DRY RUN FIRST, which is how every write in this repo is applied. The REST
 * path the copy tool also carries needs an access token from gcloud, and gcloud is not
 * installed on either of Allen's machines.
 *
 * IT IS THE SAME SCRUB AS showroom-copy.js, spliced out of that file rather than
 * rewritten. A second copy of a scrubber is a copy that drifts, and the one that drifts
 * is the one that misses a field. The field it would miss here is real: the sandbox's
 * stage 18 draft carries `by: <an address>` deep inside a picks array, set from the
 * drafting session's own email.
 *
 * ---------------------------------------------------------------------------------
 * THE FOUR DECISIONS THIS TOOL MAKES ABOUT DERIVED DATA, each with its reason, because
 * "recompute every derived field" turns out to mean four different things:
 *
 * 1. `official` IS DROPPED, not recomputed. It is the OFFICIAL HAND TALLY, and the only
 *    thing that reads it is a reconciliation panel comparing Allen's own numbers
 *    against what the board computes. Nobody hand-tallied a copy, so there is no hand
 *    tally; writing one would mean re-implementing Placement and Rank here, which is a
 *    SECOND COPY OF THE SCORING and the exact duplication this repo keeps paying for.
 *    buildCDF already has the designed fallback: `pool.official || {through:0, ...}`.
 *    The standings a guest sees are computed from the stage documents at render time
 *    and are untouched by this.
 *
 * 2. `personaLedger` IS CLEARED to {order:[], by:{}, seen:{}}. CLAUDE.md: clearing `by`
 *    is how the whole board retires, and a seat with no previous persona has nothing to
 *    hold, so all four move. The engine then assigns from the standings THROUGH STAGE 17
 *    on the first load, which is the board's own code path and the only one there is.
 *    Carrying the sandbox's ledger would pin four personas to a standing that no longer
 *    exists after the backfill.
 *
 * 3. `editorial` IS DROPPED. It is authored prose, not a derived field: hand-written
 *    highlight tiles and a Draft Tilt footer about a season that is not this one after
 *    the backfill. The board keeps its baked markup when the key is absent. A stale
 *    claim that renders as real is the hazard this repo already records about carrying
 *    another race's baked calendar.
 *
 * 4. `boardConfig.next2` IS DROPPED. CLAUDE.md is unambiguous: never write it. The
 *    sandbox carries it as null, which happens to be harmless, and dropping it is
 *    strictly better than carrying a key whose mere existence can kill the derivation.
 *
 * AND THE ONE THE SANDBOX GETS WRONG ON ITS OWN. Its `boardConfig.race` is the FINISHED
 * Tour: all 21 rows carry a winner, including stage 18, which is the stage the guest is
 * about to draft. Copied as it stands, the Road Ahead and Full Results would print the
 * result of the stage being played. Rows 18 to 21 are therefore reopened, and rows 1 to
 * 13 are taken from col-du-fantasy so the calendar and the stage documents come from
 * ONE source. Two records of the same fact, with only one of them corrected, is the
 * shape CLAUDE.md records about stage 15's distance.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = 'sandbox';
const TARGET = 'tour-demo';
const BACKFILL_FROM = 'col-du-fantasy';
const BACKFILL_THROUGH = 13;          /* stages 1..13; the sandbox already holds 14..17 */
const OPEN_STAGE = 18;                /* the stage being drafted */
const BOARD_PATH = '/tour.html';

/* Never a target, ever, under any flag. Named rather than inferred, the same way
   firestore.rules names them, and extended with the two showrooms: a demo build
   pointed at a showroom would turn a read-only copy into a writable one. */
const NEVER_A_TARGET = ['col-du-fantasy', 'vuelta-2026', 'lowry-city-rollers',
  'sandbox', 'tour-showroom', 'vuelta-showroom'];

/* ---- the scrub, spliced out of showroom-copy.js -------------------------------- */
function scrubBlock() {
  const p = path.join(__dirname, 'showroom-copy.js');
  const self = fs.readFileSync(p, 'utf8');
  const a = self.indexOf('/* --- SCRUB BLOCK START');
  const b = self.indexOf('/* --- SCRUB BLOCK END');
  if (a < 0 || b < 0 || b <= a) {
    console.error('REFUSED: the scrub block markers are missing from showroom-copy.js.');
    process.exit(2);
  }
  const afterMarker = self.indexOf('*/', a);
  if (afterMarker < 0 || afterMarker > b) {
    console.error('REFUSED: the scrub block marker comment is not closed.');
    process.exit(2);
  }
  return self.slice(afterMarker + 2, b).replace(/^\s*\n/, '');
}

const out = [];
const p = (l) => out.push(l);

p('/* BUILD ' + TARGET + ', the playable demo board.');
p(' * Paste the WHOLE block into the console of a signed-in OWNER board tab.');
p(' * DRY RUN FIRST: it reads, scrubs, reports every intended write, and writes NOTHING');
p(' * until APPLY is set true and it is run again.');
p(' *');
p(' * It reads ' + SOURCE + ' and ' + BACKFILL_FROM + '. It writes ONLY ' + TARGET + '.');
p(' */');
p('');
p('const APPLY = false;   // <- flip to true on the second run');
p('');
p('(async () => {');
p('  const SOURCE = ' + JSON.stringify(SOURCE) + ';');
p('  const TARGET = ' + JSON.stringify(TARGET) + ';');
p('  const BACKFILL_FROM = ' + JSON.stringify(BACKFILL_FROM) + ';');
p('  const BACKFILL_THROUGH = ' + BACKFILL_THROUGH + ';');
p('  const OPEN_STAGE = ' + OPEN_STAGE + ';');
p('  const BOARD_PATH = ' + JSON.stringify(BOARD_PATH) + ';');
p('  const NEVER_A_TARGET = ' + JSON.stringify(NEVER_A_TARGET) + ';');
p('  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi;');
p('');
p('  /* THE REFUSAL THAT MATTERS, before any work. A build pointed the wrong way is the');
p('     one thing here that could overwrite four players\' season, or turn a read-only');
p('     showroom into a pool a guest can write. */');
p('  if (NEVER_A_TARGET.includes(TARGET)) { console.error("REFUSED: " + TARGET + " is never a target."); return; }');
p('  if (SOURCE === TARGET) { console.error("REFUSED: that would copy onto itself."); return; }');
p('');
/* spliced, not rewritten */
scrubBlock().split('\n').forEach((l) => p(l ? '  ' + l : ''));
p('');
p('  const srcSnap = await db.doc("pools/" + SOURCE).get();');
p('  if (!srcSnap.exists) { console.error("REFUSED: " + SOURCE + " does not exist."); return; }');
p('  const backSnap = await db.doc("pools/" + BACKFILL_FROM).get();');
p('  if (!backSnap.exists) { console.error("REFUSED: " + BACKFILL_FROM + " does not exist."); return; }');
p('');
p('  /* AN EXISTING TARGET KEEPS ITS GUESTS. A rebuild must not revoke anybody: the');
p('     viewers map and the viewerSeats map are granted separately and are the only');
p('     things on this document that are not derived from the source. */');
p('  const prevSnap = await db.doc("pools/" + TARGET).get();');
p('  const prev = prevSnap.exists ? (prevSnap.data() || {}) : {};');
p('  const keptViewers = prev.viewers || {};');
p('  const keptSeats = prev.viewerSeats || {};');
p('');
p('  const rep = [];');
p('  const pool = scrub(srcSnap.data(), rep, "");');
p('');
p('  /* ---- what the demo IS ---- */');
p('  pool.showroom = true;   /* viewerOf() demands it, so a demo carries both flags */');
p('  pool.demo = true;');
p('  pool.boardPath = BOARD_PATH;');
p('  pool.members = {};      /* EMPTY, never deleted: an absent members field makes');
p('                             inPool() an evaluation error rather than a false. */');
p('  delete pool.memberEmails;');
p('  pool.viewers = keptViewers;');
p('  pool.viewerSeats = keptSeats;');
p('  pool.name = "Tour demo";');
p('  pool.subtitle = "A playable demo board";');
p('  pool.copiedFrom = SOURCE;');
p('  pool.copiedAt = new Date();');
p('  pool.startStage = OPEN_STAGE;');
p('');
p('  /* ---- the four derived decisions, each explained in tools/demo-build.js ---- */');
p('  delete pool.official;      /* the hand tally; buildCDF falls back to through:0 */');
p('  delete pool.editorial;     /* authored prose about a different season */');
p('  pool.personaLedger = { order: [], by: {}, seen: {} };   /* the engine reassigns */');
p('  if (pool.boardConfig) delete pool.boardConfig.next2;    /* never write next2 */');
p('');
p('  /* ---- the calendar: ONE source per row ---- */');
p('  const backCal = ((backSnap.data() || {}).boardConfig || {}).race || [];');
p('  const srcCal = (pool.boardConfig || {}).race || [];');
p('  const byN = {};');
p('  srcCal.forEach(r => { byN[Number(r.n)] = r; });');
p('  backCal.forEach(r => { if (Number(r.n) <= BACKFILL_THROUGH) byN[Number(r.n)] = r; });');
p('  /* STAGES FROM THE OPEN ONE ONWARD HAVE NOT BEEN RACED IN THIS DEMO. The sandbox');
p('     carries the finished Tour, winner and all, including the stage the guest is');
p('     about to draft. Reopening them is what stops the board printing the result of');
p('     the stage being played. `extra` goes with the winner: it is prose about how the');
p('     day went. */');
p('  let reopened = 0;');
p('  Object.keys(byN).forEach(k => {');
p('    const n = Number(k);');
p('    if (n < OPEN_STAGE) return;');
p('    const r = Object.assign({}, byN[n]);');
p('    if (r.win || r.extra || r.upcoming !== true) reopened++;');
p('    r.win = "";');
p('    r.upcoming = true;');
p('    delete r.extra;');
p('    byN[n] = r;');
p('  });');
p('  const race = Object.keys(byN).map(Number).sort((a, b) => a - b).map(n => byN[n]);');
p('  pool.boardConfig = Object.assign({}, pool.boardConfig, { race });');
p('');
p('  const hits = [];');
p('  findEmails(pool, hits, "pool");');
p('  if (hits.length) { console.error("REFUSED: an address survived the scrub: " + hits[0]); return; }');
p('');
p('  /* ---- the documents ---- */');
p('  const plan = [];');
p('  const srcStages = await db.collection("pools/" + SOURCE + "/stages").get();');
p('  srcStages.forEach(d => plan.push({ coll: "stages", id: d.id, from: SOURCE, data: d.data() }));');
p('  const backStages = await db.collection("pools/" + BACKFILL_FROM + "/stages").get();');
p('  backStages.forEach(d => {');
p('    if (Number(d.id) <= BACKFILL_THROUGH) plan.push({ coll: "stages", id: d.id, from: BACKFILL_FROM, data: d.data() });');
p('  });');
p('  const srcDrafts = await db.collection("pools/" + SOURCE + "/drafts").get();');
p('  srcDrafts.forEach(d => plan.push({ coll: "drafts", id: d.id, from: SOURCE, data: d.data() }));');
p('');
p('  /* THE STARTING STATE IS STORED ON THE POOL, as data, so the Reset button never');
p('     contains a rider name, a queue or a seat order. A second copy of the opening');
p('     state in the board is one that drifts from the pool it describes. */');
p('  const openDraft = plan.find(x => x.coll === "drafts" && String(x.id) === String(OPEN_STAGE));');
p('  if (!openDraft) { console.error("REFUSED: " + SOURCE + " has no drafts/" + OPEN_STAGE + " to open on."); return; }');
p('  const rd = [], rh = [];');
p('  pool.demoReset = scrub(openDraft.data, rd, "");');
p('  findEmails(pool.demoReset, rh, "demoReset");');
p('  if (rh.length) { console.error("REFUSED: an address survived in demoReset: " + rh[0]); return; }');
p('  const startPicks = (pool.demoReset.picks || []).length;');
p('  if (startPicks !== 1) { console.error("REFUSED: the opening draft holds " + startPicks + " picks, expected 1."); return; }');
p('');
p('  const clean = [];');
p('  let blocked = 0;');
p('  for (const item of plan) {');
p('    const r2 = [], h2 = [];');
p('    const doc = scrub(item.data, r2, "");');
p('    findEmails(doc, h2, item.coll + "/" + item.id);');
p('    if (h2.length) { console.error("REFUSED " + item.coll + "/" + item.id + ": " + h2[0]); blocked++; continue; }');
p('    clean.push({ coll: item.coll, id: item.id, from: item.from, doc });');
p('  }');
p('  if (blocked) { console.error("REFUSED: " + blocked + " document(s) still carried an address. Nothing written."); return; }');
p('');
p('  const stageIds = clean.filter(c => c.coll === "stages").map(c => Number(c.id)).sort((a, b) => a - b);');
p('  console.log(SOURCE + " + " + BACKFILL_FROM + " -> " + TARGET);');
p('  console.log("  pool doc: " + rep.length + " value(s) scrubbed, " + reopened + " calendar row(s) reopened from " + OPEN_STAGE);');
p('  console.log("  stages: " + stageIds.length + " (" + stageIds.join(",") + ")");');
p('  console.log("  drafts: " + clean.filter(c => c.coll === "drafts").length + ", open on " + OPEN_STAGE);');
p('  console.log("  viewers kept: " + Object.keys(keptViewers).length + ", seats kept: " + Object.keys(keptSeats).length);');
p('');
p('  if (!APPLY) {');
p('    console.log("DRY RUN: would write 1 pool document and " + clean.length + " others. Nothing was written.");');
p('    console.log("Set APPLY = true and run it again.");');
p('    return;');
p('  }');
p('');
p('  await db.doc("pools/" + TARGET).set(pool);');
p('  for (const c of clean) await db.doc("pools/" + TARGET + "/" + c.coll + "/" + c.id).set(c.doc);');
p('');
p('  /* READ IT BACK. A write that returned is not a write that landed. */');
p('  const back = (await db.doc("pools/" + TARGET).get()).data() || {};');
p('  const st = await db.collection("pools/" + TARGET + "/stages").get();');
p('  const dr = await db.doc("pools/" + TARGET + "/drafts/" + OPEN_STAGE).get();');
p('  const cal = (back.boardConfig || {}).race || [];');
p('  const open = cal.find(r => Number(r.n) === OPEN_STAGE) || {};');
p('  console.log(TARGET, {');
p('    demo: back.demo, showroom: back.showroom, boardPath: back.boardPath,');
p('    members: Object.keys(back.members || {}).length,');
p('    memberEmails: back.memberEmails === undefined ? "dropped" : "STILL THERE",');
p('    official: back.official === undefined ? "dropped" : "STILL THERE",');
p('    editorial: back.editorial === undefined ? "dropped" : "STILL THERE",');
p('    next2: ((back.boardConfig || {}).next2 === undefined) ? "dropped" : "STILL THERE",');
p('    personaLedger: Object.keys(back.personaLedger && back.personaLedger.by || {}).length === 0 ? "cleared" : "STILL SET",');
p('    startStage: back.startStage, stages: st.size,');
p('    stage18Open: (open.upcoming === true && !open.win) ? "yes" : "NO, it still carries a winner",');
p('    draftPicks: ((dr.data() || {}).picks || []).length,');
p('    demoReset: ((back.demoReset || {}).picks || []).length + " pick(s) stored",');
p('    viewers: Object.keys(back.viewers || {}).length,');
p('    viewerSeats: JSON.stringify(back.viewerSeats || {}) });');
p('  console.log("Now run the grants snippet: node tools/demo-grants.js");');
p('})();');

console.log(out.join('\n'));
