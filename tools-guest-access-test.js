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
const DEMO_TOUR = 'tour-demo';
const DEMO_VUELTA = 'vuelta-demo';
const PRODUCTION = [TOUR, VUELTA, LOWRY, SANDBOX];
const SHOWROOMS = [SHOW_TOUR, SHOW_VUELTA];
const DEMOS = [DEMO_TOUR, DEMO_VUELTA];

/* ---------- dates -------------------------------------------------------------- */
/* Computed from today so the suite does not rot into a pass. The expiry is INCLUSIVE
   of its own day, so "today" must be allowed and "yesterday" must not. */
function iso(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const FUTURE = iso(30);
const TODAY = iso(0);
const YESTERDAY = iso(-1);

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
    await setDoc(doc(db, 'pools/' + DEMO_TOUR), poolDoc({
      members: {}, memberEmails: [], demo: true, viewers,
      viewerSeats: { [GUEST]: 'AA', [EXPIRED]: 'AA', [MALFORMED]: 'AA' },
    }));
    await setDoc(doc(db, 'pools/' + DEMO_VUELTA), poolDoc({
      members: {}, memberEmails: [], demo: true, viewers,
      viewerSeats: { [GUEST]: 'AA', [EXPIRED]: 'AA', [MALFORMED]: 'AA' },
    }));

    /* Subcollections on every pool, so a read or write has something to land on and a
       denial is never just an absent document. */
    for (const p of PRODUCTION.concat(SHOWROOMS, DEMOS)) {
      await setDoc(doc(db, 'pools/' + p + '/drafts/4'), { n: 4, status: 'open', picks: [], kassei: {}, order: ['JJ', 'JP', 'JB', 'AA'] });
      await setDoc(doc(db, 'pools/' + p + '/stages/3'), { route: 'A to B', type: 'flat', days: { JJ: 1 }, picks: { JJ: [] } });
      await setDoc(doc(db, 'pools/' + p + '/engagement/' + AA2), { seen: 1 });
      await setDoc(doc(db, 'pools/' + p + '/engagement/' + GUEST), { seen: 1 });
      /* tour-demo deliberately has THREE predictions: the guest's own AA submission is
         the fourth, which is what fires the lock. vuelta-demo has all four already. */
      const seats = (p === DEMO_TOUR) ? ['JJ', 'JB', 'JP'] : ['JJ', 'JB', 'JP', 'AA'];
      for (const s of seats) await setDoc(doc(db, 'pools/' + p + '/predictions/' + s), { seat: s, gc: 'A rider' });
    }
    await setDoc(doc(db, 'userPools/' + GUEST), { pools: SHOWROOMS.concat(DEMOS) });
    await setDoc(doc(db, 'userPools/' + AA2), { pools: PRODUCTION });
    await setDoc(doc(db, 'race/demo'), { note: 'phase 2 replay lands here' });
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
    await allow('same-domain guest reads config (any signed-in user may)', rd(db, 'config/roster'));
  }

  console.log('\n=== 3. the guest in a SHOWROOM pool: reads everything, writes nothing ===');
  {
    const db = as(GUEST);
    for (const p of SHOWROOMS) {
      await allow('guest reads ' + p + ' pool doc', rd(db, 'pools/' + p));
      await allow('guest reads ' + p + ' drafts', ls(db, 'pools/' + p + '/drafts'));
      await allow('guest reads ' + p + ' stages', ls(db, 'pools/' + p + '/stages'));
      await allow('guest reads ' + p + ' engagement', ls(db, 'pools/' + p + '/engagement'));
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

  console.log('\n=== 5. the guest in a DEMO pool: their seat only ===');
  {
    const db = as(GUEST);
    for (const p of DEMOS) {
      await allow('guest reads ' + p + ' pool doc', rd(db, 'pools/' + p));
      await allow('guest WRITES ' + p + ' draft', up(db, 'pools/' + p + '/drafts/4', { status: 'open' }));
      await allow('guest reads ' + p + ' stages', ls(db, 'pools/' + p + '/stages'));
      await deny('guest WRITES ' + p + ' stage', wr(db, 'pools/' + p + '/stages/3', { days: {} }));
      await deny('guest WRITES ' + p + ' personaLedger', up(db, 'pools/' + p, { personaLedger: { order: [], by: {}, seen: {} } }));
      await deny('guest WRITES ' + p + ' arbitrary pool field', up(db, 'pools/' + p, { name: 'x' }));
      await deny('guest WRITES ' + p + ' engagement', wr(db, 'pools/' + p + '/engagement/' + GUEST, { seen: 5 }));
    }
    await allow('guest writes their OWN seat predictions in tour-demo', wr(db, 'pools/' + DEMO_TOUR + '/predictions/AA', { seat: 'AA', gc: 'X' }));
    await deny('guest writes ANOTHER seat predictions in tour-demo', wr(db, 'pools/' + DEMO_TOUR + '/predictions/JJ', { seat: 'JJ' }));
    await allow('guest reads their OWN seat predictions before the lock', rd(db, 'pools/' + DEMO_TOUR + '/predictions/AA'));
    await deny('guest reads ANOTHER seat predictions before the lock', rd(db, 'pools/' + DEMO_TOUR + '/predictions/JJ'));
    /* The lock. vuelta-demo has all four seat documents, tour-demo is one short until
       the write above lands, and the rule names the same four seats as production. */
    await allow('guest fires the lock in vuelta-demo, all four present', up(db, 'pools/' + DEMO_VUELTA, { predictionsLocked: true }));
    await deny('guest cannot set predictionsLocked FALSE', up(db, 'pools/' + DEMO_VUELTA, { predictionsLocked: false }));
    await allow('guest reads another seat predictions AFTER the lock', rd(db, 'pools/' + DEMO_VUELTA + '/predictions/JJ'));
  }
  console.log('  -- lock refused when a seat document is missing --');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { deleteDoc } = require('firebase/firestore');
    await deleteDoc(doc(ctx.firestore(), 'pools/' + DEMO_TOUR + '/predictions/AA'));
    await updateDoc(doc(ctx.firestore(), 'pools/' + DEMO_TOUR), { predictionsLocked: false });
  });
  await deny('lock refused in tour-demo with only three seats in', up(as(GUEST), 'pools/' + DEMO_TOUR, { predictionsLocked: true }));

  console.log('  -- grant removed: drop viewerSeats, keep viewers --');
  await mutatePool(DEMO_VUELTA, (d) => { delete d.viewerSeats; });
  {
    const db = as(GUEST);
    await allow('REMOVED seat: guest still READS the demo pool', rd(db, 'pools/' + DEMO_VUELTA));
    await deny('REMOVED seat: guest can no longer write the draft', up(db, 'pools/' + DEMO_VUELTA + '/drafts/4', { status: 'open' }));
    await deny('REMOVED seat: guest can no longer write predictions', wr(db, 'pools/' + DEMO_VUELTA + '/predictions/AA', { seat: 'AA' }));
  }
  console.log('  -- grant removed: drop the demo flag, keep viewers and viewerSeats --');
  await mutatePool(DEMO_VUELTA, (d) => { d.viewerSeats = { [GUEST]: 'AA' }; delete d.demo; });
  await deny('REMOVED demo flag: no draft write even with a seat', up(as(GUEST), 'pools/' + DEMO_VUELTA + '/drafts/4', { status: 'open' }));
  await mutatePool(DEMO_VUELTA, (d) => { d.demo = true; });

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
