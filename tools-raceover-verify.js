#!/usr/bin/env node
/* tools-raceover-verify.js - RACE_OVER, on BOTH boards.
 *
 *   node tools-raceover-verify.js
 *
 * WHY IT COVERS BOTH. The Vuelta got RACE_OVER on 2026-09-13 and the Tour did not, so a
 * finished Tour went on showing a stage 22 draft card, a stage 22 Captain 'Merica picker,
 * today's order and a live break check, on two pools, for two months. Nothing caught it
 * because `tools-validate-build.js` reads ONE file: `const BUILT = {'vuelta.html': ...}`.
 * A gate that looks at one of two boards cannot see the board that is wrong.
 *
 * TWO HALVES.
 *  1. THE DERIVATION IS EXECUTED, lifted verbatim out of each BUILT board and run against
 *     synthetic pools. That is the half that can be wrong arithmetically.
 *  2. THE CONSUMERS ARE ASSERTED PRESENT AND FIRST. A guard that renders the card and then
 *     returns is not a guard, so each one must be the opening statement of its function.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const REPO = __dirname;

let fails = 0, ran = 0;
function check(label, ok, detail) {
  ran++; if (!ok) fails++;
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(56) +
    (detail == null ? '' : String(detail)));
}

/* ---- lift the derivation out of a built board and make it callable ---- */
function liftDerivation(src, file) {
  const a = src.indexOf('const _rr=(pool.boardConfig&&Array.isArray(pool.boardConfig.race))');
  if (a < 0) throw new Error('no RACE_OVER derivation in ' + file);
  const PUB = 'window.__RACE_OVER=RACE_OVER;';
  const b = src.indexOf(PUB, a);
  if (b < 0) throw new Error('derivation in ' + file + ' never publishes on window');
  /* The slice INCLUDES the publish line. The first version stopped just short of it and
     then asserted the publish had happened, which failed on a board that does it
     correctly: a test that excludes the thing it checks for. */
  const body = src.slice(a, b + PUB.length);
  /* Executed, not transcribed: the text between those two markers is exactly what ships. */
  return new Function('pool', 'STAGE', 'RACE_PROFILE', 'window',
    body + '\nreturn { RACE_OVER: RACE_OVER, lastStage: _lastStage, rr: _rr };');
}

const cal = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, route: 'x' }));

const BOARDS = [
  { file: 'tour.html', race: 'Tour', order: 'placeOrder', pickers: ['mericaMount'] },
  { file: 'vuelta.html', race: 'Vuelta', order: 'fanOrder', pickers: ['kasseiMount'] },
];

