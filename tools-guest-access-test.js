#!/usr/bin/env node
/* Col du Fantasy - the guest access gate, run against the Firestore EMULATOR.
 *
 *   node_modules/.bin/firebase emulators:exec --only firestore "node tools-guest-access-test.js"
 *
 * WHY THIS EXISTS AND WHY IT IS AN EMULATOR RUN. Twice in this project a denial was
 * reported as evidence that a rule worked, and both times the denial was default-deny
 * from no matching rule. A denial proves nothing about WHICH rule denied it. So every
 * check below is paired: the grant is exercised, and then the grant is REMOVED and the
 * same operation must fail. A rule that cannot be made to fail was never being read.
 *
 * It evaluates the repo copy of firestore.rules. It never touches the live project:
 * initializeTestEnvironment points at 127.0.0.1 and the project id is a throwaway.
 *
 * THE FIXTURE REPRODUCES THE LIVE MEMBERSHIP SHAPES, not the live addresses. The real
 * addresses were supplied masked and are nobody's business here; what matters is the
 * shape of each grant. Synthetic addresses stand in for everyone except the two whose
 * EXACT TEXT is itself under test: the owner address, and the test guest on the same
 * domain which must get no owner rights from sharing it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment, assertFails, assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteField,
} = require('firebase/firestore');

/* ---------- addresses ---------------------------------------------------------- */
const OWNER = 'allen@ascentpartnersltd.com';   // literal: the rules compare this exactly
const GUEST = 'info@ascentpartnersltd.com';    // literal: same domain, must get nothing
const AA2 = 'seated-no-roster@example.com';    // shape (a) and (d): seated AA, off roster
const JJ = 'jj@example.com';
const JP = 'jp@example.com';
const JB = 'jb@example.com';
const FAMILY = 'unseated-no-roster@example.com';   // shape (b): member, no seat, off roster
const REV_UNSEATED = 'reviewer-unseated@example.com'; // roster reviewer, no seat
const REV_AF = 'reviewer-af@example.com';      // shape (c): roster reviewer WITH a seat
const REV_TB = 'reviewer-tb@example.com';      // shape (c)
const STRANGER = 'stranger@example.com';       // signed in, in nothing
const EXPIRED = 'expired-guest@example.com';
const MALFORMED = 'malformed-guest@example.com';

/* ---------- pools -------------------------------------------------------------- */
const TOUR = 'col-du-fantasy';
const VUELTA = 'vuelta-2026';
const LOWRY = 'lowry-city-rollers';
const SANDBOX = 'sandbox';
const SHOW_TOUR = 'tour-showroom';
const SHOW_VUELTA = 'vuelta-showroom';
/* PHASE 2. The demo pools and the viewerSeats write grant are NOT in the shipped
   ruleset: this branch finishes the READ-ONLY showroom. The design and the checks that
   went with it are kept verbatim in PHASE2-DEMO.md so nothing has to be rediscovered.
   They are named here only so the deferred section can say what it is deferring. */
const DEMO_TOUR = 'tour-demo';
const DEMO_VUELTA = 'vuelta-demo';
const PRODUCTION = [TOUR, VUELTA, LOWRY, SANDBOX];
const SHOWROOMS = [SHOW_TOUR, SHOW_VUELTA];
const DEMOS = [];   /* phase 2 */

/* ---------- dates -------------------------------------------------------------- */
/* Computed from today so the suite does not rot into a pass. The expiry is a Firestore
   TIMESTAMP, built the SAME WAY tools/showroom-invite.js builds it: the END of the named
   day, 23:59:59Z, so an invitation "until 2027-03-31" is good for the whole of that day.
   An ISO STRING here would be the field type that firestore.rules now refuses by name,
   which is what the malformed-expiry check below exists to prove. */
function atEndOf(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Date(d.toISOString().slice(0, 10) + 'T23:59:59Z');
}
const FUTURE = atEndOf(30);
const TODAY = atEndOf(0);
const YESTERDAY = atEndOf(-1);

/* ---------- harness ------------------------------------------------------------ */
let env;
const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail: detail || '' });
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + label + (detail ? '  ' + detail : ''));
}
async function allow(label, fn) {
  try { await assertSucceeds(fn()); record(label, true, 'allowed'); }
  catch (e) { record(label, false, 'expected ALLOW, got denial: ' + short(e)); }
}
async function deny(label, fn) {
  try { await assertFails(fn()); record(label, true, 'denied'); }
  catch (e) { record(label, false, 'expected DENY, it was ALLOWED'); }
}
function short(e) { return String((e && e.message) || e).split('\n')[0].slice(0, 120); }

