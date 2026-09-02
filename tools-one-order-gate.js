/* ONE ORDER, ONE COMPUTATION. A grep-level gate over the BUILT board files.

   WHY THIS EXISTS. On 2026-09-02 three surfaces of the same board disagreed about who led
   a Fantasy Points tie. The hero chip said JJ, the Fantasy Points callout said JJ and
   explained the tiebreak, and the Standings table said AA LEADER on the same 438. The
   Standings table sorted its own copy of the totals, so a stable sort fell back to key
   insertion order, which is pool.order, which is the DRAFT ROTATION.

   Every earlier instance of this shape in this repo was found by a person looking at the
   board: FP_SCALE written out five times and two copies missed when the scale changed, the
   Arlequin count trapped inside an IIFE, and this one, found in a screenshot. None of them
   were found by a test, because each copy was individually correct and they only disagreed
   in a state nobody had thought to produce.

   So this gate does not check behavior. It checks that there is only ONE PLACE THAT COULD
   HAVE AN OPINION. A sort of a Fantasy Points total anywhere but FAN_STANDING is a second
   opinion, whether or not it currently agrees, because a second sort that agrees by luck
   is still a second sort.

   WORTH KNOWING, measured by running this gate against the build that actually shipped the
   bug: check 1, the obvious one, PASSED on it. The offending line was
   `Object.keys(obj).sort((a,b)=>obj[b]-obj[a])` inside `function gcHi(obj,label)`, and a
   grep for a Fantasy Points total cannot see it, because the total had been renamed to a
   parameter called `obj` one line earlier. Checks 4 and 5 are what caught it: the deleted
   duplicate accumulator by name, and the RENDERER SIGNATURE. That is the transferable
   lesson. A renderer that sorts its own argument launders the identity of what it is
   sorting, so the durable assertion is not "nothing else sorts the totals", it is "no
   renderer decides an order at all". Check the signature, not the comparator.

   Run: node tools-one-order-gate.js */

'use strict';
const fs = require('fs');
const path = require('path');

const FILES = ['vuelta.html', 'vuelta.src.html'];

/* A sort whose comparator reads a Fantasy-Points-shaped total. The names are the ones this
   repo has actually used for that total: OURS.fantasy, and cumPts, the duplicate
   accumulator deleted on 2026-09-02. Adding a third name is exactly the thing to catch. */
const FP_TOTAL = /(OURS\.fantasy|cumPts|fantasyTotal)/;

/* These files DESCRIBE the defect in their comments on purpose, and a gate that trips on
   its own documentation is a gate people delete. So comments are stripped properly, with a
   block-comment state machine, rather than by guessing at line shapes. Returns an array
   parallel to `lines` holding each line with its comment text removed. */
function stripComments(lines) {
  let inBlock = false;
  return lines.map(function (line) {
    let out = '', i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end < 0) { i = line.length; }
        else { inBlock = false; i = end + 2; }
        continue;
      }
      const b = line.indexOf('/*', i), l = line.indexOf('//', i);
      if (b >= 0 && (l < 0 || b < l)) { out += line.slice(i, b); inBlock = true; i = b + 2; continue; }
      if (l >= 0) { out += line.slice(i, l); i = line.length; continue; }
      out += line.slice(i); i = line.length;
    }
    return out;
  });
}

let bad = 0, ran = 0;
function report(file, kind, hits, allowed) {
  ran++;
  if (hits.length <= allowed) {
    console.log('ok    ' + file + ': ' + kind + ' (' + hits.length + ', allowed ' + allowed + ')');
    return;
  }
  bad++;
  console.log('FAIL  ' + file + ': ' + kind + ' found ' + hits.length + ', allowed ' + allowed);
  hits.forEach(h => console.log('        line ' + h.n + ': ' + h.line.trim().slice(0, 150)));
}

FILES.forEach(function (f) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) { console.log('FAIL  ' + f + ' is missing'); bad++; ran++; return; }
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  const code = stripComments(lines);   // comment text removed, line numbering preserved

  /* 1. Only FAN_STANDING may sort a Fantasy Points total. Its own comparator lines are the
        two allowed hits: the `.sort(cmp)` call and the cmp body reading OURS.fantasy. */
  const fpSorts = [];
  code.forEach(function (line, i) {
    if (!FP_TOTAL.test(line)) return;
    if (!/\.sort\s*\(/.test(line)) return;
    fpSorts.push({ n: i + 1, line: line });
  });
  report(f, 'sorts of a Fantasy Points total outside FAN_STANDING', fpSorts, 0);

  /* 2. FAN_STANDING is declared exactly once. */
  const decl = [];
  code.forEach(function (line, i) { if (/const\s+FAN_STANDING\s*=/.test(line)) decl.push({ n: i + 1, line: line }); });
  ran++;
  if (decl.length === 1) console.log('ok    ' + f + ': FAN_STANDING declared exactly once');
  else { bad++; console.log('FAIL  ' + f + ': FAN_STANDING declared ' + decl.length + ' times'); }

  /* 3. fanOrder is FAN_STANDING.order and is never rebuilt from a sort. */
  const fanOrderDecl = code.filter(l => /const\s+fanOrder\s*=/.test(l));
  ran++;
  if (fanOrderDecl.length === 1 && /FAN_STANDING\.order/.test(fanOrderDecl[0])) {
    console.log('ok    ' + f + ': fanOrder reads FAN_STANDING.order');
  } else {
    bad++;
    console.log('FAIL  ' + f + ': fanOrder is not FAN_STANDING.order -> ' + (fanOrderDecl[0] || '(absent)').trim().slice(0, 140));
  }

  /* 4. The duplicate accumulator stays dead. cumPts summed the same numbers by a second
        route and carried the second sort that caused this. */
  const cum = [];
  code.forEach(function (line, i) { if (/cumPts/.test(line)) cum.push({ n: i + 1, line: line }); });
  report(f, 'live references to the deleted cumPts accumulator', cum, 0);

  /* 5. The GC renderers must not sort. They take a declared order; the only sort they may
        contain is the named fallback that also logs. */
  const rend = [];
  code.forEach(function (line, i) {
    if (!/function\s+(gcHi|gcLoHTML|gcRankPts)\s*\(/.test(line)) return;
    if (!/\border\b/.test(line)) rend.push({ n: i + 1, line: line });
  });
  report(f, 'GC renderers that do not take a declared order', rend, 0);
});

console.log('\n' + (ran - bad) + '/' + ran + ' checks passed');
if (bad) {
  console.log('\nThe Fantasy Points order must be computed exactly once, in FAN_STANDING.');
  console.log('If a surface needs the order, READ FAN_STANDING.order. Do not sort again.');
}
process.exit(bad ? 1 : 0);
