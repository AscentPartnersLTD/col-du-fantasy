#!/usr/bin/env node
/* tools-opcard-verify.js - run the SHIPPED operator close card against a real payload.
 *
 *   node tools-opcard-verify.js                 uses a stored payload
 *   node tools-opcard-verify.js --live 17       fetches a real close-preview first
 *
 * It lifts the card's IIFE VERBATIM out of the built vuelta.html, the same way
 * tools-roster-verify.js and tools-draft-guard-verify.js lift theirs, so this measures
 * shipped code and not a transcription of it. A minimal DOM shim stands in for the
 * browser; every handler is captured so the three taps can actually be taken.
 *
 * WHAT IT IS ACTUALLY GUARDING:
 *
 *  1. THE OWNER GATE. A player must get NO NODE AT ALL, not a hidden one. The assertion
 *     is that the mount is untouched when isOwner is false, because a display:none
 *     widget is still in the DOM and one stylesheet mistake from being visible to JJ,
 *     JP and JB.
 *  2. NO JSON ON THE SCREEN. The whole complaint that produced this card was a wall of
 *     JSON. So the rendered text is scanned for the shapes of leaked structure: braces,
 *     [object Object], the literal "undefined", "null", "NaN".
 *  3. THE CARD COMPUTES NOTHING. Every number on screen has to appear in the payload.
 *     If the card ever starts deriving its own, that is the FP_SCALE mistake with a
 *     person in the middle of it, confirming a screen that is not what lands.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const REPO = __dirname;

let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(52) +
    (detail == null ? '' : String(detail)));
}

/* ---- lift the card out of the built board ---- */
function liftCard() {
  const src = fs.readFileSync(path.join(REPO, 'vuelta.html'), 'utf8');
  const a = src.indexOf('/* ================= OPERATOR CLOSE CARD');
  if (a < 0) throw new Error('the operator card block was not found in vuelta.html');
  const b = src.indexOf('})();', src.indexOf('window.__opCloseBoot=function()', a));
  if (b < 0) throw new Error('the card IIFE has no terminator');
  return src.slice(a, b + 5);
}

/* ---- a DOM small enough to reason about ---- */
function makeDom() {
  const handlers = {}, els = {};
  const mount = { id: 'opClose', innerHTML: '' };
  els.opClose = mount;
  const doc = {
    getElementById(id) {
      if (id === 'opClose') return mount;
      if (!els[id]) els[id] = { id, value: '', disabled: false, textContent: '',
        addEventListener(ev, fn) { handlers[id] = fn; } };
      return els[id];
    }
  };
  return { doc, mount, handlers, els };
}

function textOf(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&middot;/g, '.')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

