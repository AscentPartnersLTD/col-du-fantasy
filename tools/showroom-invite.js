#!/usr/bin/env node
/* tools/showroom-invite.js - print the console snippet that invites or revokes a viewer.
 *
 *   node tools/showroom-invite.js lance@example.com "Lance Armstrong" 2027-03-31
 *   node tools/showroom-invite.js --revoke lance@example.com
 *
 * IT WRITES NOTHING. It prints a snippet to paste into the console of a signed-in
 * OWNER board tab, which is how every other write in this repo is applied, and it
 * keeps a human between a typed address and somebody being granted access.
 *
 * AN INVITATION IS TWO FACTS AND NOTHING ELSE:
 *   pools/<showroom>.viewers[email] = <expiry timestamp>
 *   userPools/<email>.pools         = the showrooms they may open
 * The first is what the rule reads. The second is only so the board can find the
 * right pool when they arrive on a bare URL, and it grants nothing on its own.
 *
 * THE GUEST NEVER APPEARS IN `members`, AND NEVER IN config/roster. Those are what
 * make somebody a player, and config/roster is keyed by address, so adding a guest
 * there would put them in the file this design exists to keep them out of.
 *
 * WHY FieldPath AND NOT A DOTTED STRING. A dotted path cannot carry an email, and
 * escaping the dots does NOT save it: '.' is resolved by the JavaScript parser
 * before Firestore sees the string, so 'viewers.a@b.com' arrives as
 * 'viewers.a@b.com' and writes a NESTED map, viewers -> a@b -> com. The invitation
 * then silently does not work, because the rule looks for a KEY and finds a sub-map.
 * FieldPath takes its segments unparsed, which is the idiom the board already uses
 * for the members map.
 */
'use strict';

const SHOWROOMS = ['tour-showroom', 'vuelta-showroom'];

function usage(why) {
  if (why) console.error('\n' + why);
  console.error('\nusage:');
  console.error('  node tools/showroom-invite.js <email> "<name>" <YYYY-MM-DD>');
  console.error('  node tools/showroom-invite.js --revoke <email>');
  process.exit(2);
}

const args = process.argv.slice(2);
const revoke = args[0] === '--revoke';
const email = String((revoke ? args[1] : args[0]) || '').trim().toLowerCase();

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage('a valid email is required.');

if (revoke) {
  console.log('/* REVOKE ' + email + '. Paste into a signed-in OWNER board tab.');
  console.log('   Access stops on their next request: the rule reads the map, so');
  console.log('   removing the key is the whole revocation. */');
  console.log('const FV = firebase.firestore.FieldValue;');
  console.log('const FP = firebase.firestore.FieldPath;');
  SHOWROOMS.forEach(p => {
    console.log("await db.doc('pools/" + p + "').update(new FP('viewers', '" +
      email + "'), FV.delete());");
  });
  console.log("await db.doc('userPools/" + email + "').delete();");
  console.log('');
  console.log('/* read it back */');
  SHOWROOMS.forEach(p => {
    console.log("console.log('" + p + "', Object.keys(((await db.doc('pools/" + p +
      "').get()).data().viewers) || {}));");
  });
  process.exit(0);
}

const name = String(args[1] || '').trim();
const until = String(args[2] || '').trim();
if (!name) usage('a display name is required, so the invitation is readable later.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) usage('an expiry date is required: YYYY-MM-DD.');

const when = new Date(until + 'T23:59:59Z');
if (isNaN(when.getTime())) usage(until + ' is not a date.');
if (when.getTime() < Date.now()) usage(until + ' is in the past.');

console.log('/* INVITE ' + name + ' <' + email + '> until ' + until + '.');
console.log('   Paste into a signed-in OWNER board tab. Read it back at the end.');
console.log('   They appear in `viewers` only: never in members, never in');
console.log('   config/roster, which is the file keyed by address. */');
console.log('');
console.log('const FP = firebase.firestore.FieldPath;');
SHOWROOMS.forEach(p => {
  console.log("await db.doc('pools/" + p + "').update(new FP('viewers', '" + email +
    "'), new Date('" + when.toISOString() + "'));");
});
console.log("await db.doc('userPools/" + email + "').set({ pools: " +
  JSON.stringify(SHOWROOMS) + " });");
console.log('');
console.log('/* read it back, because a write that returned is not a write that landed */');
SHOWROOMS.forEach(p => {
  console.log("console.log('" + p + "', (await db.doc('pools/" + p +
    "').get()).data().viewers['" + email + "']);");
});
console.log('');
console.log('/* their links:');
console.log(' *   https://coldufantasy.com/tour.html?pool=tour-showroom');
console.log(' *   https://coldufantasy.com/vuelta.html?pool=vuelta-showroom');
console.log(' * A bare coldufantasy.com also works: the board finds the showroom');
console.log(' * through userPools and reroutes. */');
