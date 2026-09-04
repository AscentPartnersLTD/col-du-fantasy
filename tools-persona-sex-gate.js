#!/usr/bin/env node
/* tools-persona-sex-gate.js - the race-sex rule for the persona bank.
 *
 *   node tools-persona-sex-gate.js
 *
 * ALLEN'S RULE, 2026-09-04: personas must match the gender of the race being run. A
 * men's Grand Tour draws only from men; a women's race would draw only from women. It
 * lives in the DATA, a `sex` field on every bank row and one on RACE_PROFILE, so it
 * travels per race instead of being a draw-time hack.
 *
 * WHY: JJ took a 40 point lead and the board handed him Nicole Cooke. A woman's name on
 * a seat in a men's race reads as an insult rather than an honour, which is the exact
 * opposite of what the feature is for.
 *
 * The women's rows are KEPT, never deleted, because a women's race would want them.
 * This gate proves they are present and UNREACHABLE, which is a different claim from
 * "they are gone" and is the one that matters.
 *
 * Everything is lifted VERBATIM out of the BUILT vuelta.html, the same way
 * tools-roster-verify.js and tools-fantasy-tiebreak-verify.js do, so this measures the
 * shipped code rather than a transcription of it. With CDF_KEY set it additionally
 * checks the LIVE ledger, because a filter on the DRAW cannot by itself repair a board
 * that is already wrong. That is the tonymartin lesson one rule over.
 */
'use strict';
const fs = require('fs');
const https = require('https');

const SRC = fs.readFileSync(__dirname + '/vuelta.html', 'utf8');
let fail = 0;
function gate(label, ok, detail) {
  if (!ok) fail++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(46) +
    (detail == null ? '' : detail));
}

/* ---- lift the bank, the race sex and the ART map out of the built board ---- */
const BANK = (function () {
  const i = SRC.indexOf('const PERSONA_BANK = [');
  const j = SRC.indexOf('\nconst PERSONA_BY', i);
  if (i < 0 || j < 0) throw new Error('PERSONA_BANK not found in vuelta.html');
  return new Function(SRC.slice(i, j) + '; return PERSONA_BANK;')();
})();

const RACE_SEX = (function () {
  const m = SRC.match(/^\s*sex:'([mf])',\s*$/m);
  return m ? m[1] : null;
})();