for (const B of BOARDS) {
  const src = fs.readFileSync(path.join(REPO, B.file), 'utf8');
  console.log('\n' + B.file.toUpperCase() + '  (' + B.race + ')');

  /* ---------------------------------------------------- 1. the arithmetic ---- */
  let derive;
  try { derive = liftDerivation(src, B.file); }
  catch (e) { check('the derivation ships', false, e.message); continue; }
  check('the derivation ships and is callable', true);

  const win = {};
  const RP = { stageCount: 21 };

  let r = derive({ boardConfig: { race: cal(21) } }, 22, RP, win);
  check('a finished race is over', r.RACE_OVER === true, 'startStage 22 past a 21 row calendar');
  check('and it publishes on window', win.__RACE_OVER === true);

  r = derive({ boardConfig: { race: cal(21) } }, 10, RP, win);
  check('a running race is NOT over', r.RACE_OVER === false, 'startStage 10');

  r = derive({ boardConfig: { race: cal(21) } }, 21, RP, win);
  check('the final stage itself is NOT over', r.RACE_OVER === false,
    'the last stage is still a stage');

  /* The second half of the test is what stops a running race being declared finished
     the moment somebody is late extending the calendar. */
  const withRow22 = cal(21).concat([{ n: 22, route: 'a late addition' }]);
  r = derive({ boardConfig: { race: withRow22 } }, 22, RP, win);
  check('a calendar row for this stage keeps the race alive', r.RACE_OVER === false,
    'the !_rr half, which is the whole point of it');

  /* THE stageCount FALLBACK IS TOUR-ONLY, and deliberately so. The Vuelta pool has a
     calendar and never needed one; adding it there would be a second record of the stage
     count on a board that does not use it. So this asserts the Tour HAS it and the Vuelta
     has NOT, rather than asserting one board's property against both. */
  r = derive({ boardConfig: {} }, 22, RP, win);
  if (B.race === 'Tour') {
    check('with no calendar it falls back to stageCount', r.RACE_OVER === true,
      'lastStage ' + r.lastStage);
    r = derive({ boardConfig: {} }, 10, RP, win);
    check('and the fallback does not end a running race', r.RACE_OVER === false);
  } else {
    check('it has NO stageCount fallback, which is correct here', r.RACE_OVER === false,
      'the Vuelta pool has a calendar; a fallback would be a second record of the count');
  }

  /* No calendar AND no stage count: it must never guess. */
  r = derive({ boardConfig: {} }, 22, {}, win);
  check('with neither calendar nor stageCount it stays OPEN', r.RACE_OVER === false,
    'lastStage 0, so it refuses to declare anything finished');

  /* A real calendar must win over the fallback, or the two could disagree. */
  r = derive({ boardConfig: { race: cal(18) } }, 20, { stageCount: 21 }, win);
  check('a real calendar beats any fallback', r.RACE_OVER === true && r.lastStage === 18,
    'lastStage ' + r.lastStage + ', not the profile 21');

  /* ------------------------------------------------- 2. the consumers -------- */
  const fn = (name) => {
    const i = src.indexOf('function ' + name + '(){');
    return i < 0 ? '' : src.slice(i, i + 1400);
  };

  const draft = fn('renderDraft');
  check('the draft card guards FIRST', /function renderDraft\(\)\{[\s\S]{0,700}?if\(window\.__RACE_OVER\)\{/.test(draft)
    && draft.indexOf('__RACE_OVER') < draft.indexOf('draft.picks'),
    'before it reads the draft, or it is not a guard');
  check('and it builds a banner, not a form',
    /The racing is done/.test(draft) && !/searchRow|seedbar/.test(draft.slice(0, draft.indexOf('return;') + 8)));

  const picker = B.pickers[0];
  const pfn = src.indexOf('function render' + (B.race === 'Tour' ? 'Merica' : 'Kassei') + '(){');
  const pbody = pfn < 0 ? '' : src.slice(pfn, pfn + 800);
  check('the ' + (B.race === 'Tour' ? "Captain 'Merica" : 'Kasseistampers') + ' picker is removed',
    /if\(window\.__RACE_OVER\)\{/.test(pbody) && pbody.indexOf(picker) > 0 && /\.remove\(\)/.test(pbody),
    'no chips are built, so there is nothing to tap');

  /* THE WINDOW WIDENED on 2026-11-19 because a SECOND guard moved in beside this one:
     a demo pool hides the same card for the same reason. The two are asserted together
     rather than the window simply being loosened, so a guard that wanders away from
     the reveal still fails. */
  check('the live break check never reveals itself',
    /if\(CDF\.raceOver===true\)\{ return; \}[\s\S]{0,700}CARD\.style\.display/.test(src),
    'the feed would answer with a frozen snapshot');
  check('and a demo pool hides it too',
    /if\(CDF\.demo===true\)\{ return; \}[\s\S]{0,120}CARD\.style\.display/.test(src),
    'a demo is a finished race frozen at one stage');

  check("Today's Order names the champion", /RACE_OVER\|\|!UPCOMING/.test(src));
  check('and it orders by this race own system of record',
    new RegExp('\\$\\{' + B.order + '\\.map').test(src),
    B.order);

  check('the weather card retires', /if\(RACE_OVER\|\|!W\)\{/.test(src));
  check('the Next Two card retires', /if\(RACE_OVER\|\|!U\)\{/.test(src));

  /* THE EIGHTH CONSUMER, and the one the first pass missed. It is a bare top-level
     `if(up){` wrapping the phantom ledger card rather than a guard inside a function,
     so counting functions did not find it. Without it `up.picks` throws inside
     __runBoard and ABORTS THE REST OF THE BLOCK: measured live on tour.html, Today's
     Order rendered empty and the Next Two card showed its own stylesheet as text. */
  check('the phantom ledger card is wrapped in if(up)',
    /const up=UPCOMING;\s*if\(up\)\{/.test(src)
    && /end if\(up\)/.test(src),
    'a null upcoming must not reach up.picks');

  /* TYPEOF IS NOT A NULL CHECK, and this is the check that would have caught it.
     `typeof UPCOMING!=='undefined' && UPCOMING.n` reads as a guard and is not one:
     typeof null is 'object', so the first term is TRUE on a finished race and the
     second throws. It is the twin of the temporal-dead-zone lesson in CLAUDE.md,
     where typeof on a TDZ let throws rather than returning 'undefined'. The pattern
     was correct while the only risk was a LATER script block, where UPCOMING really is
     out of scope; RACE_OVER added a third state, in scope and null, it never covered. */
  const bareTypeof = (src.match(/typeof UPCOMING!=='undefined'&&UPCOMING\.[a-z]/g) || []);
  /* Both boards now. The Vuelta's three typeof-only reads were fixed 2026-11-18, the flip the earlier note promised. */
  check('no UPCOMING read is guarded by typeof alone', bareTypeof.length === 0,
    bareTypeof.length ? bareTypeof.join(' | ') : 'every one also tests for null');

  check('one wording, in one place',
    /const RACE_OVER_LINE = RACE_PROFILE\.name \+ ' ' \+ RACE_PROFILE\.year \+ ' is complete\.'/.test(src));
  check('upcoming is nulled, which is the null the stale guards tested for',
    /const upcoming=RACE_OVER\?null:\{/.test(src));
  check('nothing writes a flag to Firestore',
    !/raceOver['"]?\s*:\s*true[\s\S]{0,40}(set|update)\(/.test(src),
    'it is derived every load');
}

console.log('\n' + (ran - fails) + '/' + ran + ' checks passed');
process.exit(fails ? 1 : 0);
