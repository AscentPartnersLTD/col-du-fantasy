#!/usr/bin/env node
/* tools/guest-pass-revoke.js - emit the snippet that kills a guest pass.
 *
 *   node tools/guest-pass-revoke.js xk4m2qv7a9t3bz6ry8pw5nhs2d4f6g8j
 *   node tools/guest-pass-revoke.js "Life Time review"
 *
 * TAKES A PASS ID OR A LABEL. The id is what the create tool printed and what guests.html
 * shows; the label is what you actually remember. A label is resolved by QUERY inside the
 * snippet rather than here, because only a signed-in owner can read guestPasses, and it
 * refuses rather than guessing if the label names more than one pass.
 *
 * REVOCATION IS THREE THINGS, and they are deliberately not one:
 *
 *   1. guestPasses/<id>.revoked = true
 *      The pass is the authority. /auth/guest refuses it, /auth/token stops refreshing
 *      the session it already issued, and /api/guest-ping stops counting time. This is
 *      the half that cannot be worked around from a browser.
 *   2. the `viewers` key is REMOVED from both showrooms
 *      firestore.rules reads that map, so this denies every read immediately, without
 *      waiting for a page load. Setting the pass alone would leave an open tab able to
 *      go on reading what it already had permission for until it next refreshed.
 *   3. userPools/<email> is deleted
 *      It grants nothing, but it is the switcher's hint, and a revoked guest should not
 *      keep a list of boards they can no longer open.
 *
 * WHAT THIS SNIPPET CANNOT DO, said plainly because the brief asks for it: delete the
 * guest's authSessions documents. firestore.rules has NO match block for authSessions,
 * so every browser read and write there is denied by default, and a snippet that tried
 * would fail silently, which is worse than not trying. The DELETION IS SERVER SIDE: the
 * next time that cookie is presented to /auth/token, the pass is found dead, the session
 * document is deleted and the cookie is cleared, in the same request. The guest cannot
 * use the session in the meantime because step 2 has already closed every read.
 */
'use strict';

const core = require('../tools-guest-pass-core.js');

const SHOWROOMS = ['tour-showroom', 'vuelta-showroom'];

function usage(why) {
  if (why) console.error('\n' + why);
  console.error('\nusage:');
  console.error('  node tools/guest-pass-revoke.js <passId>');
  console.error('  node tools/guest-pass-revoke.js "<label>"');
  console.error('\n  The pass id is the long string from the link. The label is the private');
  console.error('  name you gave the pass when you created it.');
  console.error('\n  To see what is live:  https://coldufantasy.com/guests.html');
  process.exit(2);
}

const args = process.argv.slice(2);
const target = String(args[0] || '').trim();
if (!target) usage('a pass id or a label is required.');

/* WHICH ONE IS IT. A pass id is 24 to 64 lowercase base32 characters and a label is
   anything else; the shapes do not overlap, so this never has to ask. A label that
   happened to look like a pass id would be looked up as an id and refused as missing,
   which is the safe direction: it writes nothing. */
const byId = core.looksLikePassId(target);