const ART_KEYS = (function () {
  const i = SRC.indexOf('const ART');
  const j = SRC.indexOf('\n};', i);
  if (i < 0 || j < 0) return null;
  return [...SRC.slice(i, j).matchAll(/^\s{2}([a-z0-9_]+)\s*:\s*`/gm)].map(m => m[1]);
})();

/* the shipped predicate, character for character */
const sexOk = c => !RACE_SEX || !c || !c.sex || c.sex === RACE_SEX;

console.log('PERSONA RACE-SEX GATE');
console.log('  bank ' + BANK.length + ' rows, RACE_PROFILE.sex ' + (RACE_SEX || 'ABSENT'));

console.log('\nDATA');
gate('RACE_PROFILE declares a sex', RACE_SEX === 'm' || RACE_SEX === 'f', RACE_SEX || 'absent');
const noSex = BANK.filter(c => c.sex !== 'm' && c.sex !== 'f').map(c => c.id);
gate('every row carries sex m or f', noSex.length === 0,
  noSex.length ? noSex.join(', ') : BANK.length + ' rows');

const ids = BANK.map(c => c.id);
gate('no duplicate ids', new Set(ids).size === ids.length, ids.length + ' ids');

/* ART parity is asserted, not assumed. An uncovered row falls through to the generic
   jersey avatar, which is safe but is a silent downgrade. */
if (ART_KEYS) {
  const missing = ids.filter(x => !ART_KEYS.includes(x));
  const orphan = ART_KEYS.filter(x => !ids.includes(x));
  gate('ART key count equals bank id count', ART_KEYS.length === ids.length,
    'ART ' + ART_KEYS.length + ' vs ids ' + ids.length);
  gate('no bank row is missing an emblem', missing.length === 0,
    missing.length ? missing.join(', ') : 'all covered');
  gate('no orphan emblems', orphan.length === 0,
    orphan.length ? orphan.join(', ') : 'none');
} else {
  gate('ART map found', false, 'could not locate ART in vuelta.html');
}

/* ---- the women are PRESENT and UNREACHABLE ---- */
const women = BANK.filter(c => c.sex === 'f');
console.log('\nWOMEN IN THE BANK, kept for a womens race, unreachable here');
women.forEach(c => console.log('    ' + c.tier.padEnd(7) + '  ' + c.id.padEnd(14) + '  ' +
  c.rider + ', ' + c.epithet));
gate('women rows are retained, not deleted', women.length > 0, women.length + ' rows kept');
gate('no woman is drawable in this race', women.every(c => !sexOk(c)),
  women.filter(c => sexOk(c)).map(c => c.id).join(', ') || 'none drawable');

/* ---- headroom, per tier, after the removals ---- */
const cap = t => BANK.filter(c => c.tier === t && sexOk(c)).length;
console.log('\nHEADROOM');
console.log('    drawable ' + BANK.filter(sexOk).length + ' of ' + BANK.length +
  '   winner ' + cap('winner') + '   style ' + cap('style'));
gate('both tiers still have drawable rows', cap('winner') > 0 && cap('style') > 0,
  'winner ' + cap('winner') + ', style ' + cap('style'));

/* ---- the live board ---- */
function getJson(url, headers) {
  return new Promise((res, rej) => {
    https.get(url, { headers: Object.assign({ 'user-agent': 'sexgate/1' }, headers || {}) }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('HTTP ' + r.statusCode)); } });
    }).on('error', rej);
  });
}

(async () => {
  const KEY = process.env.CDF_KEY;
  if (!KEY) {
    console.log('\nLIVE LEDGER  skipped, CDF_KEY not set. The data gates above still ran.');
  } else {
    const ps = await getJson('https://api.coldufantasy.com/api/pool-state?pool=vuelta-2026&stage=14',
      { 'x-cdf-key': KEY });
    const L = (ps.poolDoc || {}).personaLedger || {};
    const by = L.by || {};
    const byId = id => BANK.find(x => x.id === id) || null;
    const seats = Object.keys(by);
    const everWorn = new Set(Object.values(by));
    Object.keys(L.seen || {}).forEach(q => ((L.seen[q]) || []).forEach(id => everWorn.add(id)));

    console.log('\nLIVE LEDGER');
    seats.forEach(s => {
      const c = byId(by[s]);
      console.log('    ' + s + '  ' + String(by[s]).padEnd(14) +
        (c ? (sexOk(c) ? '  ok' : '  FAILS the race-sex filter, ' + c.rider) : '  not in bank'));
    });

    const bad = seats.filter(s => { const c = byId(by[s]); return c && !sexOk(c); });
    /* Expected to FAIL until the board has re-rendered once and written the repaired
       ledger. That is the point: it proves the repair actually RAN, rather than the
       code merely containing a filter. A guard that fails open looks exactly like
       working software, so assert the STATE, not the presence of the rule. */
    gate('no seat holds a failing persona', bad.length === 0,
      bad.length ? bad.map(s => s + ' on ' + by[s]).join(', ') : seats.length + ' seats clean');

    /* headroom against what has ALREADY been worn, which is the number that decides
       whether a forced redraw can actually land */
    const leftW = BANK.filter(c => c.tier === 'winner' && sexOk(c) && !everWorn.has(c.id)).length;
    const leftS = BANK.filter(c => c.tier === 'style' && sexOk(c) && !everWorn.has(c.id)).length;
    console.log('    everWorn ' + everWorn.size + ', unworn drawable: winner ' + leftW + ', style ' + leftS);
    gate('a forced redraw has somewhere to land', leftW > 0 && leftS > 0,
      'winner ' + leftW + ', style ' + leftS);
  }

  console.log('\n' + (fail ? fail + ' gate(s) FAILED.' : 'All gates passed.'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
