#!/usr/bin/env node
/* tools/guest-add.js - emit the snippet that invites a guest to the showroom boards.
 *
 *   node tools/guest-add.js info@ascentpartnersltd.com "Life Time review" 2027-03-31
 *
 * IT WRITES NOTHING ITSELF, and that is the design rather than a limitation. It prints a
 * snippet to paste into the console of a signed-in OWNER board tab, which is how every
 * other write in this repo is applied (see close-stage.js --emit), and it keeps a human
 * between a typed address and somebody being granted access.
 *
 * AN INVITATION IS TWO FACTS AND NOTHING ELSE:
 *   pools/<showroom>.viewers[email] = <expiry timestamp>
 *   userPools/<email>.pools         = the showrooms they may open
 * The first is what the rule reads. The second is only so the board can find the right
 * pool when they arrive on a bare URL, and it grants nothing on its own: every read is
 * still checked against members or viewers, and resolvePool skips an id it cannot open.
 *
 * THE GUEST NEVER APPEARS IN `members`, AND NEVER IN config/roster. Membership is a
 * WRITE grant - pools/{poolId}/drafts allows write to any member - and config/roster is
 * keyed by address, so adding a guest there would put them in the very file this design
 * exists to keep them out of.
 *
 * WHY FieldPath AND NOT A DOTTED STRING. A dotted path cannot carry an email, and
 * escaping the dots does not save it: '.' is resolved before Firestore sees the string,
 * so 'viewers.a@b.com' writes a NESTED map, viewers -> a@b -> com. The invitation then
 * silently does not work, because the rule looks for a KEY and finds a sub-map.
 * FieldPath takes its segments unparsed, which is the idiom the board already uses.
 *
 * WHY THE EXPIRY IS A TIMESTAMP. firestore.rules cannot parse a date string, and the
 * rule now requires `is timestamp` by name, so a hand-written ISO string in this map
 * denies rather than granting. The snippet builds a real Date at the END of the named
 * day, so "until 2027-03-31" is good for the whole of that day.
 */
'use strict';

const SHOWROOMS = ['tour-showroom', 'vuelta-showroom'];

/* Never a target, ever, under any flag. Named rather than inferred, the same way
   firestore.rules names them, so a typo cannot turn into an invitation to the season. */
const PRODUCTION_POOLS = ['col-du-fantasy', 'vuelta-2026', 'lowry-city-rollers', 'sandbox'];

function usage(why) {
  if (why) console.error('\n' + why);
  console.error('\nusage:');
  console.error('  node tools/guest-add.js <email> "<name>" <YYYY-MM-DD>');
  console.error('\n  The expiry is INCLUSIVE of its own day. To revoke early:');
  console.error('  node tools/guest-remove.js <email>');
  process.exit(2);
}

