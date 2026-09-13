#!/usr/bin/env node
/* tools-undefined-sweep.js - find interpolations that can render the word "undefined".
 *
 *   node tools-undefined-sweep.js                 sweep every built board
 *   node tools-undefined-sweep.js vuelta.html     sweep one file
 *   node tools-undefined-sweep.js --all           also list the advisory reads
 *
 * WHY THIS EXISTS. Twice the same defect has shipped. "The read undefined" sat on five
 * stage cards for about two weeks, and `${r.extra}` printed down the Note column of Full
 * Results on 15 of 21 rows for the whole race. Both were invisible to every structural
 * check, because the markup is perfectly well formed and the template did exactly what it
 * was told: an absent field stringifies to a five-letter word instead of throwing.
 *
 * WHY IT IS NOT A GREP, which CLAUDE.md already warned about. A static grep of the built
 * file is useless: the file legitimately contains `typeof x === 'undefined'`, and THE
 * DEFECT DOES NOT EXIST IN THE SOURCE TEXT AT ALL. It only appears once a template is
 * evaluated against a document that is missing a field. So this tool never looks for the
 * word. It looks for the SHAPE that produces it, then asks the DATA whether that shape
 * can actually fire.
 *
 * THE TWO TIERS, and the reason for them. The first version of this tool flagged every
 * bare member read and reported 147 of them in one file, which is a gate nobody runs. The
 * noise was all locally-built objects, where the field is always present. So:
 *
 *   PROVEN   the read is unguarded AND tools-undefined-fixture.json shows that field is
 *            absent from some real documents. This FAILS the gate. It is not a heuristic:
 *            the fixture counts say how many documents render the word.
 *   ADVISORY the read is unguarded but the fixture does not cover that object. Listed,
 *            never failed. Advisory means UNKNOWN, not safe.
 *
 * WHAT IT IS NOT. This is not the render-time sweep. A render pass over real documents is
 * still the only thing that proves a field was absent at a particular render site, and it
 * belongs on a signed-in board or behind fixtures. THIS tool is the cheaper half and runs
 * in CI with no browser and no sign-in: it finds the shape at the source, which is where
 * the fix goes. The two are complementary and neither replaces the other.
 *
 * THE RULE IT ENFORCES, from CLAUDE.md: the last link in a fallback chain must be a
 * literal, an empty string, or a branch that emits nothing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = __dirname;
const DEFAULT_FILES = ['vuelta.html', 'tour.html', 'board.html'];

/* ------------------------------------------------------------------ guards -- */

/* Calls confirmed to handle null and undefined. esc() at the top of the first board
   block is String(s==null?'':s), so it is both the escaper and the terminal guard.
   NOTE the board carries a SECOND esc, in the rest-day block, which was a bare
   String(s) until 2026-09-13 and turned undefined into the word. Read a function
   before adding it here. */
const GUARD_CALLS = new Set([
  'esc', 'esc2', 'Number', 'String', 'parseInt', 'parseFloat'
]);

/* Roots that are board CONSTANTS or engine state, never a document with optional
   fields. A read on one of these cannot be an absent Firestore field. */
const SAFE_ROOTS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Date', 'document', 'window',
  'RACE_PROFILE', 'FP_SCALE', 'JERSEY_ICONS', 'ART', 'PERSONA_BANK', 'TEAMS23',
  'RIDERS', 'SEATS', 'PL4', 'PL', 'ORDER', 'COMPLETED'
]);

/* ----------------------------------------------------- template-literal scan -- */

/* Inline <script> blocks with no src. The sweep is over the BUILT file, so it measures
   what ships rather than a transcription of it, the same way the roster and tiebreak
   verifiers lift their subjects out of vuelta.html. */
function scriptBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    out.push({ code: m[2], offset: m.index + m[0].indexOf(m[2]) });
  }
  return out;
}

/* Walk the code tracking strings, comments and template nesting, and return every
   `${ ... }` interpolation. Written as a scanner rather than a regex because
   interpolations nest: a template inside a `${}` inside a template is ordinary on this
   board, and a regex cannot balance it. */
