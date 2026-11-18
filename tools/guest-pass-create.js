#!/usr/bin/env node
/* tools/guest-pass-create.js - mint a guest pass and print the link that uses it.
 *
 *   node tools/guest-pass-create.js "Life Time review" 2027-03-31
 *
 * WHAT CHANGED, AND WHY. A guest used to sign in the way a player does: type an address,
 * wait for a six-digit code, type the code. That asked somebody being shown a board as a
 * courtesy to do paperwork, and it needed a real mailbox before they could look at
 * anything. A pass replaces all of it with a link. The id in that link IS the
 * credential, checked server side at /auth/guest, which answers with exactly the same
 * session a player's code would have produced.
 *
 * IT WRITES NOTHING ITSELF, the same as tools/guest-add.js and for the same reason. It
 * prints a snippet to paste into the console of a signed-in OWNER board tab, DRY RUN
 * FIRST, so a person stays between a typed label and somebody holding a live link.
 *
 * THE ADDRESS IS SYNTHETIC AND THAT IS THE POINT. The whole stack is keyed by email: the
 * session document, the token claim, firestore.rules `em()`, the `viewers` map and
 * `userPools`. Rather than bend any of that to carry a different kind of identity, a
 * pass mints its own address under guests.coldufantasy.com, a domain with no mailboxes.
 * No real person's address is written anywhere, and nothing can be emailed to it.
 *
 * THE PASS ID IS A SECRET. 160 bits from crypto.randomBytes, never derived from the
 * label or the date. It is printed once, here, inside the link. If it is lost, revoke
 * the pass and mint another; there is no way to recover it from the document, because
 * the document id IS the secret and Firestore will happily show it only to the owner.
 */
'use strict';

const core = require('../tools-guest-pass-core.js');

const SHOWROOMS = ['tour-showroom', 'vuelta-showroom'];
const SITE = 'https://coldufantasy.com';

/* The board a link opens on. Both showrooms are in the pass, and the account switcher
   moves between them, so this is only which one the printed link lands on first. */
const PRIMARY = { pool: 'tour-showroom', path: '/tour.html' };
const SECOND = { pool: 'vuelta-showroom', path: '/vuelta.html' };

/* Never a target, ever, under any flag. Named rather than inferred, the same way
   firestore.rules names them. */
const PRODUCTION_POOLS = ['col-du-fantasy', 'vuelta-2026', 'lowry-city-rollers', 'sandbox'];

function usage(why) {
  if (why) console.error('\n' + why);
  console.error('\nusage:');
  console.error('  node tools/guest-pass-create.js "<label>" <YYYY-MM-DD>');
  console.error('\n  The label is YOUR private name for the person. It is never shown to');
  console.error('  them and never emailed anywhere; it is how the pass reads on');
  console.error('  guests.html and in the visit log.');
  console.error('\n  The expiry is INCLUSIVE of its own day. To revoke early:');
  console.error('  node tools/guest-pass-revoke.js <passId|label>');
  process.exit(2);
}

const args = process.argv.slice(2);
const label = String(args[0] || '').trim();
const until = String(args[1] || '').trim();