const args = process.argv.slice(2);
const email = String(args[0] || '').trim().toLowerCase();
const name = String(args[1] || '').trim();
const until = String(args[2] || '').trim();

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage('a valid email is required.');
if (!name) usage('a display name is required, so the invitation is readable later.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) usage('an expiry date is required: YYYY-MM-DD.');

const when = new Date(until + 'T23:59:59Z');
if (isNaN(when.getTime())) usage(until + ' is not a date.');
if (when.getTime() < Date.now()) usage(until + ' is in the past.');

/* ---- the refusals this tool can make on its own, before printing anything ---- */

/* The owner is not a guest of his own boards, and the rules compare his address
   EXACTLY. Inviting him would be harmless and completely pointless, and it would put a
   real address into a map that is supposed to hold none. */
if (email === 'allen@ascentpartnersltd.com') {
  usage('that is the owner address. The owner already reads every pool.');
}

/* A SHOWROOM ADDRESS IS A PLACEHOLDER, NOT A PERSON. */
if (/@showroom\.invalid$/i.test(email)) {
  usage('showroom.invalid is the scrub placeholder, not a mailbox.');
}

console.log('/* INVITE ' + name + ' <' + email + '> until ' + until + '.');
console.log(' * Paste the WHOLE block into the console of a signed-in OWNER board tab.');
console.log(' * It is DRY RUN FIRST: it reads, prints what it would do, and refuses on its');
console.log(' * own if anything is wrong. Nothing is written until you re-run it with');
console.log(' * APPLY = true, which is the same shape as showroom-copy.js --apply.');
console.log(' */');
console.log('');
console.log('const APPLY = false;   // <- flip to true on the second run');
console.log('');
console.log('(async () => {');
console.log("  const FP = firebase.firestore.FieldPath;");
console.log("  const EMAIL = " + JSON.stringify(email) + ";");
console.log("  const UNTIL = new Date(" + JSON.stringify(when.toISOString()) + ");");
console.log("  const SHOWROOMS = " + JSON.stringify(SHOWROOMS) + ";");
console.log("  const PRODUCTION = " + JSON.stringify(PRODUCTION_POOLS) + ";");
console.log('');
console.log('  /* REFUSAL 1: an address that is already somebody\'s seat anywhere.');
console.log('     This is the check that cannot be done offline, because only a signed-in');
console.log('     owner can read the members maps, and it is the one that matters most: a');
console.log('     real player invited as a guest would hold BOTH grants, and the member');
console.log('     grant is the one that can write a draft. The test guest in');
console.log('     GO-LIVE-GUESTS.md is an address in no pool for exactly this reason. */');
console.log('  const all = await db.collection("pools").get();');
console.log('  const clash = [];');
console.log('  all.forEach(d => {');
console.log('    const m = (d.data() || {}).members || {};');
console.log('    if (Object.prototype.hasOwnProperty.call(m, EMAIL)) clash.push(d.id + " (seat " + (m[EMAIL] || "none") + ")");');
console.log('  });');
console.log('  if (clash.length) {');
console.log('    console.error("REFUSED: " + EMAIL + " is already a MEMBER of: " + clash.join(", "));');
console.log('    console.error("A member can write a draft. Guests are viewers only. Pick another address.");');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  /* REFUSAL 2: a target that is not one of the two showrooms. */');
console.log('  for (const p of SHOWROOMS) {');
console.log('    if (PRODUCTION.includes(p)) { console.error("REFUSED: " + p + " is a production pool."); return; }');
console.log('    const snap = await db.doc("pools/" + p).get();');
console.log('    if (!snap.exists) { console.error("REFUSED: " + p + " does not exist. Run showroom-copy first."); return; }');
console.log('    if ((snap.data() || {}).showroom !== true) { console.error("REFUSED: " + p + " is not flagged showroom."); return; }');
console.log('  }');
console.log('');
console.log('  if (!APPLY) {');
console.log('    console.log("DRY RUN. Would invite " + EMAIL + " until " + UNTIL.toISOString() + " on: " + SHOWROOMS.join(", "));');
console.log('    console.log("Nothing was written. Set APPLY = true and run it again.");');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  for (const p of SHOWROOMS) await db.doc("pools/" + p).update(new FP("viewers", EMAIL), UNTIL);');
console.log('  await db.doc("userPools/" + EMAIL).set({ pools: SHOWROOMS });');
console.log('');
console.log('  /* READ IT BACK. A write that returned is not a write that landed. */');
console.log('  for (const p of SHOWROOMS) {');
console.log('    const v = ((await db.doc("pools/" + p).get()).data() || {}).viewers || {};');
console.log('    console.log(p, "->", v[EMAIL] ? v[EMAIL].toDate().toISOString() : "MISSING, the write did not land");');
console.log('  }');
console.log('  const up = (await db.doc("userPools/" + EMAIL).get()).data() || {};');
console.log('  console.log("userPools ->", up.pools || "MISSING");');
console.log('})();');
console.log('');
console.log('/* Their links:');
console.log(' *   https://coldufantasy.com/tour.html?pool=tour-showroom');
console.log(' *   https://coldufantasy.com/vuelta.html?pool=vuelta-showroom');
console.log(' * A bare coldufantasy.com also works: the board finds the showroom through');
console.log(' * userPools and reroutes. They sign in with the same code-by-email flow as');
console.log(' * everyone else, so there is no password to send them. */');