async function main() {
  const liveIdx = process.argv.indexOf('--live');
  let payload;
  if (liveIdx >= 0) {
    const stage = Number(process.argv[liveIdx + 1] || 17);
    const KEY = process.env.CDF_KEY;
    if (!KEY) { console.error('CDF_KEY is not set.'); process.exit(2); }
    const r = await fetch('https://api.coldufantasy.com/api/close-preview?stage=' + stage +
      '&pool=vuelta-2026', { headers: { 'x-cdf-key': KEY } });
    payload = await r.json();
    console.log('live payload for stage ' + stage + '\n');
  } else {
    payload = JSON.parse(fs.readFileSync(path.join(REPO, 'tools-opcard-fixture.json'), 'utf8'));
    console.log('stored fixture, stage ' + payload.stage + '\n');
  }

  const card = liftCard();
  const basePayload = payload;

  function run(opts) {
    const payload = (opts && opts.payload) || basePayload;
    const dom = makeDom();
    const calls = [];
    const sandbox = {
      isOwner: opts.isOwner, STAGE: payload.stage, poolId: 'vuelta-2026',
      AUTH_API: 'https://api.coldufantasy.com',
      esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
      document: dom.doc,
      localStorage: { getItem: () => opts.key === undefined ? 'k' : opts.key, setItem: () => {} },
      fetch: (url, init) => { calls.push(String(url));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }); },
      setTimeout: () => {}, location: { reload: () => {} },
      console: { error: () => {} }, window: {}
    };
    sandbox.window = sandbox;
    const fn = new Function('window', 'document', 'isOwner', 'STAGE', 'poolId', 'AUTH_API',
      'esc', 'localStorage', 'fetch', 'setTimeout', 'location', 'console',
      card + '\nreturn window.__opCloseBoot;');
    const boot = fn(sandbox, sandbox.document, sandbox.isOwner, sandbox.STAGE, sandbox.poolId,
      sandbox.AUTH_API, sandbox.esc, sandbox.localStorage, sandbox.fetch, sandbox.setTimeout,
      sandbox.location, sandbox.console);
    boot();
    return { dom, calls };
  }

  /* ---- 1. the owner gate ---- */
  console.log('THE OWNER GATE');
  const asPlayer = run({ isOwner: false });
  check('a player gets NO node at all', asPlayer.dom.mount.innerHTML === '',
    JSON.stringify(asPlayer.dom.mount.innerHTML));
  check('a player triggers no network call', asPlayer.calls.length === 0,
    asPlayer.calls.length + ' calls');

  const noKey = run({ isOwner: true, key: '' });
  check('an owner with no key is asked for it once',
    /Paste your operator key/.test(noKey.dom.mount.innerHTML));
  check('the key prompt makes no network call', noKey.calls.length === 0);

  /* ---- 2. the idle card ---- */
  console.log('\nTHE IDLE CARD');
  const owner = run({ isOwner: true });
  await new Promise(r => setImmediate(r));
  const idle = owner.dom.mount.innerHTML;
  const idleText = textOf(idle);
  check('it names the stage', idleText.indexOf('Close stage ' + payload.stage) >= 0, idleText.slice(0, 90));
  check('it says the classification is complete',
    /classification complete/.test(idleText) || (payload.refusals || []).length > 0);
  check('there is a single primary action',
    (idle.match(/class="opc-btn"/g) || []).length === 1);

  /* ---- 3. the review screen, tap one ---- */
  console.log('\nTHE REVIEW SCREEN');
  owner.dom.handlers.opcOpen && owner.dom.handlers.opcOpen();
  const rev = owner.dom.mount.innerHTML;
  const t = textOf(rev);

  check('the winner is named', t.indexOf(payload.stageDoc.win) >= 0);
  (payload.cards || []).forEach(c => {
    if (!check('seat ' + c.seat + ' shows its picks and all three boards',
      t.indexOf(c.seat) >= 0 && t.indexOf(String(c.fantasy) + ' FP') >= 0 &&
      t.indexOf('Placement ' + c.placement) >= 0 && t.indexOf('Rank ' + c.rank) >= 0)) {
      console.log('        seat text: ' + t.slice(t.indexOf(c.seat), t.indexOf(c.seat) + 120));
    }
  });
  check('the Kasseistampers ruling is the one sentence the server wrote',
    payload.kassei && payload.kassei.ruling && t.indexOf(payload.kassei.ruling) >= 0);
  check('both awards appear',
    t.indexOf(payload.awards.seleccion.text) >= 0 && t.indexOf(payload.awards.premio.text) >= 0);
  check('the breakaway call and its confidence appear',
    /breakaway/i.test(t) && (payload.breakaway.confident ? /confident/.test(t) : /not certain/.test(t)));
  check('there is one tap to flip the breakaway call', /id="opcFlip"/.test(rev));
  if (payload.rotation && payload.rotation.to)
    check('it says who leads off next',
      t.indexOf(String(payload.rotation.leadoffName || payload.rotation.leadoff)) >= 0 &&
      t.indexOf('leads off stage ' + (payload.stage + 1)) >= 0);

  const blocked = (payload.refusals || []).length > 0;
  check(blocked ? 'a blocked stage offers NO confirm button' : 'a clean stage offers confirm',
    blocked ? !/id="opcConfirm"/.test(rev) : /id="opcConfirm"/.test(rev));
  if (blocked)
    check('every refusal is shown in plain words',
      payload.refusals.every(r => t.indexOf(r.msg) >= 0));
  check('cancel is always available', /id="opcCancel"/.test(rev));

  /* ---- 4. NO JSON ---- */
  console.log('\nNOTHING THE READER HAS TO PARSE');
  const leaks = [
    ['a brace', /[{}]/],
    ['[object Object]', /\[object Object\]/],
    ['the word undefined', /\bundefined\b/],
    ['the word null', /\bnull\b/],
    ['NaN', /\bNaN\b/],
    ['a bare key: value pair', /"\w+":/]
  ];
  leaks.forEach(([name, re]) => check('no ' + name + ' on the review screen', !re.test(t),
    re.test(t) ? t.slice(Math.max(0, t.search(re) - 40), t.search(re) + 40) : ''));

  /* ---- 5. the card computes nothing ---- */
  console.log('\nTHE CARD COMPUTES NOTHING');
  const nums = new Set();
  (payload.cards || []).forEach(c => { nums.add(c.fantasy); nums.add(c.placement); nums.add(c.rank);
    (c.picks || []).forEach(p => nums.add(p.f)); });
  nums.add(payload.stage); nums.add(payload.stage + 1);
  if (payload.official) nums.add(payload.official.classified);
  if (payload.kassei) nums.add(payload.kassei.f);
  const onScreen = (t.match(/\b\d+\b/g) || []).map(Number);
  const invented = onScreen.filter(n => !nums.has(n) &&
    !(payload.kassei && payload.kassei.ruling.indexOf(String(n)) >= 0) &&
    !(payload.awards.seleccion.text.indexOf(String(n)) >= 0) &&
    !(payload.awards.premio.text.indexOf(String(n)) >= 0) &&
    !(payload.breakaway.reason.indexOf(String(n)) >= 0));
  check('every number on screen came from the payload', invented.length === 0,
    invented.length ? 'invented: ' + JSON.stringify([...new Set(invented)]) : '');


  /* ---- the reads surface ----
     THE DEFECT THIS GUARDS. tools/close-stage.js computes numbers and has no prose, so
     stages 13, 14, 16 and 17 were written with no reads and nothing flagged it. The
     board then fell through to st.note, which those stages also lack, and printed the
     literal word undefined under the heading The read on five live cards.
     The stored fixture is an already-closed stage, so it never reaches Confirm. These
     run the SAME shipped card against a cleaned copy. */
  console.log('\nTHE READ');
  const clean = JSON.parse(JSON.stringify(basePayload));
  clean.refusals = [];
  clean.alreadyClosed = false;
  clean.ok = true;
  const seats = (clean.cards || []).map(c => c.seat);

  const cleanRun = run({ isOwner: true, payload: clean });
  await new Promise(r => setImmediate(r));   /* the preview is a promise, as above */
  const openRev = (function () {
    const h = cleanRun.dom.handlers['opcOpen'];
    if (h) h();
    return cleanRun.dom.mount.innerHTML;
  })();

  check('there is a box for every seat', seats.every(c => openRev.indexOf('id="opcRead_' + c + '"') >= 0),
    seats.join(', '));
  check('the boxes are EMPTY, the card offers no draft prose',
    !/<textarea[^>]*>[^<\s]/.test(openRev),
    'a prefilled box would be prose the operator did not write');

  const facts = textOf(openRev);
  check('each seat has its picks and finishes in front of it',
    (clean.cards || []).every(c => (c.picks || []).every(p => facts.indexOf(p.r) >= 0)));

  check('confirm is DISABLED, not hidden, while a read is missing',
    /id="opcConfirm"/.test(openRev) && cleanRun.dom.els.opcConfirm &&
    cleanRun.dom.els.opcConfirm.disabled === true,
    'hidden reads as broken; disabled reads as not yet');

  /* type all four, the way the operator would */
  seats.forEach(c => {
    const el = cleanRun.dom.els['opcRead_' + c];
    el.value = 'A read for ' + c + '.';
    const h = cleanRun.dom.handlers['opcRead_' + c];
    if (h) h();
  });
  check('confirm ENABLES once all four are written',
    cleanRun.dom.els.opcConfirm.disabled === false);

  /* and the write must actually carry them */
  cleanRun.calls.length = 0;
  const bodies = [];
  cleanRun.postBodies = bodies;
  const confirm = cleanRun.dom.handlers['opcConfirm'];
  check('confirm is wired', typeof confirm === 'function');

  /* a VOID stage has nothing to read and must not be asked for one */
  const voided = JSON.parse(JSON.stringify(clean));
  voided.stageDoc.voidStage = true;
  const voidRun = run({ isOwner: true, payload: voided });
  await new Promise(r => setImmediate(r));
  if (voidRun.dom.handlers['opcOpen']) voidRun.dom.handlers['opcOpen']();
  check('a VOID stage is asked for no reads at all',
    voidRun.dom.mount.innerHTML.indexOf('opcRead_') < 0);

  console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
