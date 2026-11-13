#!/usr/bin/env node
/* tools/guest-remove.js - emit the snippet that revokes a guest's showroom access.
 *
 *   node tools/guest-remove.js info@ascentpartnersltd.com
 *
 * IT WRITES NOTHING ITSELF. Same shape as tools/guest-add.js: it prints a snippet for a
 * signed-in OWNER board tab, dry run first, with a read-back at the end.
 *
 * REVOCATION IS ONE MAP KEY. The rule reads `viewers` on every request, so removing the
 * key stops access on the guest's very next request. There is no session to expire, no
 * token to revoke and no cleanup job to wait for.
 *
 * IT REFUSES TO TOUCH A MEMBER. If the address turns out to be in some pool's `members`
 * map, this tool is the wrong one: that is a player, removing them is a different and
 * much more consequential act, and it is not something a guest tool should do quietly.
 *
 * THE userPools ENTRY IS DELETED TOO. It grants nothing by itself, but leaving it behind
 * means a revoked guest lands on a board that tries two pools it can no longer open, and
 * "You are not in a pool yet" is the honest answer rather than two silent denials.
 */
'use strict';

const SHOWROOMS = ['tour-showroom', 'vuelta-showroom'];

function usage(why) {
  if (why) console.error('\n' + why);
  console.error('\nusage:');
  console.error('  node tools/guest-remove.js <email>');
  process.exit(2);
}

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage('a valid email is required.');

if (email === 'allen@ascentpartnersltd.com') {
  usage('that is the owner address, and the owner is not a viewer of his own boards.');
}

console.log('/* REVOKE ' + email + '.');
console.log(' * Paste the WHOLE block into the console of a signed-in OWNER board tab.');
console.log(' * DRY RUN FIRST. Nothing is written until APPLY = true.');
console.log(' */');
console.log('');
console.log('const APPLY = false;   // <- flip to true on the second run');
console.log('');
console.log('(async () => {');
console.log("  const FV = firebase.firestore.FieldValue;");
console.log("  const FP = firebase.firestore.FieldPath;");
console.log("  const EMAIL = " + JSON.stringify(email) + ";");
console.log("  const SHOWROOMS = " + JSON.stringify(SHOWROOMS) + ";");
console.log('');
console.log('  /* REFUSAL: this is a guest tool. An address holding a seat is a player. */');
console.log('  const all = await db.collection("pools").get();');
console.log('  const seats = [];');
console.log('  all.forEach(d => {');
console.log('    const m = (d.data() || {}).members || {};');
console.log('    if (Object.prototype.hasOwnProperty.call(m, EMAIL)) seats.push(d.id);');
console.log('  });');
console.log('  if (seats.length) {');
console.log('    console.error("REFUSED: " + EMAIL + " is a MEMBER of: " + seats.join(", "));');
console.log('    console.error("That is a player, not a guest. Removing them is a separate decision.");');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  const found = [];');
console.log('  for (const p of SHOWROOMS) {');
console.log('    const v = ((await db.doc("pools/" + p).get()).data() || {}).viewers || {};');
console.log('    if (Object.prototype.hasOwnProperty.call(v, EMAIL)) found.push(p);');
console.log('  }');
console.log('  if (!found.length) { console.log(EMAIL + " is not a viewer anywhere. Nothing to do."); return; }');
console.log('');
console.log('  if (!APPLY) {');
console.log('    console.log("DRY RUN. Would remove " + EMAIL + " from: " + found.join(", "));');
console.log('    console.log("and delete userPools/" + EMAIL + ".");');
console.log('    console.log("Nothing was written. Set APPLY = true and run it again.");');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  for (const p of found) await db.doc("pools/" + p).update(new FP("viewers", EMAIL), FV.delete());');
console.log('  await db.doc("userPools/" + EMAIL).delete();');
console.log('');
console.log('  /* READ IT BACK. */');
console.log('  for (const p of SHOWROOMS) {');
console.log('    const v = ((await db.doc("pools/" + p).get()).data() || {}).viewers || {};');
console.log('    console.log(p, "->", Object.prototype.hasOwnProperty.call(v, EMAIL) ? "STILL THERE, the write did not land" : "removed");');
console.log('  }');
console.log('  console.log("userPools ->", (await db.doc("userPools/" + EMAIL).get()).exists ? "STILL THERE" : "removed");');
console.log('})();');
