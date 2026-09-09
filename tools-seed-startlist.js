#!/usr/bin/env node
/* tools-seed-startlist.js - push the bib table into Firestore, once per race.
 *
 *   node tools-seed-startlist.js              seed vuelta-2026 from vuelta.src.html
 *   node tools-seed-startlist.js --check      read back what is stored, write nothing
 *
 * WHY. Every consumer of the bib table used to need a current clone of this repo,
 * because RIDERS is read by string-matching a line out of the built board on local disk.
 * That is the stale-clone dependency in its worst form: a clone that is behind does not
 * report staleness, it reports a DIFFERENT STARTLIST, and a wrong bib is silent and
 * total. It does not error, it does not look wrong, it just hands one rider another
 * rider's finish.
 *
 * So the server keeps one copy, with its own provenance, and THIS is the only thing that
 * ever reads the repo for it. Run it when RIDERS changes, which for a grand tour is
 * once, at launch, plus any correction like the 103/104 bib swap of 2026-08-27.
 *
 * The board is NOT changed by this. RIDERS stays inline and stays the source; this
 * publishes it.
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname);
const BOARD = 'vuelta.src.html';
const RACE_ID = 'vuelta-2026';
const API = 'api.coldufantasy.com';

function req(method, pathname, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = https.request({
      hostname: API, path: pathname, method,
      headers: Object.assign({ 'user-agent': 'seed-startlist/1' },
        data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
        headers || {})
    }, x => {
      let d = '';
      x.on('data', c => d += c);
      x.on('end', () => resolve({ status: x.statusCode, body: d }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function readBoard() {
  const src = fs.readFileSync(path.join(REPO, BOARD), 'utf8');

  const rl = src.split('\n').find(l => l.startsWith('const RIDERS = ['));
  if (!rl) throw new Error('RIDERS array not found in ' + BOARD);
  const riders = JSON.parse(rl.slice(rl.indexOf('['), rl.lastIndexOf(']') + 1));

  const marker = 'const BELGIAN_RIDERS=[';
  const bi = src.indexOf(marker);
  let national = [];
  if (bi >= 0) {
    const blk = src.slice(bi, src.indexOf('];', bi));
    national = Array.from(blk.matchAll(/\{r:"([^"]+)"/g)).map(m => m[1]);
  }

  /* provenance travels WITH the data, so the age of the capture and the age of the
     AUDIT are both visible on the server, not just in the board file */
  const pl = src.split('\n').find(l => l.trim().startsWith('startlist:{'));
  const grab = k => { const m = pl && pl.match(new RegExp(k + ":'([^']*)'")); return m ? m[1] : null; };

  return {
    riders, national,
    source: grab('source'), captured: grab('captured'), audited: grab('audited'),
    declaredCount: pl && Number((pl.match(/count:(\d+)/) || [])[1])
  };
}

async function main() {
  const KEY = process.env.CDF_KEY;
  if (!KEY) {
    console.error('CDF_KEY is not set. It is the same secret the API calls SCORE_KEY.');
    process.exit(2);
  }
  const check = process.argv.includes('--check');

  if (check) {
    const r = await req('GET', '/api/startlist?raceId=' + RACE_ID, null, { 'x-cdf-key': KEY });
    console.log('stored: ' + r.status + '  ' + r.body);
    return;
  }

  const t = readBoard();
  console.log('read from ' + BOARD);
  console.log('  riders            ' + t.riders.length +
    (t.declaredCount ? '  (profile declares ' + t.declaredCount + ')' : ''));
  console.log('  national roster   ' + t.national.length);
  console.log('  captured ' + t.captured + ', audited ' + t.audited);

  /* The declared count and the real one must agree. They are two independent statements
     about the same thing, and a race launch that edits one and not the other is exactly
     the drift this repo keeps finding. */
  if (t.declaredCount && t.declaredCount !== t.riders.length)
    throw new Error('RACE_PROFILE.startlist.count is ' + t.declaredCount +
      ' but RIDERS holds ' + t.riders.length + '. Reconcile before seeding.');

  const bibs = new Set(t.riders.map(r => String(r.b)));
  if (bibs.size !== t.riders.length)
    throw new Error('duplicate bibs in RIDERS: ' + t.riders.length + ' rows, ' + bibs.size + ' bibs');

  const missing = t.national.filter(n => !t.riders.some(r => r.r === n));
  if (missing.length)
    throw new Error('national roster names that do not resolve against RIDERS: ' + missing.join(', '));
  console.log('  all ' + t.national.length + ' national names resolve against RIDERS');

  const r = await req('POST', '/api/startlist', {
    key: KEY, raceId: RACE_ID, riders: t.riders, national: t.national,
    captured: t.captured, audited: t.audited, source: t.source
  });
  console.log('\nPOST /api/startlist -> ' + r.status + '  ' + r.body);
  if (r.status !== 200) process.exit(1);

  const back = await req('GET', '/api/startlist?raceId=' + RACE_ID, null, { 'x-cdf-key': KEY });
  console.log('read back           -> ' + back.status + '  ' + back.body);
}

main().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