if (!label) usage('a label is required, so the pass is readable later.');
if (label.length > 60) usage('that label is too long; keep it under 60 characters.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) usage('an expiry date is required: YYYY-MM-DD.');

const when = new Date(until + 'T23:59:59Z');
if (isNaN(when.getTime())) usage(until + ' is not a date.');
if (when.getTime() < Date.now()) usage(until + ' is in the past.');

/* AN EXPIRY THAT IS EFFECTIVELY NEVER is worth a word, because the whole mechanism
   depends on passes lapsing on their own. It is allowed, deliberately: a Life Time pass
   is a real thing Allen may want. It just says so out loud. */
const years = (when.getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000);

const passId = core.newPassId();
const email = core.syntheticEmail(label, passId);

/* Belt and braces against a generator change: the address this tool mints must be one
   the SERVER recognises as a guest, or /auth/guest signs the pass in as a player. The
   two predicates are the same code, asserted byte for byte by
   tools-guest-pass-parity.js, and this is the second check at the one moment it is
   cheap to make. */
if (!core.isGuestEmail(email)) usage('generated an address the server would not call a guest: ' + email);
if (!core.looksLikePassId(passId)) usage('generated a pass id of the wrong shape: ' + passId);

const link = SITE + PRIMARY.path + '?pool=' + PRIMARY.pool + '&pass=' + passId;
const link2 = SITE + SECOND.path + '?pool=' + SECOND.pool + '&pass=' + passId;

console.log('/* GUEST PASS for ' + label + ', until ' + until + '.');
console.log(' * Paste the WHOLE block into the console of a signed-in OWNER board tab.');
console.log(' * It is DRY RUN FIRST: it reads, prints what it would do, and refuses on its');
console.log(' * own if anything is wrong. Nothing is written until you re-run it with');
console.log(' * APPLY = true, which is the same shape as guest-add.js and showroom-copy.js.');
if (years > 5) {
  console.log(' *');
  console.log(' * NOTE: that expiry is ' + years.toFixed(1) + ' years away. A pass that effectively never');
  console.log(' * lapses has to be revoked by hand to end, which is fine as long as it is');
  console.log(' * deliberate. Everything about this design assumes passes mostly expire.');
}
console.log(' */');
console.log('');
console.log('const APPLY = false;   // <- flip to true on the second run');
console.log('');
console.log('(async () => {');
console.log('  const FP = firebase.firestore.FieldPath;');
console.log('  const PASS_ID = ' + JSON.stringify(passId) + ';');
console.log('  const EMAIL = ' + JSON.stringify(email) + ';');
console.log('  const LABEL = ' + JSON.stringify(label) + ';');
console.log('  const UNTIL = new Date(' + JSON.stringify(when.toISOString()) + ');');
console.log('  const SHOWROOMS = ' + JSON.stringify(SHOWROOMS) + ';');
console.log('  const PRODUCTION = ' + JSON.stringify(PRODUCTION_POOLS) + ';');
console.log('  const BOARD = ' + JSON.stringify(PRIMARY.path + '?pool=' + PRIMARY.pool) + ';');
console.log('');
console.log('  /* REFUSAL 1: this pass id already exists. It never will, at 160 bits, but a');
console.log('     credential table is not the place to assume that and then overwrite a row. */');
console.log('  if ((await db.doc("guestPasses/" + PASS_ID).get()).exists) {');
console.log('    console.error("REFUSED: that pass id already exists. Run the tool again.");');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  /* REFUSAL 2: the synthetic address is somebody\'s seat. It cannot be, since');
console.log('     no member address ends in guests.coldufantasy.com, and that is exactly why');
console.log('     the check is cheap enough to keep: a member grant can WRITE a draft, and a');
console.log('     guest who also held one would be a player with a link. */');
console.log('  const all = await db.collection("pools").get();');
console.log('  const clash = [];');
console.log('  all.forEach(d => {');
console.log('    const m = (d.data() || {}).members || {};');
console.log('    if (Object.prototype.hasOwnProperty.call(m, EMAIL)) clash.push(d.id);');
console.log('  });');
console.log('  if (clash.length) {');
console.log('    console.error("REFUSED: " + EMAIL + " is already a MEMBER of: " + clash.join(", "));');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  /* REFUSAL 3: a target that is not one of the two showrooms. */');
console.log('  for (const p of SHOWROOMS) {');
console.log('    if (PRODUCTION.includes(p)) { console.error("REFUSED: " + p + " is a production pool."); return; }');
console.log('    const snap = await db.doc("pools/" + p).get();');
console.log('    if (!snap.exists) { console.error("REFUSED: " + p + " does not exist. Run showroom-copy first."); return; }');
console.log('    if ((snap.data() || {}).showroom !== true) { console.error("REFUSED: " + p + " is not flagged showroom."); return; }');
console.log('  }');
console.log('');
console.log('  if (!APPLY) {');
console.log('    console.log("DRY RUN. Would create pass " + PASS_ID + " for " + LABEL);');
console.log('    console.log("  as " + EMAIL + ", until " + UNTIL.toISOString());');
console.log('    console.log("  viewer on: " + SHOWROOMS.join(", "));');
console.log('    console.log("Nothing was written. Set APPLY = true and run it again.");');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  /* THE PASS. This document is the credential table: its id is the secret in');
console.log('     the link, and firestore.rules lets nobody but the owner read it. */');
console.log('  await db.doc("guestPasses/" + PASS_ID).set({');
console.log('    label: LABEL, email: EMAIL, expires: UNTIL, revoked: false,');
console.log('    createdAt: Date.now(), pools: SHOWROOMS, board: BOARD');
console.log('  });');
console.log('');
console.log('  /* THE VIEWER GRANT, which is what firestore.rules actually reads. The pass');
console.log('     decides whether a SESSION may be issued; this decides what that session');
console.log('     may read. Both expire on the same date on purpose: two halves of one');
console.log('     invitation that could otherwise drift apart.');
console.log('     FieldPath and not a dotted string: a dotted path cannot carry an email,');
console.log('     and escaping the dots does not save it, because the JavaScript parser');
console.log('     resolves the escape before Firestore sees the string and you get a');
console.log('     NESTED map that the rule looks straight past. */');
console.log('  for (const p of SHOWROOMS) await db.doc("pools/" + p).update(new FP("viewers", EMAIL), UNTIL);');
console.log('  await db.doc("userPools/" + EMAIL).set({ pools: SHOWROOMS });');
console.log('');
console.log('  /* READ IT BACK. A write that returned is not a write that landed. */');
console.log('  const back = (await db.doc("guestPasses/" + PASS_ID).get()).data() || {};');
console.log('  console.log("pass ->", back.label, back.email, back.expires && back.expires.toDate().toISOString());');
console.log('  for (const p of SHOWROOMS) {');
console.log('    const v = ((await db.doc("pools/" + p).get()).data() || {}).viewers || {};');
console.log('    console.log(p, "->", v[EMAIL] ? v[EMAIL].toDate().toISOString() : "MISSING, the write did not land");');
console.log('  }');
console.log('  const up = (await db.doc("userPools/" + EMAIL).get()).data() || {};');
console.log('  console.log("userPools ->", up.pools || "MISSING");');
console.log('  console.log("LINK ->", ' + JSON.stringify(link) + ');');
console.log('})();');
console.log('');
console.log('/* ================= THE LINK, once APPLY has run =================');
console.log(' *');
console.log(' *   ' + link);
console.log(' *');
console.log(' * That is the whole invitation. No code, no password, nothing to set up. It');
console.log(' * opens the Tour showroom; the account switcher moves to the Vuelta one, or');
console.log(' * send this instead:');
console.log(' *');
console.log(' *   ' + link2);
console.log(' *');
console.log(' * The board strips ?pass= out of the address bar the moment it has signed in,');
console.log(' * so the credential does not sit in a screenshot, in the history of a shared');
console.log(' * laptop, or in the Referer of the first outbound link they click.');
console.log(' *');
console.log(' * Watch what they do:   ' + SITE + '/guests.html');
console.log(' * Revoke:               node tools/guest-pass-revoke.js ' + passId);
console.log(' */');
