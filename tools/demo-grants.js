#!/usr/bin/env node
/* tools/demo-grants.js - let the people who already hold a preview link play the demo.
 *
 *   node tools/demo-grants.js
 *
 * Grants `tour-demo` to the guests who were invited before it existed. Everyone invited
 * AFTER this gets it from tools/guest-pass-create.js, which now includes the demo pool
 * in the pass it mints.
 *
 * IT WRITES NOTHING ITSELF. It prints a snippet for a signed-in OWNER board console,
 * dry run first, with a read-back, the same shape as every other write in this repo.
 *
 * THE EXPIRY IS NEVER TYPED HERE, and that is the point of looking the pass up rather
 * than passing an id in. A grant on the demo that outlived the pass would be an
 * invitation nobody can see in guests.html and nobody thinks to revoke: the pass is the
 * authority on when access ends, so the demo grant is written FROM it. For the one
 * address that holds no pass, the expiry is read off the showroom it already reads, for
 * the same reason.
 *
 * THE PASS IS FOUND BY LABEL, which also means this tool never handles a pass id. The id
 * is the credential in somebody's link; a tool that does not need it should not print
 * it, and a label is what a person actually remembers.
 *
 * THE SEAT IS JB because that is the seat the demo opens on the clock: stage 18 has one
 * pick in it, AA's, and JB is next. Handing a guest the seat that is already waiting is
 * what makes the board playable in one tap rather than after three bot turns that this
 * version does not have.
 */
'use strict';

const DEMO = 'tour-demo';
const DEMO_SEAT = 'JB';

/* label -> the pass whose grant is extended. A label rather than an id, deliberately. */
const PASSES = ['LT marketing via JB'];

/* Addresses that hold no pass and were invited the older way, through guest-add.js.
   Their expiry is read off a showroom they already read. */
const PLAIN = [{ email: 'info@ascentpartnersltd.com', expiryFrom: 'tour-showroom' }];

const out = [];
const p = (l) => out.push(l);