console.log('/* REVOKE the guest pass ' + (byId ? target : 'labelled "' + target + '"') + '.');
console.log(' * Paste the WHOLE block into the console of a signed-in OWNER board tab.');
console.log(' * DRY RUN FIRST: it reads, prints exactly what it would kill, and writes');
console.log(' * nothing until you set APPLY = true and run it again.');
console.log(' */');
console.log('');
console.log('const APPLY = false;   // <- flip to true on the second run');
console.log('');
console.log('(async () => {');
console.log('  const FP = firebase.firestore.FieldPath;');
console.log('  const FV = firebase.firestore.FieldValue;');
console.log('  const TARGET = ' + JSON.stringify(target) + ';');
console.log('  const BY_ID = ' + JSON.stringify(byId) + ';');
console.log('  const SHOWROOMS = ' + JSON.stringify(SHOWROOMS) + ';');
console.log('');
console.log('  /* FIND IT. By id it is one read; by label it is a query, and a label that');
console.log('     names two passes is a REFUSAL rather than a guess, because revoking the');
console.log('     wrong person\'s link is not something to find out about afterwards. */');
console.log('  let id = null, data = null;');
console.log('  if (BY_ID) {');
console.log('    const s = await db.doc("guestPasses/" + TARGET).get();');
console.log('    if (s.exists) { id = s.id; data = s.data(); }');
console.log('  } else {');
console.log('    const q = await db.collection("guestPasses").where("label", "==", TARGET).get();');
console.log('    if (q.size > 1) {');
console.log('      console.error("REFUSED: " + q.size + " passes carry that label. Revoke by id instead:");');
console.log('      q.forEach(d => console.error("  " + d.id + "  " + (d.data().email || "")));');
console.log('      return;');
console.log('    }');
console.log('    q.forEach(d => { id = d.id; data = d.data(); });');
console.log('  }');
console.log('  if (!id) { console.error("REFUSED: no pass matches " + TARGET); return; }');
console.log('');
console.log('  const EMAIL = data.email;');
console.log('  const live = data.revoked !== true &&');
console.log('    (data.expires && data.expires.toDate ? data.expires.toDate().getTime() : 0) > Date.now();');
console.log('  console.log("pass   " + id);');
console.log('  console.log("label  " + (data.label || "(none)"));');
console.log('  console.log("email  " + EMAIL);');
console.log('  console.log("state  " + (data.revoked === true ? "ALREADY REVOKED" : (live ? "LIVE" : "expired")));');
console.log('');
console.log('  if (!APPLY) {');
console.log('    console.log("DRY RUN. Would set revoked, drop the viewers key on " + SHOWROOMS.join(" and ") + ",");');
console.log('    console.log("and delete userPools/" + EMAIL + ". Nothing was written.");');
console.log('    return;');
console.log('  }');
console.log('');
console.log('  /* 1. the pass. This is the half the server reads, and the half a browser');
console.log('        cannot work around. */');
console.log('  await db.doc("guestPasses/" + id).update({ revoked: true, revokedAt: Date.now() });');
console.log('');
console.log('  /* 2. the viewer grant, so every read is denied NOW rather than at their');
console.log('        next page load. An open tab keeps whatever it has already rendered,');
console.log('        which is a screenshot they could have taken anyway, and gets nothing');
console.log('        further from Firestore. */');
console.log('  for (const p of SHOWROOMS) {');
console.log('    try { await db.doc("pools/" + p).update(new FP("viewers", EMAIL), FV.delete()); }');
console.log('    catch (e) { console.warn("viewers key on " + p + ": " + (e && e.message)); }');
console.log('  }');
console.log('');
console.log('  /* 3. the switcher hint. It grants nothing; it should not outlive the pass. */');
console.log('  try { await db.doc("userPools/" + EMAIL).delete(); } catch (e) {}');
console.log('');
console.log('  /* READ IT BACK, all three. */');
console.log('  const back = (await db.doc("guestPasses/" + id).get()).data() || {};');
console.log('  console.log("revoked ->", back.revoked === true ? "yes" : "NO, the write did not land");');
console.log('  for (const p of SHOWROOMS) {');
console.log('    const v = ((await db.doc("pools/" + p).get()).data() || {}).viewers || {};');
console.log('    console.log(p, "->", Object.prototype.hasOwnProperty.call(v, EMAIL) ? "STILL A VIEWER, the write did not land" : "removed");');
console.log('  }');
console.log('  const up = await db.doc("userPools/" + EMAIL).get();');
console.log('  console.log("userPools ->", up.exists ? "STILL THERE" : "removed");');
console.log('  console.log("");');
console.log('  console.log("Their session document is deleted by the server the next time that");');
console.log('  console.log("cookie is used: /auth/token finds the pass dead, deletes the session");');
console.log('  console.log("and clears the cookie. Nothing here can reach authSessions, because");');
console.log('  console.log("firestore.rules has no match block for it and denies by default.");');
console.log('})();');