function as(email) { return env.authenticatedContext(uidFor(email), { email, email_verified: true }).firestore(); }
function anon() { return env.unauthenticatedContext().firestore(); }
const uidFor = (e) => 'cdf_' + e.replace(/[^a-z0-9]/gi, '_');

/* Reading firestore.rules as TEXT, for the phase 2 deferral assertion only. An allow
   clause runs from `allow` to its semicolon and often spans several lines, so whole
   statements are matched rather than lines, and comments are stripped first: comments
   carry the words "viewer" and "showroom" everywhere by design, and a gate that reads
   its own prose proves nothing. */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const ALLOW_CLAUSE = /allow\s[^;]*;/g;
const WRITE_VERB = /\b(write|create|update|delete)\b/;
const VIEWER_WORD = /viewerOf|viewerSeats|showroom/i;

const rd = (db, p) => () => getDoc(doc(db, p));
const ls = (db, p) => () => getDocs(collection(db, p));
const wr = (db, p, data) => () => setDoc(doc(db, p), data);
const up = (db, p, data) => () => updateDoc(doc(db, p), data);

/* ---------- fixture ------------------------------------------------------------ */
/* `members` is email to SEAT. A member with no seat is a key whose value is falsy;
   the live inventory shows two of them and does not say which falsy value, so both
   representations are seeded and both are asserted to behave identically. */
function poolDoc(extra) {
  return Object.assign({
    name: 'fixture',
    startStage: 4,
    order: ['JJ', 'JP', 'JB', 'AA'],
    seats: ['JJ', 'JP', 'JB', 'AA'],
    names: { JJ: 'Seat JJ', JP: 'Seat JP', JB: 'Seat JB', AA: 'Seat AA' },
    judge: 'JJ',
    predictionsLocked: false,
    personaLedger: { order: ['JJ', 'JP', 'JB', 'AA'], by: {}, seen: {} },
    boardConfig: { race: [], predictionsThroughStage: 0 },
  }, extra);
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'config/roster'), {
      /* `em() in roster().players` is satisfied by a map or a list. A map is seeded
         because a roster carries more than names; the list parity check below proves
         the choice does not decide any result. */
      players: { [OWNER]: true, [JJ]: true, [JP]: true, [JB]: true },
      reviewers: { [REV_UNSEATED]: true, [REV_AF]: true, [REV_TB]: true },
    });

    /* PRODUCTION, reproducing the live inventory shapes. No viewers, no showroom
       flag, no demo flag, and a memberEmails array alongside members on all four. */
    await setDoc(doc(db, 'pools/' + TOUR), poolDoc({
      members: { [AA2]: 'AA', [JP]: 'JP', [REV_UNSEATED]: '', [OWNER]: 'AA', [JJ]: 'JJ', [JB]: 'JB', [FAMILY]: null },
      memberEmails: [AA2, JP, REV_UNSEATED, OWNER, JJ, JB, FAMILY],
    }));
    await setDoc(doc(db, 'pools/' + VUELTA), poolDoc({
      members: { [AA2]: 'AA', [JJ]: 'JJ', [JP]: 'JP', [JB]: 'JB', [OWNER]: 'AA' },
      memberEmails: [AA2, JJ, JP, JB, OWNER],
      predictionsLocked: true,
    }));
    await setDoc(doc(db, 'pools/' + LOWRY), poolDoc({
      members: { [REV_AF]: 'AF', [REV_TB]: 'TB', [OWNER]: 'ALA', [AA2]: 'ALA' },
      memberEmails: [REV_AF, REV_TB, OWNER, AA2],
      order: ['AF', 'TB', 'ALA'], seats: ['AF', 'TB', 'ALA'], judge: 'AF',
    }));
    await setDoc(doc(db, 'pools/' + SANDBOX), poolDoc({
      members: { [AA2]: 'AA', [OWNER]: 'AA' }, memberEmails: [AA2, OWNER],
    }));

    /* GUESTS. members is EMPTY on every guest pool. The brief said the members map
       should hold the guest emails; it must not, and this is the one place the build
       departs from it. A guest in members satisfies inPool(), and inPool() is what
       pools/{poolId}/drafts grants WRITE to, so it would reopen the exact hole the
       viewer role exists to close. Seat codes, names and order are separate fields and
       are what the board renders from, so the boards still look identical. */
    const viewers = { [GUEST]: FUTURE, [EXPIRED]: YESTERDAY, [MALFORMED]: 'soon' };
    await setDoc(doc(db, 'pools/' + SHOW_TOUR), poolDoc({
      members: {}, memberEmails: [], showroom: true, viewers, predictionsLocked: true,
    }));
    await setDoc(doc(db, 'pools/' + SHOW_VUELTA), poolDoc({
      members: {}, memberEmails: [], showroom: true, viewers, predictionsLocked: false,
    }));

    /* Subcollections on every pool, so a read or write has something to land on and a
       denial is never just an absent document. */
    for (const p of PRODUCTION.concat(SHOWROOMS, DEMOS)) {
      await setDoc(doc(db, 'pools/' + p + '/drafts/4'), { n: 4, status: 'open', picks: [], kassei: {}, order: ['JJ', 'JP', 'JB', 'AA'] });
      await setDoc(doc(db, 'pools/' + p + '/stages/3'), { route: 'A to B', type: 'flat', days: { JJ: 1 }, picks: { JJ: [] } });
      await setDoc(doc(db, 'pools/' + p + '/engagement/' + AA2), { seen: 1 });
      await setDoc(doc(db, 'pools/' + p + '/engagement/' + GUEST), { seen: 1 });
      for (const s of ['JJ', 'JB', 'JP', 'AA']) await setDoc(doc(db, 'pools/' + p + '/predictions/' + s), { seat: s, gc: 'A rider' });
    }
    await setDoc(doc(db, 'userPools/' + GUEST), { pools: SHOWROOMS });
    await setDoc(doc(db, 'userPools/' + AA2), { pools: PRODUCTION });
    await setDoc(doc(db, 'race/demo'), { note: 'the legacy race tree' });
    /* The LEGACY single-pool collections. A denial against a document that does not
       exist is indistinguishable from a denial by rule, so each one is real. */
    await setDoc(doc(db, 'drafts/4'), { n: 4, picks: [] });
    await setDoc(doc(db, 'engagement/' + JJ), { seen: 1 });
  });
}