p('/* GRANT ' + DEMO + ' to the guests invited before it existed.');
p(' * Paste the WHOLE block into a signed-in OWNER board console.');
p(' * DRY RUN FIRST: nothing is written until APPLY is true and it is run again.');
p(' */');
p('');
p('const APPLY = false;   // <- flip to true on the second run');
p('');
p('(async () => {');
p('  const FP = firebase.firestore.FieldPath;');
p('  const DEMO = ' + JSON.stringify(DEMO) + ';');
p('  const DEMO_SEAT = ' + JSON.stringify(DEMO_SEAT) + ';');
p('  const PASSES = ' + JSON.stringify(PASSES) + ';');
p('  const PLAIN = ' + JSON.stringify(PLAIN) + ';');
p('');
p('  /* REFUSAL 1: the demo must exist and must be flagged, or a grant here is a key in');
p('     a map nothing reads. Both halves, because firestore.rules needs both. */');
p('  const dsnap = await db.doc("pools/" + DEMO).get();');
p('  if (!dsnap.exists) { console.error("REFUSED: " + DEMO + " does not exist. Run tools/demo-build.js first."); return; }');
p('  const d = dsnap.data() || {};');
p('  if (d.demo !== true) { console.error("REFUSED: " + DEMO + " is not flagged demo."); return; }');
p('  if (d.showroom !== true) { console.error("REFUSED: " + DEMO + " is not flagged showroom, which viewerOf() requires."); return; }');
p('  if (Object.keys(d.members || {}).length) { console.error("REFUSED: " + DEMO + " has members. A demo pool has none."); return; }');
p('  if (!(d.order || []).includes(DEMO_SEAT)) { console.error("REFUSED: seat " + DEMO_SEAT + " is not in that pool order."); return; }');
p('');
p('  const grants = [];');
p('');
p('  /* THE PASSES, looked up by label. More than one pass with the same label is a');
p('     REFUSAL rather than a guess: granting the wrong person a seat on a board they');
p('     can write is not something to find out about afterwards. */');
p('  for (const label of PASSES) {');
p('    const q = await db.collection("guestPasses").where("label", "==", label).get();');
p('    if (q.size === 0) { console.error("REFUSED: no pass is labelled " + JSON.stringify(label)); return; }');
p('    if (q.size > 1) { console.error("REFUSED: " + q.size + " passes are labelled " + JSON.stringify(label)); return; }');
p('    const doc = q.docs[0], x = doc.data() || {};');
p('    if (x.revoked === true) { console.error("REFUSED: " + label + " is revoked."); return; }');
p('    const exp = x.expires && x.expires.toDate ? x.expires.toDate() : null;');
p('    if (!exp) { console.error("REFUSED: " + label + " has no usable expiry."); return; }');
p('    if (exp.getTime() < Date.now()) { console.error("REFUSED: " + label + " has already lapsed."); return; }');
p('    grants.push({ who: label, email: x.email, until: exp, passRef: doc.ref, pools: x.pools || [] });');
p('  }');
p('');
p('  /* THE ADDRESSES WITH NO PASS. Their expiry comes off the showroom they already');
p('     read, so the demo grant cannot outlive the invitation it belongs to. */');
p('  for (const q of PLAIN) {');
p('    const s = await db.doc("pools/" + q.expiryFrom).get();');
p('    const v = ((s.data() || {}).viewers || {})[q.email];');
p('    const exp = v && v.toDate ? v.toDate() : null;');
p('    if (!exp) { console.error("REFUSED: " + q.email + " is not a viewer of " + q.expiryFrom + ", so there is no expiry to copy."); return; }');
p('    if (exp.getTime() < Date.now()) { console.error("REFUSED: " + q.email + " has already lapsed on " + q.expiryFrom + "."); return; }');
p('    grants.push({ who: q.email, email: q.email, until: exp, passRef: null, pools: null });');
p('  }');
p('');
p('  /* REFUSAL 2: an address that is somebody\'s SEAT anywhere. A member can write a');
p('     draft on a real pool, and a guest who held both grants would be a player with a');
p('     link. Only a signed-in owner can read every members map, which is why this check');
p('     lives in the snippet and not in the tool. */');
p('  const all = await db.collection("pools").get();');
p('  for (const g of grants) {');
p('    const clash = [];');
p('    all.forEach(x => { const m = (x.data() || {}).members || {}; if (Object.prototype.hasOwnProperty.call(m, g.email)) clash.push(x.id); });');
p('    if (clash.length) { console.error("REFUSED: " + g.email + " is a MEMBER of: " + clash.join(", ")); return; }');
p('  }');
p('');
p('  grants.forEach(g => console.log(g.who + "  ->  " + g.email + ", seat " + DEMO_SEAT + ", until " + g.until.toISOString()));');
p('');
p('  if (!APPLY) {');
p('    console.log("DRY RUN: would grant " + DEMO + " to " + grants.length + " guest(s). Nothing was written.");');
p('    return;');
p('  }');
p('');
p('  for (const g of grants) {');
p('    /* FieldPath and not a dotted string: a dotted path cannot carry an email, and');
p('       escaping the dots does not save it, because the JavaScript parser resolves the');
p('       escape before Firestore sees the string and the write lands as a NESTED map');
p('       the rule looks straight past. */');
p('    await db.doc("pools/" + DEMO).update(new FP("viewers", g.email), g.until);');
p('    await db.doc("pools/" + DEMO).update(new FP("viewerSeats", g.email), DEMO_SEAT);');
p('    /* userPools is the switcher hint and grants nothing; it is kept in step so the');
p('       demo appears in their pool menu. */');
p('    await db.doc("userPools/" + g.email).set(');
p('      { pools: firebase.firestore.FieldValue.arrayUnion(DEMO) }, { merge: true });');
p('    /* And the pass itself records which pools it opens, so guests.html and any');
p('       later read agree with the grant. */');
p('    if (g.passRef && !(g.pools || []).includes(DEMO)) {');
p('      await g.passRef.update({ pools: firebase.firestore.FieldValue.arrayUnion(DEMO) });');
p('    }');
p('  }');
p('');
p('  /* READ IT BACK, both maps and the hint. */');
p('  const back = (await db.doc("pools/" + DEMO).get()).data() || {};');
p('  for (const g of grants) {');
p('    const v = (back.viewers || {})[g.email];');
p('    const s = (back.viewerSeats || {})[g.email];');
p('    const up = (await db.doc("userPools/" + g.email).get()).data() || {};');
p('    console.log(g.who, {');
p('      viewer: v && v.toDate ? v.toDate().toISOString() : "MISSING, the write did not land",');
p('      seat: s || "MISSING",');
p('      userPools: (up.pools || []).includes(DEMO) ? "has " + DEMO : "MISSING" });');
p('  }');
p('})();');

console.log(out.join('\n'));
