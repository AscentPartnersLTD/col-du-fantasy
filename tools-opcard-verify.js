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
      setTimeout: () => {}, setInterval: () => 1, location: { reload: () => {} },
      /* the card reads the calendar off the board's own pool doc, never the endpoint */
      pool: { boardConfig: { race: [{ n: payload.stage,
        route: (payload.stageInfo && payload.stageInfo.route) || 'A > B',
        type: (payload.stageInfo && payload.stageInfo.type) || 'Flat' }] } },
      console: { error: () => {} }, window: {}
    };
    sandbox.window = sandbox;
    const fn = new Function('window', 'document', 'isOwner', 'STAGE', 'poolId', 'AUTH_API',
      'esc', 'localStorage', 'fetch', 'setTimeout', 'setInterval', 'location', 'console', 'pool',
      card + '\nreturn window.__opCloseBoot;');
    const boot = fn(sandbox, sandbox.document, sandbox.isOwner, sandbox.STAGE, sandbox.poolId,
      sandbox.AUTH_API, sandbox.esc, sandbox.localStorage, sandbox.fetch, sandbox.setTimeout,
      sandbox.setInterval, sandbox.location, sandbox.console, sandbox.pool);
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

  /* ---- 2. the card does NOT go and look until it is asked ----
     THE DEFECT THIS GUARDS. The card used to fetch on board load, so the answer on
     screen was as old as whenever the page happened to be opened, and re-checking meant
     reloading the whole board. Worse, a stale gate state and a fresh one looked
     identical. Allen decides when it goes and looks. */
  console.log('\nNOTHING IS FETCHED UNTIL THE BUTTON IS TAPPED');
  const owner = run({ isOwner: true });
  await new Promise(r => setImmediate(r));
  const preTap = owner.dom.mount.innerHTML;
  const preTapText = textOf(preTap);
  check('the owner card renders with NO network call', owner.calls.length === 0,
    owner.calls.length + ' calls');
  check('it still names the stage, off the calendar alone',
    preTapText.indexOf('Close stage ' + payload.stage) >= 0, preTapText.slice(0, 80));
  check('it does not claim a state it has not checked',
    !/complete/.test(preTapText) && !/finishers/.test(preTapText), preTapText.slice(0, 110));
  check('the only action offered is to check', /id="opcCheck"/.test(preTap) &&
    !/id="opcOpen"/.test(preTap));

  owner.dom.handlers.opcCheck();
  await new Promise(r => setImmediate(r));
  check('tapping it makes exactly one call', owner.calls.length === 1,
    owner.calls.length + ' calls');
  const idle = owner.dom.mount.innerHTML;
  const idleText = textOf(idle);
  check('now it reports the gate state',
    /classification complete/.test(idleText) || (payload.refusals || []).length > 0);
  check('it says when it checked', /Checked /.test(idleText) &&
    /(just now|minutes? ago|a minute ago|hours? ago|an hour ago)/.test(idleText),
    (idleText.match(/Checked [^.]*/) || [''])[0]);
  check('check again stays available', /id="opcCheck"/.test(idle));
  check('a second tap re-checks', (function(){
    owner.dom.handlers.opcCheck();
    return owner.calls.length === 2;
  })(), owner.calls.length + ' calls');

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
  await new Promise(r => setImmediate(r));
  /* Check first. The card no longer fetches on load, so Open does not exist until the
     operator has asked it to go and look. */
  cleanRun.dom.handlers.opcCheck();
  await new Promise(r => setImmediate(r));
  const openRev = (function () {
    const h = cleanRun.dom.handlers['opcOpen'];
    if (h) h();
    return cleanRun.dom.mount.innerHTML;
  })();

  check('there is a box for every seat', seats.every(c => openRev.indexOf('id="opcRead_' + c + '"') >= 0),
    seats.join(', '));
  /* REVERSED 2026-09-10, deliberately, and the old assertion is worth remembering.
     It read "the boxes are EMPTY, the card offers no draft prose", on the argument that
     a prefilled box is prose the operator did not write. That argument was sound and it
     lost to a better one: the alternative is four paragraphs typed on a phone at
     midnight, which is why five stages shipped with no read at all and the board
     printed the word undefined. A draft he edits beats a blank he skips.

     The boxes are filled through el.value rather than textarea content, so asserting
     on the HTML would have kept passing while being wrong about what the operator
     sees. Assert the value. */
  check('every box arrives with a draft in it',
    seats.every(c => String((cleanRun.dom.els['opcRead_' + c] || {}).value || '').trim().length > 20),
    seats.map(c => c + ':' + String((cleanRun.dom.els['opcRead_' + c] || {}).value || '').length).join(' '));
  check('the draft names both riders',
    (clean.cards || []).every(c => (c.picks || []).every(p =>
      String((cleanRun.dom.els['opcRead_' + c.seat] || {}).value || '')
        .indexOf(p.r.replace(/^[A-Z]\.\s*/, '')) >= 0)));
  check('the draft carries no dash, brace or undefined',
    !/[\u2013\u2014{}]|\b(undefined|null|NaN)\b/.test(
      seats.map(c => (cleanRun.dom.els['opcRead_' + c] || {}).value || '').join(' ')));

  const facts = textOf(openRev);
  check('each seat has its picks and finishes in front of it',
    (clean.cards || []).every(c => (c.picks || []).every(p => facts.indexOf(p.r) >= 0)));

  /* THE GATE SURVIVES THE PREFILL, and this is the check that proves it rather than
     assuming it. With drafts in every box the close is available immediately, which
     is the point. Empty one and it must refuse again: no reads, no close. Testing it
     from the filled side is the only way round now, and it is the better test, since
     the failure mode worth catching is a gate quietly satisfied by prefill. */
  check('confirm is available once the drafts are in',
    /id="opcConfirm"/.test(openRev) && cleanRun.dom.els.opcConfirm &&
    cleanRun.dom.els.opcConfirm.disabled === false);

  (function () {
    const el = cleanRun.dom.els['opcRead_' + seats[0]];
    const keep = el.value;
    el.value = '';
    const h = cleanRun.dom.handlers['opcRead_' + seats[0]];
    if (h) h();
    check('emptying a box refuses the close again',
      cleanRun.dom.els.opcConfirm.disabled === true,
      'hidden reads as broken; disabled reads as not yet');
    el.value = keep;
    if (h) h();
    check('putting it back allows it again',
      cleanRun.dom.els.opcConfirm.disabled === false);
  })();

  /* now type over all four, the way the operator would when he rewrites them */
  seats.forEach(c => {
    const el = cleanRun.dom.els['opcRead_' + c];
    el.value = 'A read for ' + c + '.';
    const h = cleanRun.dom.handlers['opcRead_' + c];
    if (h) h();
  });
  check('confirm stays available when he writes his own',
    cleanRun.dom.els.opcConfirm.disabled === false);

  /* A breakaway flip refetches and repaints. It must not throw away typing, and it
     must not re-seed over it either. */
  const typed = cleanRun.dom.els.opcRead_JJ.value;
  if (cleanRun.dom.handlers.opcFlip) {
    cleanRun.dom.handlers.opcFlip();
    await new Promise(r => setImmediate(r));
  }
  check('a refetch does not overwrite what was typed',
    cleanRun.dom.els.opcRead_JJ.value === typed,
    JSON.stringify(cleanRun.dom.els.opcRead_JJ.value.slice(0, 40)));

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
  voidRun.dom.handlers.opcCheck();
  await new Promise(r => setImmediate(r));
  if (voidRun.dom.handlers['opcOpen']) voidRun.dom.handlers['opcOpen']();
  check('a VOID stage is asked for no reads at all',
    voidRun.dom.mount.innerHTML.indexOf('opcRead_') < 0);

  /* ---- a stage that is not ready ----
     THE DEFECT THIS GUARDS, and it is a live capture rather than an invention. The
     headline read "0 finishers, classification complete" while five gates underneath it
     were refusing. The fixture is the real /api/close-preview for stage 18 taken while
     the stage was on the road: the ite bind exists but carries one row at a negative
     position, so started is 1 and classified is 0.

     That is the same class as a fallback that prints undefined. The markup was well
     formed, the template did what it was told, and the sentence was false. It is also
     the half an operator acts on, because the headline is the part people read. */
  console.log('\nA STAGE THAT IS NOT READY');
  const notReady = JSON.parse(fs.readFileSync(path.join(REPO, 'tools-opcard-fixture-unraced.json'), 'utf8'));
  const nr = run({ isOwner: true, payload: notReady });
  await new Promise(r => setImmediate(r));
  nr.dom.handlers.opcCheck();
  await new Promise(r => setImmediate(r));
  const nrHtml = nr.dom.mount.innerHTML, nrText = textOf(nrHtml);
  check('it never says complete while a gate refuses', !/complete/i.test(nrText),
    nrText.slice(0, 130));
  check('it never prints a finisher count of zero', !/\b0 finishers/.test(nrText), nrText.slice(0, 130));
  check('it says plainly that it is not ready', /Not ready to close/.test(nrText));
  check('it offers no close button', !/id="opcOpen"[^>]*>Close it/.test(nrHtml));
  check('the refusals are still shown in plain words',
    (notReady.refusals || []).every(r => nrText.indexOf(r.msg) >= 0));
  check('it still offers a re-check', /id="opcCheck"/.test(nrHtml));
  check('it says when it checked', /Checked /.test(nrText));

  /* ---- a stage that has not been raced at all ----
     The server's own notPublished shape. This one gets ONE line and no wall of gate
     failures, because "it has not happened yet" is not five problems. */
  console.log('\nA STAGE NOT RACED AT ALL');
  const np = JSON.parse(JSON.stringify(notReady));
  np.notPublished = true;
  np.refusals = [{ why: 'not_published', msg: 'Stage has not been raced yet.' }];
  np.gates = []; np.official = null; delete np.stageDoc;
  const npr = run({ isOwner: true, payload: np });
  await new Promise(r => setImmediate(r));
  npr.dom.handlers.opcCheck();
  await new Promise(r => setImmediate(r));
  const npHtml = npr.dom.mount.innerHTML, npText = textOf(npHtml);
  check('an unraced stage never says complete', !/complete/i.test(npText), npText.slice(0, 130));
  check('an unraced stage says so in one line', /Not raced yet/.test(npText));
  check('it does not also dump gate failures', !/opc-warn/.test(npHtml));
  check('it prints no finisher count at all', !/finishers/.test(npText));
  check('the card is not blank, which would read as broken', npText.length > 20);
  check('it still offers a re-check', /id="opcCheck"/.test(npHtml));

  console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