/* Re-seed one pool document with a mutation applied, for the grant-removal half. */
async function mutatePool(poolId, mutate) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const snap = await getDoc(doc(db, 'pools/' + poolId));
    const data = snap.data();
    mutate(data);
    await setDoc(doc(db, 'pools/' + poolId), data);
  });
}

/* ---------- the checks --------------------------------------------------------- */
async function run() {
  console.log('\n=== 0. the owner, as a control ===');
  {
    const db = as(OWNER);
    await allow('owner reads col-du-fantasy', rd(db, 'pools/' + TOUR));
    await allow('owner writes a stage doc', wr(db, 'pools/' + TOUR + '/stages/9', { days: {}, picks: {} }));
    await allow('owner reads a showroom pool', rd(db, 'pools/' + SHOW_TOUR));
  }

  console.log('\n=== 1a. a SEATED member who is NOT on the roster ===');
  {
    const db = as(AA2);
    for (const p of PRODUCTION) await allow('shape a reads ' + p, rd(db, 'pools/' + p));
    await allow('shape a reads the draft', rd(db, 'pools/' + TOUR + '/drafts/4'));
    await allow('shape a WRITES the draft', up(db, 'pools/' + TOUR + '/drafts/4', { status: 'open' }));
    await allow('shape a reads a scored stage', rd(db, 'pools/' + TOUR + '/stages/3'));
    await allow('shape a writes their own predictions (AA, unlocked pool)', wr(db, 'pools/' + TOUR + '/predictions/AA', { seat: 'AA', gc: 'X' }));
    await deny('shape a writes ANOTHER seat predictions', wr(db, 'pools/' + TOUR + '/predictions/JJ', { seat: 'JJ' }));
    await allow('shape a writes their own engagement', wr(db, 'pools/' + TOUR + '/engagement/' + AA2, { seen: 2 }));
    await deny('shape a writes someone else engagement', wr(db, 'pools/' + TOUR + '/engagement/' + JJ, { seen: 2 }));
    await allow('shape a writes their own userPools', wr(db, 'userPools/' + AA2, { pools: PRODUCTION }));
    await deny('shape a writes the pool doc', up(db, 'pools/' + TOUR, { name: 'hijacked' }));
    await deny('shape a writes a stage doc', wr(db, 'pools/' + TOUR + '/stages/3', { days: {} }));
  }
  console.log('  -- grant removed: drop the address from members --');
  await mutatePool(TOUR, (d) => { delete d.members[AA2]; });
  {
    const db = as(AA2);
    await deny('REMOVED: shape a reads col-du-fantasy', rd(db, 'pools/' + TOUR));
    await deny('REMOVED: shape a writes the draft', up(db, 'pools/' + TOUR + '/drafts/4', { status: 'open' }));
    await deny('REMOVED: shape a writes their own predictions', wr(db, 'pools/' + TOUR + '/predictions/AA', { seat: 'AA' }));
  }
  await mutatePool(TOUR, (d) => { d.members[AA2] = 'AA'; });

  console.log('\n=== 1b. an UNSEATED member who is NOT on the roster (the family seat) ===');
  {
    const db = as(FAMILY);
    await allow('shape b reads the pool doc', rd(db, 'pools/' + TOUR));
    await allow('shape b reads the draft', rd(db, 'pools/' + TOUR + '/drafts/4'));
    await allow('shape b reads a scored stage', rd(db, 'pools/' + TOUR + '/stages/3'));
    await allow('shape b writes their own userPools', wr(db, 'userPools/' + FAMILY, { pools: [TOUR] }));
    await allow('shape b writes their own engagement', wr(db, 'pools/' + TOUR + '/engagement/' + FAMILY, { seen: 1 }));
    /* HONEST RESULT, and it is the one worth reading. An unseated member is inPool(),
       and pools/{poolId}/drafts grants write to inPool(), so the RULES do not stop
       them writing a draft. What stops them is the BOARD: myCode is
       (pool.members||{})[myEmail]||null, which is falsy with no seat, and every write
       site is behind it. CAN_PLAY being false is a client property, not a server one,
       and this check records that rather than implying the server enforces it. */
    await allow('shape b CAN write the draft at the RULES layer (board gates it, not rules)', up(db, 'pools/' + TOUR + '/drafts/4', { status: 'open' }));
    await deny('shape b writes predictions for a seat they do not hold', wr(db, 'pools/' + TOUR + '/predictions/AA', { seat: 'AA' }));
    await deny('shape b writes the pool doc', up(db, 'pools/' + TOUR, { name: 'x' }));
  }
  console.log('  -- grant removed: drop the address from members --');
  await mutatePool(TOUR, (d) => { delete d.members[FAMILY]; });
  await deny('REMOVED: shape b reads the pool doc', rd(as(FAMILY), 'pools/' + TOUR));
  await mutatePool(TOUR, (d) => { d.members[FAMILY] = null; });
  await allow('shape b with a null seat behaves as empty string', rd(as(FAMILY), 'pools/' + TOUR));

  console.log('\n=== 1c. a SEATED roster REVIEWER, not a player ===');
  {
    const db = as(REV_AF);
    await allow('reviewer AF reads lowry', rd(db, 'pools/' + LOWRY));
    await allow('reviewer AF WRITES the draft', up(db, 'pools/' + LOWRY + '/drafts/4', { status: 'open' }));
    await allow('reviewer AF writes their own predictions (AF)', wr(db, 'pools/' + LOWRY + '/predictions/AF', { seat: 'AF' }));
    await allow('reviewer AF writes their own pool engagement', wr(db, 'pools/' + LOWRY + '/engagement/' + REV_AF, { seen: 1 }));
    await allow('reviewer TB writes their own predictions (TB)', wr(as(REV_TB), 'pools/' + LOWRY + '/predictions/TB', { seat: 'TB' }));
    await deny('reviewer AF writes TB predictions', wr(db, 'pools/' + LOWRY + '/predictions/TB', { seat: 'TB' }));
  }
  console.log('  -- isPlayer() parity: empty the roster players map entirely --');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'config/roster'), { players: {} });
  });
  {
    const db = as(REV_AF);
    await allow('PARITY: AF still drafts with roster.players EMPTY', up(db, 'pools/' + LOWRY + '/drafts/4', { status: 'open' }));
    await allow('PARITY: AF still writes predictions with roster.players EMPTY', wr(db, 'pools/' + LOWRY + '/predictions/AF', { seat: 'AF' }));
    await allow('PARITY: AF still writes engagement with roster.players EMPTY', wr(db, 'pools/' + LOWRY + '/engagement/' + REV_AF, { seen: 2 }));
  }
  console.log('  -- roster as a LIST rather than a map, to prove the shape decides nothing --');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'config/roster'), { players: [OWNER, JJ, JP, JB], reviewers: [REV_UNSEATED, REV_AF, REV_TB] });
  });
  await allow('PARITY: AF drafts with a LIST roster', up(as(REV_AF), 'pools/' + LOWRY + '/drafts/4', { status: 'open' }));

  console.log('\n=== 1d. one seat, two addresses, two pools ===');
  {
    await allow('AA via address one reads col-du-fantasy', rd(as(AA2), 'pools/' + TOUR));
    await allow('AA via address two reads col-du-fantasy', rd(as(OWNER), 'pools/' + TOUR));
    await allow('AA via address one writes AA predictions in col-du-fantasy', wr(as(AA2), 'pools/' + TOUR + '/predictions/AA', { seat: 'AA' }));
    /* vuelta-2026 is seeded LOCKED, so the unlocked-only write must refuse for both
       addresses. That is the predictions lock doing its job, not a membership failure. */
    await deny('AA via address one cannot write predictions in a LOCKED pool', wr(as(AA2), 'pools/' + VUELTA + '/predictions/AA', { seat: 'AA' }));
    await allow('AA via address one reads a locked pool predictions', rd(as(AA2), 'pools/' + VUELTA + '/predictions/JJ'));
    await allow('AA via address one holds ALA in lowry too', rd(as(AA2), 'pools/' + LOWRY));
  }

  console.log('\n=== 2. the owner check is an EXACT address, not a domain ===');
  {
    const db = as(GUEST);
    await deny('same-domain guest reads col-du-fantasy', rd(db, 'pools/' + TOUR));
    await deny('same-domain guest writes a stage doc', wr(db, 'pools/' + TOUR + '/stages/3', { days: {} }));
    await deny('same-domain guest writes config/roster', wr(db, 'config/roster', { players: {} }));
    await deny('same-domain guest writes a production pool doc', up(db, 'pools/' + VUELTA, { name: 'x' }));
    await deny('same-domain guest deletes an engagement doc', wr(db, 'pools/' + TOUR + '/engagement/' + AA2, { seen: 9 }));
    /* THIS WAS allow AND IS NOW deny, and it is the single most valuable line in the
       suite. config/roster holds `players` and `reviewers` KEYED BY EMAIL, under what was
       a blanket signedIn() read. Inviting anybody at all to sign in turned that into a
       handout of every player's address, by a path that has nothing to do with pool
       membership and that the showroom design does not touch. Closing it is a change to
       a PRODUCTION rule, made deliberately. */
    await deny('same-domain guest reads config/roster (the address list)', rd(db, 'config/roster'));
    await deny('same-domain guest reads the legacy race tree', rd(db, 'race/demo'));
    await deny('same-domain guest reads the legacy top-level drafts', rd(db, 'drafts/4'));
    await deny('same-domain guest writes legacy top-level engagement as themselves', wr(db, 'engagement/' + GUEST, { seen: 1 }));
  }

  console.log('\n=== 3. the guest in a SHOWROOM pool: reads everything, writes nothing ===');
  {
    const db = as(GUEST);
    for (const p of SHOWROOMS) {
      await allow('guest reads ' + p + ' pool doc', rd(db, 'pools/' + p));
      await allow('guest reads ' + p + ' drafts', ls(db, 'pools/' + p + '/drafts'));
      await allow('guest reads ' + p + ' stages', ls(db, 'pools/' + p + '/stages'));
      /* ENGAGEMENT IS NOT READABLE BY A VIEWER, and it is not copied either. Its
         DOCUMENT IDS ARE EMAIL ADDRESSES, so the collection cannot be handed to a
         guest without handing over the addresses, and no id is scrubbable without
         breaking the "doc == em()" write rule it depends on. Nothing a viewer sees
         reads it. Two independent denials, the rule and the absence of the data. */
      await deny('guest reads ' + p + ' engagement (ids are addresses)', ls(db, 'pools/' + p + '/engagement'));
      await deny('guest WRITES ' + p + ' draft', up(db, 'pools/' + p + '/drafts/4', { status: 'open' }));
      await deny('guest WRITES ' + p + ' stage', wr(db, 'pools/' + p + '/stages/3', { days: {} }));
      await deny('guest WRITES ' + p + ' predictions', wr(db, 'pools/' + p + '/predictions/AA', { seat: 'AA' }));
      await deny('guest WRITES ' + p + ' pool doc', up(db, 'pools/' + p, { name: 'x' }));
      await deny('guest WRITES ' + p + ' personaLedger', up(db, 'pools/' + p, { personaLedger: { order: [], by: {}, seen: {} } }));
      await deny('guest WRITES ' + p + ' predictionsLocked', up(db, 'pools/' + p, { predictionsLocked: true }));
      await deny('guest WRITES ' + p + ' engagement', wr(db, 'pools/' + p + '/engagement/' + GUEST, { seen: 5 }));
    }
    /* The predictions privacy rule is mirrored, not relaxed: tour-showroom is locked so
       a guest sees the reveal, vuelta-showroom is not so they see nothing. */
    await allow('guest reads predictions in a LOCKED showroom', rd(db, 'pools/' + SHOW_TOUR + '/predictions/JJ'));
    await deny('guest reads predictions in an UNLOCKED showroom', rd(db, 'pools/' + SHOW_VUELTA + '/predictions/JJ'));
    await allow('guest writes their own userPools', wr(db, 'userPools/' + GUEST, { pools: SHOWROOMS.concat(DEMOS) }));
    await deny('guest writes someone else userPools', wr(db, 'userPools/' + AA2, { pools: [] }));
  }

  console.log('\n=== 4. the guest and PRODUCTION: every read and every write refused ===');
  {
    const db = as(GUEST);
    for (const p of PRODUCTION) {
      await deny('guest reads ' + p + ' pool doc', rd(db, 'pools/' + p));
      await deny('guest reads ' + p + ' drafts', ls(db, 'pools/' + p + '/drafts'));
      await deny('guest reads ' + p + ' stages', ls(db, 'pools/' + p + '/stages'));
      await deny('guest reads ' + p + ' engagement', ls(db, 'pools/' + p + '/engagement'));
      await deny('guest reads ' + p + ' predictions', rd(db, 'pools/' + p + '/predictions/JJ'));
      await deny('guest WRITES ' + p + ' draft', up(db, 'pools/' + p + '/drafts/4', { status: 'open' }));
      await deny('guest WRITES ' + p + ' stage', wr(db, 'pools/' + p + '/stages/3', { days: {} }));
      await deny('guest WRITES ' + p + ' pool doc', up(db, 'pools/' + p, { name: 'x' }));
      await deny('guest WRITES ' + p + ' predictions', wr(db, 'pools/' + p + '/predictions/AA', { seat: 'AA' }));
    }
  }
  /* THE CHECK THAT MATTERS MOST, and the reason prodPool() names the two pools instead
     of inferring them. Write BOTH halves of a valid invitation onto the real
     col-du-fantasy: the showroom flag, and the guest in viewers with a live expiry. A
     design that trusted the flag would hand over the season here. */
  console.log('  -- a showroom flag and a live invitation written onto PRODUCTION --');
  await mutatePool(TOUR, (d) => { d.showroom = true; d.viewers = { [GUEST]: FUTURE }; });
  {
    const db = as(GUEST);
    await deny('FLAGGED PRODUCTION: guest still cannot read col-du-fantasy', rd(db, 'pools/' + TOUR));
    await deny('FLAGGED PRODUCTION: guest still cannot read its drafts', ls(db, 'pools/' + TOUR + '/drafts'));
    await deny('FLAGGED PRODUCTION: guest still cannot read its stages', ls(db, 'pools/' + TOUR + '/stages'));
    await deny('FLAGGED PRODUCTION: guest still cannot read its predictions', rd(db, 'pools/' + TOUR + '/predictions/JJ'));
  }
  await mutatePool(TOUR, (d) => { delete d.showroom; delete d.viewers; });
  await allow('members still read col-du-fantasy after the flag is removed', rd(as(AA2), 'pools/' + TOUR));

  console.log('\n=== 5. the DEMO pool: SHIPPED 2026-11-19, and narrowed on the way in ===');
  /* THIS BLOCK USED TO ASSERT THE DEFERRAL, and it asserted it rather than asserting
     around it, which is exactly why it is the first thing that had to change when the
     deferral ended. The three reasons PHASE2-DEMO.md gave for deferring are all now
     answered rather than ignored:

       1. "a write grant for a pool type that does not exist cannot be proved
          unreachable against live data" - tour-demo now exists, and the refusals below
          are measured against it rather than against a hypothetical.
       2. "tools-rules-guard.js asserts not one allow-write clause mentions a viewer" -
          that sentence is retired there too, replaced by five narrower ones.
       3. "the showroom goes live on its own" - it did, on 2026-11-18.

     WHAT SHIPPED IS SMALLER THAN WHAT WAS DESIGNED. PHASE2-DEMO.md also granted
     predictions and the predictionsLocked flip to a demo guest. Neither shipped, and
     the absence is asserted below rather than left as a thing nobody got round to. */
  {
    const rules = stripComments(fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8'));
    const writeClauses = (rules.match(ALLOW_CLAUSE) || [])
      .filter((l) => WRITE_VERB.test(l.split(':')[0]));
    /* NARROWED 2026-11-17, and narrowed rather than relaxed. This read
       `VIEWER_WORD.test(l)`, which is /viewerOf|viewerSeats|showroom/i, so it refused
       any write clause that merely said the word showroom. The owner may now seed a
       showroom copy's predictions, because the copy tool empties `members` and that is
       exactly what leaves nobody able to write them; that clause names showroomPool()
       and is correct, and it was failing a check about a different thing.
       A VIEWER write is still refused outright, and a clause naming a showroom without
       requiring owner() counts as one. */
    const viewerWrites = writeClauses.filter((l) => /viewerOf/.test(l));
    /* ONE CLAUSE, and the count is asserted FIRST. A filter-and-every check passes
       vacuously when the clause is deleted, which is how 27 of 27 held on 2026-11-17
       over a rule that had been removed. Zero here means the demo grant was dropped,
       which is a different thing from there being none to drop. */
    record('exactly one viewer write clause ships', viewerWrites.length === 1,
      viewerWrites.join(' | ') || 'none of ' + writeClauses.length + ' write clauses');
    record('and it needs a DEMO SEAT as well as a viewer',
      viewerWrites.length === 1 && /hasDemoSeat\(poolId\)/.test(viewerWrites[0]),
      'a showroom viewer holds no seat and is refused by that term');
    record('and the shape of the write is scoped',
      viewerWrites.length === 1 && /demoDraftShapeOk\(poolId\)/.test(viewerWrites[0]),
      'one appended pick carrying their own seat, or the reset shape');
    record('it is on DRAFTS and nowhere else',
      /match \/drafts\/\{stage\}[^}]*allow write: if viewerOf\(poolId\) && hasDemoSeat/.test(rules),
      'not the pool doc, not stages, not predictions');
    /* WHAT WAS DESIGNED AND DELIBERATELY NOT SHIPPED, asserted so it cannot arrive by
       accident later: PHASE2-DEMO.md also granted a demo guest their own predictions
       and the predictionsLocked flip. */
    record('the predictions half of the design did NOT ship',
      !/allow write: if viewerOf\(poolId\) && hasDemoSeat\(poolId\) && demoSeat/.test(rules) &&
      !/viewerOf\(poolId\) && hasDemoSeat\(poolId\)[\s\S]{0,160}predictionsLocked/.test(rules),
      'drafts only, which is what the brief asked for');
    record('a viewer still writes nothing without the demo flag',
      /function isDemoPool\(poolId\)[\s\S]{0,240}poolCfg\(poolId\)\.demo == true/.test(rules) &&
      /function isDemoPool\(poolId\)[\s\S]{0,240}!prodPool\(poolId\)/.test(rules),
      'the flag AND the name, the same pair showroomPool() carries');
    /* And the clause that DOES ship is described, not merely tolerated: a check that
       only says what must not exist stops noticing what does. One clause, owner-gated,
       and inside the predictions block rather than loose in the pool. */
    const showroomWrites = writeClauses.filter((l) => /showroom/i.test(l));
    record('exactly one showroom write clause ships, owner-gated',
      showroomWrites.length === 1 && /owner\(\)/.test(showroomWrites[0]),
      showroomWrites.join(' | ') || 'absent');
    record('and it sits inside the predictions block',
      /match \/predictions\/\{seat\}[^}]*allow write: if owner\(\) && showroomPool\(poolId\);/
        .test(rules),
      'not loose in the pool, where it would cover every subcollection');
    /* viewerSeats IS in the rules now, and the thing worth asserting is how MANY times:
       three reads, all inside the two demo helpers. A fourth is a second grant. */
    record('viewerSeats is read three times, all in the demo helpers',
      (rules.match(/viewerSeats/g) || []).length === 3,
      'hasDemoSeat twice, demoSeat once');
    record('and a demo seat never comes from members',
      /function hasDemoSeat\(poolId\)[\s\S]{0,200}viewerSeats/.test(rules) &&
      !/function hasDemoSeat\(poolId\)[\s\S]{0,200}members/.test(rules),
      'inPool() reads members, so member-gated statements stay dead for a guest');
    record('the phase 2 design is written down, not just dropped',
      fs.existsSync(path.join(__dirname, 'PHASE2-DEMO.md')), 'PHASE2-DEMO.md');
  }


  console.log('\n=== 6. expiry, and a malformed expiry ===');
  {
    await deny('EXPIRED guest reads a showroom pool', rd(as(EXPIRED), 'pools/' + SHOW_TOUR));
    await deny('EXPIRED guest reads a showroom stage', ls(as(EXPIRED), 'pools/' + SHOW_TOUR + '/stages'));
    await deny('EXPIRED guest writes a demo draft', up(as(EXPIRED), 'pools/' + DEMO_TOUR + '/drafts/4', { status: 'open' }));
    await deny('MALFORMED expiry reads a showroom pool', rd(as(MALFORMED), 'pools/' + SHOW_TOUR));
    await deny('MALFORMED expiry writes a demo draft', up(as(MALFORMED), 'pools/' + DEMO_TOUR + '/drafts/4', { status: 'open' }));
  }
  console.log('  -- the expiry day itself is INCLUSIVE --');
  await mutatePool(SHOW_TOUR, (d) => { d.viewers[GUEST] = TODAY; });
  await allow('an expiry of TODAY still reads', rd(as(GUEST), 'pools/' + SHOW_TOUR));
  await mutatePool(SHOW_TOUR, (d) => { d.viewers[GUEST] = YESTERDAY; });
  await deny('an expiry of YESTERDAY does not', rd(as(GUEST), 'pools/' + SHOW_TOUR));
  await mutatePool(SHOW_TOUR, (d) => { d.viewers[GUEST] = FUTURE; });

  console.log('  -- grant removed: drop the viewers map entirely --');
  await mutatePool(SHOW_TOUR, (d) => { delete d.viewers; });
  await deny('REMOVED viewers: guest cannot read the showroom pool', rd(as(GUEST), 'pools/' + SHOW_TOUR));
  await deny('REMOVED viewers: guest cannot read showroom stages', ls(as(GUEST), 'pools/' + SHOW_TOUR + '/stages'));
  await mutatePool(SHOW_TOUR, (d) => { d.viewers = { [GUEST]: FUTURE, [EXPIRED]: YESTERDAY, [MALFORMED]: 'soon' }; });

  console.log('\n=== 7. a signed-in stranger, and an unauthenticated caller ===');
  {
    const db = as(STRANGER);
    await deny('stranger reads a showroom pool', rd(db, 'pools/' + SHOW_TOUR));
    await deny('stranger reads a demo pool', rd(db, 'pools/' + DEMO_TOUR));
    await deny('stranger reads col-du-fantasy', rd(db, 'pools/' + TOUR));
    await deny('stranger writes a showroom draft', up(db, 'pools/' + SHOW_TOUR + '/drafts/4', { status: 'open' }));
    /* Recorded as a sanity line only. An unauthenticated denial is default-deny from no
       matching rule and proves nothing about which rule denied it, which is a mistake
       already made once on this project and written down. */
    await deny('SANITY ONLY: unauthenticated reads a showroom pool', rd(anon(), 'pools/' + SHOW_TOUR));
  }

  console.log('\n=== 8. the showroom carries no real address ===');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const p of SHOWROOMS.concat(DEMOS)) {
      const d = (await getDoc(doc(db, 'pools/' + p))).data() || {};
      const members = Object.keys(d.members || {});
      const emails = (d.memberEmails || []);
      const viewers = Object.keys(d.viewers || {});
      /* PRESENT and EMPTY are two separate claims. Absent, `members` makes
         `em() in poolCfg(poolId).members` an evaluation error rather than a false,
         which is proved on the emulator and is why the copy writes {} and never
         deletes the field. inPool() is production and is not touched for this. */
      record(p + ': members field is PRESENT', !!d.members && typeof d.members === 'object',
        d.members === undefined ? 'ABSENT: inPool() would error here' : 'present');
      record(p + ': members map is empty', members.length === 0, members.length + ' keys');
      record(p + ': memberEmails is empty', emails.length === 0, emails.length + ' entries');
      const leaked = viewers.filter((v) => ![GUEST, EXPIRED, MALFORMED].includes(v));
      record(p + ': viewers holds guest addresses only', leaked.length === 0, leaked.join(',') || 'clean');
      record(p + ': seat codes survived', (d.order || []).length > 0, (d.order || []).join('>'));
    }
  });
}

/* ---------- main --------------------------------------------------------------- */
(async () => {
  const rulesPath = path.join(__dirname, 'firestore.rules');
  if (!fs.existsSync(rulesPath)) { console.error('no firestore.rules beside this tool'); process.exit(1); }
  env = await initializeTestEnvironment({
    projectId: 'cdf-guest-access-test',
    firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(rulesPath, 'utf8') },
  });
  await env.clearFirestore();
  await seed();
  try { await run(); } finally { await env.cleanup(); }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '-'.repeat(72));
  console.log(results.length + ' checks, ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log('  ' + f.label + '  ' + f.detail));
    process.exit(1);
  }
  console.log('guest access gate PASSED');
})().catch((e) => { console.error('\nSUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