/* FIND INTERPOLATIONS DIRECTLY, WITHOUT LEXING THE WHOLE FILE.
   The first version of this scanner tracked strings, comments, regex literals and
   template nesting across a 422KB block so it could say "this ${ is inside a template".
   It desynced twice, each time SILENTLY SKIPPING a region and reporting the rest as
   clean, which is exactly the fail-open shape this gate exists to catch. Two separate
   causes were found and fixed and a third remained.

   THE INSIGHT THAT REMOVED THE PROBLEM RATHER THAN PATCHING IT: `${` is essentially
   unambiguous in JavaScript source. It is a template interpolation or it is nothing.
   So the template state was never needed. Scanning for `${` and balancing to its `}` is
   both simpler and strictly more complete, and it cannot lose its place, because there is
   no place to lose: every candidate is found independently of every other.

   The cost is that a literal `${` inside an ordinary quoted string would be picked up.
   That is rare, and it lands in the ADVISORY tier rather than failing the gate, so the
   error is one line of noise and never a false failure. */
/* BLANK OUT BLOCK COMMENTS BEFORE LOOKING FOR INTERPOLATIONS.
   A GATE MUST NOT READ ITS OWN PROSE. This tool reported a defect against the sentence
   explaining that defect: a board comment documenting the old broken line quoted it
   verbatim, `${st.reads ? ... : st.note}`, and the sweep found the quotation. CLAUDE.md
   already records the same mistake in the guest verifier, which matched its own comment
   saying a thing was GONE and concluded the thing was present.

   Only block comments are masked, and only when the closing delimiter exists. Line comments
   are deliberately NOT masked: `//` appears inside every https:// string on the board, so
   masking it would blank real code to end of line, and hiding a real interpolation is a
   FAIL-OPEN miss where a stray comment match is merely noise. Lengths are preserved so
   every reported offset still maps to the right line. */
function maskBlockComments(code) {
  let out = code, from = 0, masked = 0;
  for (;;) {
    const a = out.indexOf('/*', from);
    if (a < 0) break;
    const b = out.indexOf('*/', a + 2);
    if (b < 0) break;                       /* unterminated: mask nothing, never to EOF */
    const span = out.slice(a, b + 2).replace(/[^\n]/g, ' ');
    out = out.slice(0, a) + span + out.slice(b + 2);
    from = b + 2;
    masked++;
  }
  return out;
}

function interpolations(rawCode) {
  const code = maskBlockComments(rawCode);
  const out = [];
  let i = 0, unbalanced = 0;
  while ((i = code.indexOf('${', i)) >= 0) {
    const start = i + 2;
    let d = 1, j = start;
    while (j < code.length && d > 0) {
      const ch = code[j], nx = code[j + 1];
      if (ch === '\\') { j += 2; continue; }
      /* COMMENTS INSIDE THE EXPRESSION ARE SKIPPED. Several interpolations on this board
         are IIFEs carrying explanatory block comments, and those comments contain
         apostrophes and quotes. Without this the quote opened a phantom string and the
         candidate failed to balance, which lost one real interpolation per occurrence. */
      if (ch === '/' && nx === '*') { const e = code.indexOf('*/', j + 2); j = e < 0 ? code.length : e + 2; continue; }
      if (ch === '/' && nx === '/') { while (j < code.length && code[j] !== '\n') j++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch; j++;
        while (j < code.length && code[j] !== q) { if (code[j] === '\\') j++; j++; }
        j++; continue;
      }
      if (ch === '{') d++;
      else if (ch === '}') d--;
      j++;
    }
    /* AN UNBALANCED CANDIDATE SKIPS ITSELF AND IS COUNTED. It must never `break`: that
       abandons the rest of the file and reports everything after it as clean, which is
       the same silent truncation twice over. The count is surfaced so an unreadable file
       announces itself instead of passing quietly. */
    if (d !== 0) { unbalanced++; i = start; continue; }
    out.push({ expr: code.slice(start, j - 1), index: start, end: j - 1 });
    /* ADVANCE PAST THIS `${`, NOT PAST ITS WHOLE SPAN. Jumping to the close skips every
       NESTED interpolation, and this board nests constantly: a card template holds a
       `${...}` whose expression is itself a template with more `${...}` inside. Skipping
       the span dropped the count from 332 to 76, which is the same silent under-reading
       the old lexer produced, arrived at from the other direction. Every `${` is now
       examined on its own; an outer expression simply contains its children, and the
       classifier returns advisory for those rather than a false failure. */
    i = start;
  }
  return { list: out, desync: unbalanced > 0, depth: unbalanced, open: 0 };
}

/* ---------------------------------------------------------------- verdicts -- */

/* Split a ternary at the TOP level, so `a ? b : c` is judged on both RESULTS rather than
   on the condition. "The read undefined" was exactly a ternary whose false branch was an
   unguarded member read, so judging the condition would have missed it. */
function topLevelTernary(e) {
  let d = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === '?' && d === 0 && e[i + 1] !== '.' && e[i + 1] !== '?') {
      let d2 = 0;
      for (let j = i + 1; j < e.length; j++) {
        const k = e[j];
        if (k === '(' || k === '[' || k === '{') d2++;
        else if (k === ')' || k === ']' || k === '}') d2--;
        else if (k === '?') d2++;
        else if (k === ':' && d2 === 0) return [e.slice(i + 1, j), e.slice(j + 1)];
      }
    }
  }
  return null;
}

/* Judge only the LAST alternative of a || / ?? chain. That is the terminal link, and the
   only one that reaches the page when everything before it is absent. */
function lastAlternative(e) {
  let d = 0, last = 0, found = false;
  for (let i = 0; i < e.length - 1; i++) {
    const c = e[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (d === 0 && ((c === '|' && e[i + 1] === '|') || (c === '?' && e[i + 1] === '?'))) { last = i + 2; found = true; i++; }
  }
  return found ? e.slice(last) : null;
}

/* Returns the unguarded field read, or null when the expression protects itself. */
function unguarded(raw) {
  const e = String(raw).trim();
  if (!e) return null;
  if (/^(['"`])[\s\S]*\1$/.test(e) || /^-?[\d.]+$/.test(e) || /^(true|false|null)$/.test(e)) return null;

  const t = topLevelTernary(e);
  if (t) return unguarded(t[0]) || unguarded(t[1]);

  const alt = lastAlternative(e);
  if (alt !== null) return unguarded(alt);

  /* A call returns whatever it chose to return. Guarding calls are safe; other calls are
     out of scope for this gate, which is about FIELD READS. */
  if (/^([A-Za-z_$][\w$.]*)\s*\(/.test(e)) return null;

  /* Optional chaining still yields undefined, so `a?.b` is NOT a guard by itself. */
  const m = e.match(/^([A-Za-z_$][\w$]*)\s*\??\s*[.[]/);
  if (m && /^[\w$]+(\s*\??\s*\.\s*[\w$]+|\s*\[[^\]]+\])+$/.test(e)) {
    if (SAFE_ROOTS.has(m[1])) return null;
    return e;
  }
  return null;
}

/* ---------------------------------------------------------------- fixtures -- */

/* Bind callback parameters to a collection: RACE.map(r=>...) makes `r` a race row. This
   is what lets the sweep say a read is PROVEN unsafe rather than merely bare. */
function bindParams(code, fixture) {
  const bound = {};
  const roots = {};
  Object.keys(fixture.bindings).forEach(coll => {
    if (coll.startsWith('_')) return;
    fixture.bindings[coll].forEach(id => { roots[id] = coll; });
  });

  const re = /([A-Za-z_$][\w$]*)\s*(?:\.[\w$]+\s*)*\.\s*(?:map|forEach|filter|find|flatMap|some|every|sort|reduce)\s*\(\s*(?:function\s*)?\(?\s*([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(code))) { const coll = roots[m[1]]; if (coll) bound[m[2]] = coll; }

  const re2 = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*(?:find|filter)\s*\(/g;
  while ((m = re2.exec(code))) { const coll = roots[m[2]]; if (coll) bound[m[1]] = coll; }

  /* FIELDS PROVEN PRESENT BY AN UPSTREAM FILTER.
         const watch = S.filter(s => s.kassei && s.kassei.top);
         ... watch.map(s => `... ${s.kassei.top} ...`)
     The render site has no guard of its own and looks exactly like the defect, but the
     collection it iterates cannot contain a document without that field. Without this the
     tool reported a false failure against a site that cannot fire. The rule is deliberately
     narrow: only a `.filter()` whose callback tests `param.field` on the SAME parameter,
     and only for the variable that filter is assigned to. */
  const guaranteed = {};
  const re3 = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*\.\s*filter\s*\(\s*(?:function\s*)?\(?\s*([A-Za-z_$][\w$]*)\)?\s*=>\s*([^;]{0,200})/g;
  while ((m = re3.exec(code))) {
    const target = m[1], param = m[2], body = m[3];
    const fields = new Set();
    const fre = new RegExp('\\b' + param + '\\.([\\w$]+)', 'g');
    let f;
    while ((f = fre.exec(body))) fields.add(f[1]);
    if (fields.size) guaranteed[target] = fields;
  }
  /* THE SAME GUARD WRITTEN AS forEach + push, which is the Tour board's idiom:
         S.forEach(s=>{ if(s.merica && s.merica.top){ watch.push(s); ... } });
         ... watch.map(s => `... ${s.merica.top} ...`)
     Identical in effect to the .filter() above and identical in what it proves, so it is
     recognized rather than made to go away by editing working board code. The Vuelta says
     the same thing with .filter(); the Tour has not been refactored and does not need to
     be for a gate's convenience. */
  const re3b = /\.\s*forEach\s*\(\s*(?:function\s*)?\(?\s*([A-Za-z_$][\w$]*)\)?\s*=>\s*\{\s*if\s*\(([^)]{0,160})\)\s*\{\s*([A-Za-z_$][\w$]*)\s*\.\s*push\s*\(\s*\1\s*\)/g;
  while ((m = re3b.exec(code))) {
    const param = m[1], cond = m[2], target = m[3];
    const fields = new Set();
    const fre = new RegExp('\\b' + param + '\\.([\\w$]+)', 'g');
    let f;
    while ((f = fre.exec(cond))) fields.add(f[1]);
    if (fields.size) {
      guaranteed[target] = guaranteed[target] || new Set();
      fields.forEach(x => guaranteed[target].add(x));
    }
  }

  /* a parameter iterating a filtered variable inherits what the filter proved */
  const paramGuaranteed = {};
  const re4 = /([A-Za-z_$][\w$]*)\s*\.\s*(?:map|forEach|filter|find|flatMap|some|every|sort)\s*\(\s*(?:function\s*)?\(?\s*([A-Za-z_$][\w$]*)/g;
  while ((m = re4.exec(code))) {
    if (guaranteed[m[1]]) {
      paramGuaranteed[m[2]] = paramGuaranteed[m[2]] || new Set();
      guaranteed[m[1]].forEach(x => paramGuaranteed[m[2]].add(x));
    }
  }
  return { bound: bound, guaranteed: paramGuaranteed };
}

/* IS THIS READ PROTECTED BY AN ENCLOSING INTERPOLATION?
   Because every `${` is now examined independently, a nested one loses the context of
   the one wrapping it, and the dominant safe pattern on this board is exactly that:

       ${s.km ? `<span class="ns-chip">${s.km} km</span>` : ''}

   The inner ${s.km} is perfectly safe, because the outer ternary already tested s.km.
   Judged alone it looks identical to the real defect. So before failing a read, check
   every interpolation that ENCLOSES it for a `thatRead ?` or `thatRead &&` test of the
   same expression. Without this the tool reported three false failures against render
   sites that cannot fire, which is how a gate earns its way into being ignored. */
function enclosingGuards(read, it, all) {
  const flatRead = read.replace(/\s+/g, '');
  /* EVERY PREFIX COUNTS, not just the whole path. `${st.kassei ? `...${st.kassei.top}...`
     : ''}` guards the inner read by testing st.kassei, one segment SHORTER than the read
     being judged. Checking only the full path left two false failures standing. */
  const needles = [];
  const parts = flatRead.split('.');
  for (let n = parts.length; n >= 2; n--) needles.push(parts.slice(0, n).join('.'));

  const enclosers = all.filter(o => o !== it && o.index < it.index && o.end >= it.end);
  for (const o of enclosers) {
    const flat = o.expr.replace(/\s+/g, '');
    for (const needle of needles) {
      let at = -1;
      while ((at = flat.indexOf(needle, at + 1)) >= 0) {
        const after = flat.charAt(at + needle.length);
        const before = at === 0 ? '' : flat.charAt(at - 1);
        /* the encloser TESTS this path, and the match is a whole path rather than a
           prefix of a longer identifier (s.km must not match s.kmTotal) */
        if (/[\w$.]/.test(before)) continue;
        if (after === '?' || (after === '&' && flat.charAt(at + needle.length + 1) === '&')) return true;
      }
    }
  }
  return false;
}

/* Does this read touch a field the fixture proves is sometimes absent? */
function fixtureVerdict(expr, binding, fixture) {
  const bound = binding.bound, guaranteed = binding.guaranteed;
  const m = String(expr).match(/^([A-Za-z_$][\w$]*)\s*\??\s*\.\s*([\w$]+)/);
  if (!m) return null;
  const coll = bound[m[1]];
  if (!coll) return null;
  /* an upstream .filter() already proved this field present on every element */
  if (guaranteed[m[1]] && guaranteed[m[1]].has(m[2])) return { proven: false };
  const spec = fixture.collections[coll];
  if (!spec) return null;
  const field = m[2];
  if (spec.always.indexOf(field) >= 0) return { proven: false };
  if (Object.prototype.hasOwnProperty.call(spec.optional, field)) {
    const n = spec.optional[field];
    return { proven: true, detail: coll + '.' + field + ' is on only ' + n + ' of ' + spec.count +
      ' real documents, so this renders the word on the other ' + (spec.count - n) + '.' };
  }
  return null;
}

/* -------------------------------------------------------------------- main -- */

function lineOf(html, idx) { return html.slice(0, idx).split('\n').length; }

/* WHICH POOL'S DATA DOES THIS BOARD RENDER? Measuring a board against another pool's
   shapes is how the Tour got a confident wrong verdict on 2026-09-13: the Vuelta carries
   raceRow.extra on 6 of 21 rows and the Tour on all 21, so the same unguarded read is a
   live defect on one board and inert on the other. */
function fixtureFor(file, fixture) {
  const pool = (fixture.boards || {})[file];
  if (!pool) return null;
  const spec = (fixture.pools || {})[pool];
  if (!spec) return null;
  return { pool: pool, collections: spec.collections, bindings: fixture.bindings };
}

function sweep(file, fixture) {
  const full = path.join(REPO, file);
  if (!fs.existsSync(full)) return { file: file, skipped: true };
  const fx = fixtureFor(file, fixture);
  if (!fx) return { file: file, unmapped: true };
  const html = fs.readFileSync(full, 'utf8');

  const proven = [], advisory = [], desyncs = [];
  let total = 0;
  scriptBlocks(html).forEach((blk, bi) => {
    const bound = bindParams(blk.code, fx);
    const scan = interpolations(blk.code);
    if (scan.desync) desyncs.push({ block: bi, depth: scan.depth, open: scan.open });
    scan.list.forEach(it => {
      total++;
      const bad = unguarded(it.expr);
      if (!bad) return;
      if (enclosingGuards(bad, it, scan.list)) return;
      const rec = { line: lineOf(html, blk.offset + it.index), expr: it.expr.trim().slice(0, 90) };
      const fv = fixtureVerdict(bad, bound, fx);
      if (fv && fv.proven) { rec.detail = fv.detail; proven.push(rec); }
      else advisory.push(rec);
    });
  });
  return { file: file, pool: fx.pool, total: total, proven: proven, advisory: advisory, desyncs: desyncs };
}

function main() {
  const args = process.argv.slice(2);
  const showAll = args.indexOf('--all') >= 0;
  const files = args.filter(a => a.charAt(0) !== '-');
  const targets = files.length ? files : DEFAULT_FILES;

  const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'tools-undefined-fixture.json'), 'utf8'));

  console.log('UNDEFINED SWEEP');
  console.log('interpolations that render the word when a field is absent');
  console.log('fixtures measured ' + fixture.measured + '\n');

  let fail = 0, swept = 0, adv = 0, desync = 0, unmapped = 0;

  targets.forEach(f => {
    const r = sweep(f, fixture);
    if (r.skipped) { console.log('  ' + f + ': not present, skipped'); return; }
    /* A board with no fixture is NOT swept and must say so, never pass quietly. */
    if (r.unmapped) { unmapped++; console.log('  ' + f + ': NO FIXTURE MAPPED, not swept'); return; }
    swept++;
    /* No "inferred" caveat any more, and that is the point of the per-board fixtures:
       every verdict below is measured against the pool the board actually renders, so a
       finding is a finding. The caveat this replaced was itself wrong on the Tour. */
    /* A desynced scan cannot be trusted to have SEEN the defect, so it is a hard
       failure in its own right rather than a warning under a clean summary. */
    if (r.desyncs.length) {
      desync++;
      console.log('  ' + r.file + ': SCAN DESYNCED in ' + r.desyncs.length + ' block(s): ' +
        JSON.stringify(r.desyncs));
      console.log('           The scanner lost its place, so this file was NOT fully swept.');
    }
    console.log('  ' + r.file + ' [' + r.pool + ']: ' + r.total + ' interpolations, ' +
      (r.proven.length ? r.proven.length + ' PROVEN UNGUARDED' : 'none proven unguarded') +
      ', ' + r.advisory.length + ' advisory');
    r.proven.forEach(x => {
      fail++;
      console.log('');
      console.log('      FAIL ' + r.file + ':' + x.line);
      console.log('           ${' + x.expr + '}');
      console.log('           ' + x.detail);
    });
    adv += r.advisory.length;
    if (showAll) r.advisory.forEach(x =>
      console.log('      adv  ' + r.file + ':' + x.line + '  ${' + x.expr + '}'));
  });

  console.log('');
  if (!swept) { console.log('NOTHING SWEPT. Build the boards first; this reads the BUILT files.'); process.exit(2); }

  if (unmapped) {
    console.log(unmapped + ' board(s) had NO FIXTURE and were not swept. Add them to the');
    console.log('`boards` map in tools-undefined-fixture.json; an unswept board is not a clean one.');
    process.exit(2);
  }

  if (desync) {
    console.log(desync + ' file(s) DESYNCED. Fix the scanner before trusting any result here:');
    console.log('a sweep that loses its place reports a clean file it never finished reading.');
    process.exit(2);
  }

  if (fail) {
    console.log(fail + ' interpolation(s) PROVEN to render "undefined" against real documents.');
    console.log('Give each a terminal guard: esc(x), or x || \'\', or a branch emitting nothing.');
    process.exit(1);
  }
  console.log('No proven unguarded field reads.');
  console.log(adv + ' advisory bare read(s) (--all to list). ADVISORY MEANS UNCOVERED, NOT SAFE:');
  console.log('the fixture does not describe those objects, and a render-time pass is still');
  console.log('the only thing that proves a field was absent at a given render site.');
}

main();
