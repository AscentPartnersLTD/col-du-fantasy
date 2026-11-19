/* Firestore rules unit tests, against the real emulator.
 *
 *   node tools-rules-tests/run.js          from the repo root
 *
 * These exist because the alternative was using `firebase deploy` as the compile step
 * with four players as the canary. The emulator loads the SAME firestore.rules the
 * deploy publishes, so a syntax error or a widened grant fails here instead of on a
 * board somebody is trying to draft on.
 *
 * NO REAL ADDRESSES. Every email below is synthetic and seeded by the test itself.
 * The production pool IDS are real, and have to be: `prodPool()` denies a viewer by
 * NAME, so a test against a renamed pool would prove nothing about the rule that
 * actually ships.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, getDocs } from 'firebase/firestore';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

/* ---- synthetic cast ---------------------------------------------------------- */
const OWNER = 'allen@ascentpartnersltd.com';     // the real owner: the rule names it
const JJ = 'jj@players.test';
const JP = 'jp@players.test';
const JB = 'jb@players.test';
const AA = 'aa@players.test';
const PLAYERS = { JJ, JP, JB, AA };
const GUEST = 'guest@themove.test';
const LAPSED = 'lapsed@themove.test';
const STRANGER = 'nobody@elsewhere.test';
/* A member of a NON-Grand-Tour pool, deliberately absent from config/roster.
   Lowry City Rollers is the live shape: a real pool whose members have no
   reason to appear in a roster that predates it. */
const LOWRY = 'lo@rollers.test';

const PROD = ['col-du-fantasy', 'vuelta-2026'];

/* A PASS, AS THE LINK FLOW CREATES ONE. The synthetic address is what a pass mints: a
   local part under a domain with no mailboxes, so it is nobody's real address and it can
   never receive a sign-in code. It is a VIEWER on the showrooms exactly like any other
   guest, which is why no rule in firestore.rules knows anything about passes: the pass
   is checked server side, and what reaches the rules is an ordinary viewer email. */
const GUEST_SYNTH = 'a-guest-kv7q2m4x@guests.coldufantasy.com';

/* THE DEMO POOL. A copy of the sandbox in real life; here it is the smallest document
   that carries the three things the rule reads: `demo: true`, `showroom: true` because
   viewerOf() demands it, and a `viewerSeats` map that gives ONE guest ONE seat.
   The seat is JB because that is the seat the live demo hands out. */
const DEMO = 'tour-demo';
const DEMO_SEAT = 'JB';
const START_PICK = { n: 1, player: 'AA', rider: 'T. Pogacar', team: 'UAE Team Emirates XRG' };
const draftDoc = (picks) => ({
  n: 18, order: ['AA', 'JB', 'JJ', 'JP'], status: 'live',
  snake: ['AA', 'JB', 'JJ', 'JP', 'JP', 'JJ', 'JB', 'AA'],
  queue: ['JB', 'JJ', 'JP', 'JP', 'JJ', 'JB', 'AA'], picks,
});
const pick = (player, rider) => ({ n: 2, player, rider, team: 'A Team' });
const PASS_ID = 'xk4m2qv7a9t3bz6ry8pw5nhs2d4f6g8j';
const VISIT_ID = 'visit_seeded_for_the_rules_test';
const SHOWROOMS = ['tour-showroom', 'vuelta-showroom'];

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 24 * 3600 * 1000);

let env;
let results = { pass: 0, fail: 0, lines: [] };

function record(ok, label, detail) {
  results[ok ? 'pass' : 'fail']++;
  results.lines.push('  [' + (ok ? 'PASS' : 'FAIL') + '] ' +
    String(label).padEnd(62) + (detail || ''));
}

async function expect(label, promise, shouldSucceed, detail) {
  try {
    await (shouldSucceed ? assertSucceeds(promise) : assertFails(promise));
    record(true, label, detail);
  } catch (e) {
    record(false, label, (detail ? detail + ' ' : '') + '<< ' + String(e.message).slice(0, 110));
  }
}

const ctx = (email) =>
  email === null
    ? env.unauthenticatedContext().firestore()
    : env.authenticatedContext('uid_' + email.replace(/[^a-z0-9]/gi, ''), { email }).firestore();

/* ---- the world the rules are tested against ---------------------------------- */
async function seed() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();

    /* config/roster: players and reviewers, both keyed by EMAIL. This is the second
       leak path, and the reason config is no longer signedIn(). */
    await setDoc(doc(db, 'config/roster'), {
      players: { [JJ]: true, [JP]: true, [JB]: true, [AA]: true },
      reviewers: {},
    });

    /* the two PRODUCTION pools, with the members map exactly as it is today */
    for (const pid of PROD) {
      await setDoc(doc(db, 'pools', pid), {
        name: pid,
        members: { [JJ]: 'JJ', [JP]: 'JP', [JB]: 'JB', [AA]: 'AA' },
        order: ['JJ', 'JP', 'JB', 'AA'],
        predictionsLocked: true,
        personaLedger: { order: [], by: {}, seen: {} },
      });
      await setDoc(doc(db, 'pools', pid, 'stages', '21'), { n: 21, win: 'someone' });
      await setDoc(doc(db, 'pools', pid, 'drafts', '21'), { n: 21, picks: [] });
      await setDoc(doc(db, 'pools', pid, 'predictions', 'JJ'), { seat: 'JJ' });
      for (const s of ['JP', 'JB', 'AA']) {
        await setDoc(doc(db, 'pools', pid, 'predictions', s), { seat: s });
      }
    }

    /* the two SHOWROOM copies. members carries NO real address: the copy is
       rewritten to placeholders, which is why `em() in members` admits nobody. */
    for (const pid of SHOWROOMS) {
      await setDoc(doc(db, 'pools', pid), {
        name: pid,
        showroom: true,
        members: { 'jj@showroom.invalid': 'JJ', 'jp@showroom.invalid': 'JP',
                   'jb@showroom.invalid': 'JB', 'aa@showroom.invalid': 'AA' },
        viewers: { [GUEST]: FUTURE, [LAPSED]: PAST, [GUEST_SYNTH]: FUTURE },
        order: ['JJ', 'JP', 'JB', 'AA'],
        predictionsLocked: true,
      });
      await setDoc(doc(db, 'pools', pid, 'stages', '21'), { n: 21, win: 'someone' });
      await setDoc(doc(db, 'pools', pid, 'drafts', '21'), { n: 21, picks: [] });
      await setDoc(doc(db, 'pools', pid, 'predictions', 'JJ'), { seat: 'JJ' });
    }

    /* a NON-Grand-Tour pool whose member is not on config/roster */
    await setDoc(doc(db, 'pools', 'lowry-city-rollers'), {
      name: 'Lowry City Rollers',
      members: { [LOWRY]: 'L1' },
      order: ['L1'],
    });
    await setDoc(doc(db, 'pools', 'lowry-city-rollers', 'stages', '21'), { n: 21 });
    await setDoc(doc(db, 'pools', 'lowry-city-rollers', 'drafts', '21'), { n: 21, picks: [] });
    await setDoc(doc(db, 'userPools', LOWRY), { pools: ['lowry-city-rollers'] });

    /* A GUEST PASS AND A VISIT ROW. Both are written by the SERVER with admin
       credentials in real life, which bypass rules completely; they are seeded here so
       the rules can be asked what a browser may do with them afterwards. The pass id is
       the credential in somebody's link, so the test uses one that LOOKS like a real one
       rather than a friendly name, which is also what a reader of this file should
       expect to see. */
    await setDoc(doc(db, 'guestPasses', PASS_ID), {
      label: 'A Guest', email: GUEST_SYNTH, revoked: false,
      expires: FUTURE, createdAt: Date.now(), pools: SHOWROOMS,
    });
    await setDoc(doc(db, 'guestVisits', VISIT_ID), {
      passId: PASS_ID, label: 'A Guest', email: GUEST_SYNTH, at: Date.now(),
      via: 'link', device: 'iPhone / Safari', entry: 'tour-showroom',
      boards: ['tour-showroom'], tabs: ['Overview'], activeMinutes: 3, lastSeen: Date.now(),
    });

    /* THE DEMO POOL, and the one thing to notice is that GUEST holds a seat here and
       GUEST_SYNTH does not. Both are live viewers of it, so every refusal GUEST_SYNTH
       meets below is the SEAT missing and not the invitation. */
    await setDoc(doc(db, 'pools', DEMO), {
      name: 'Tour demo', showroom: true, demo: true,
      members: {},
      viewers: { [GUEST]: FUTURE, [GUEST_SYNTH]: FUTURE, [LAPSED]: PAST },
      viewerSeats: { [GUEST]: DEMO_SEAT },
      order: ['AA', 'JB', 'JJ', 'JP'],
      names: { AA: 'Allen Abbott', JB: 'Jeff Bush', JJ: 'Jeff Johns', JP: 'Jason Pfetcher' },
      startStage: 18, predictionsLocked: true,
    });
    await setDoc(doc(db, 'pools', DEMO, 'drafts', '18'), draftDoc([START_PICK]));
    await setDoc(doc(db, 'pools', DEMO, 'stages', '17'), { n: 17, win: 'J. Philipsen' });
    await setDoc(doc(db, 'pools', DEMO, 'predictions', 'JB'), { seat: 'JB' });

    /* THE SANDBOX, which is the pool the demo is copied FROM and is not itself a demo.
       It is seeded so the refusal below is measured rather than assumed: a guest must
       not be able to write the pool the copy came from. */
    await setDoc(doc(db, 'pools', 'sandbox'), {
      name: 'Sandbox (test only)', members: {}, order: ['AA', 'JB', 'JJ', 'JP'], startStage: 18,
    });
    await setDoc(doc(db, 'pools', 'sandbox', 'drafts', '18'), draftDoc([START_PICK]));

    /* a pool carrying viewers but NOT flagged a showroom: the flag is required */
    await setDoc(doc(db, 'pools', 'unflagged-copy'), {
      name: 'unflagged', members: {}, viewers: { [GUEST]: FUTURE },
    });

    await setDoc(doc(db, 'userPools', GUEST), { pools: SHOWROOMS });
    await setDoc(doc(db, 'userPools', JJ), { pools: PROD });
    await setDoc(doc(db, 'race', 'legacy'), { note: 'legacy single-pool tree' });
  });
}

/* ---- the tests ---------------------------------------------------------------- */
/* The owner revoke above really writes, so the flag is put back. Nothing after it reads
   the pass today, and that is exactly the kind of assumption that stops being true. */
async function db2Restore() {
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'guestPasses', PASS_ID), { revoked: false });
  });
}

async function run() {
  env = await initializeTestEnvironment({
    projectId: 'col-du-fantasy',
    firestore: {
      rules: readFileSync(join(REPO, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  await env.clearFirestore();
  await seed();

  /* ============================================================= THE GUEST ==== */
  results.lines.push('\nA GUEST IS DENIED ON PRODUCTION, ENTIRELY');
  const g = ctx(GUEST);
  for (const pid of PROD) {
    await expect('guest cannot read the ' + pid + ' pool document',
      getDoc(doc(g, 'pools', pid)), false);
    await expect('guest cannot read a ' + pid + ' stage',
      getDoc(doc(g, 'pools', pid, 'stages', '21')), false);
    await expect('guest cannot read a ' + pid + ' draft',
      getDoc(doc(g, 'pools', pid, 'drafts', '21')), false);
    await expect('guest cannot read a ' + pid + ' prediction',
      getDoc(doc(g, 'pools', pid, 'predictions', 'JJ')), false);
    await expect('guest cannot list ' + pid + ' stages',
      getDocs(collection(g, 'pools', pid, 'stages')), false);
  }

  results.lines.push('\nAND ON THE ADDRESSES, WHICH IS THE SECOND LEAK PATH');
  await expect('guest cannot read config/roster', getDoc(doc(g, 'config/roster')), false,
    'players and reviewers are keyed by email');
  await expect('guest cannot read the legacy race tree', getDoc(doc(g, 'race', 'legacy')), false);
  await expect('guest cannot read another user\'s userPools',
    getDoc(doc(g, 'userPools', JJ)), false);
  await expect('guest CAN read their own userPools',
    getDoc(doc(g, 'userPools', GUEST)), true, 'the switcher needs it');

  results.lines.push('\nREAD-ONLY ON BOTH SHOWROOMS');
  for (const pid of SHOWROOMS) {
    await expect('guest reads the ' + pid + ' pool document',
      getDoc(doc(g, 'pools', pid)), true);
    await expect('guest reads a ' + pid + ' stage',
      getDoc(doc(g, 'pools', pid, 'stages', '21')), true);
    await expect('guest reads a ' + pid + ' draft',
      getDoc(doc(g, 'pools', pid, 'drafts', '21')), true, 'the locked strip');
    await expect('guest reads a ' + pid + ' prediction once locked',
      getDoc(doc(g, 'pools', pid, 'predictions', 'JJ')), true);
    await expect('guest CANNOT write the ' + pid + ' pool document',
      updateDoc(doc(g, 'pools', pid), { name: 'x' }), false);
    await expect('guest CANNOT write a ' + pid + ' draft',
      setDoc(doc(g, 'pools', pid, 'drafts', '21'), { picks: ['x'] }), false);
    await expect('guest CANNOT write a ' + pid + ' stage',
      setDoc(doc(g, 'pools', pid, 'stages', '21'), { win: 'x' }), false);
    await expect('guest CANNOT write a ' + pid + ' prediction',
      setDoc(doc(g, 'pools', pid, 'predictions', 'JJ'), { seat: 'x' }), false);
    await expect('guest CANNOT delete from ' + pid,
      deleteDoc(doc(g, 'pools', pid, 'stages', '21')), false);
    await expect('guest CANNOT flip predictionsLocked on ' + pid,
      updateDoc(doc(g, 'pools', pid), { predictionsLocked: false }), false);
    await expect('guest CANNOT write the persona ledger on ' + pid,
      updateDoc(doc(g, 'pools', pid), { personaLedger: { order: [], by: {}, seen: {} } }), false);
  }
  /* A guest CAN write their own userPools, and that is deliberate: gating it on
     isMember() locked out every pool member who is not in the legacy config/roster.
     What matters is that the write grants NOTHING, so it is asserted directly: the
     guest names a production pool in their own list and still cannot open it. The
     list is a hint for the switcher, never a permission. */
  await expect('a guest may write their own userPools',
    setDoc(doc(g, 'userPools', GUEST), { pools: ['col-du-fantasy', 'vuelta-2026'] }), true);
  await expect('and naming a production pool in it grants nothing',
    getDoc(doc(g, 'pools', 'col-du-fantasy')), false,
    'membership is checked on the pool, never on this list');
  await expect('nor can they write anybody else userPools',
    setDoc(doc(g, 'userPools', JJ), { pools: [] }), false);

  results.lines.push('\nTHE INVITATION IS SCOPED AND EXPIRES');
  const lapsed = ctx(LAPSED);
  await expect('a lapsed viewer is refused', getDoc(doc(lapsed, 'pools', SHOWROOMS[0])), false,
    'expiry is enforced by the rule, not a cleanup job');
  const stranger = ctx(STRANGER);
  await expect('a signed-in stranger reads no showroom',
    getDoc(doc(stranger, 'pools', SHOWROOMS[0])), false);
  await expect('a viewers map on an unflagged pool grants nothing',
    getDoc(doc(g, 'pools', 'unflagged-copy')), false,
    'the showroom flag is required as well as the name');
  await expect('an anonymous reader gets nothing',
    getDoc(doc(ctx(null), 'pools', SHOWROOMS[0])), false);

  /* THE NAME GUARD, tested on its own. Without this the suite proves only that the
     production pools happen to lack a `showroom` flag, which is a fact about the DATA
     and not about the rule. Here the accident is staged deliberately: somebody writes
     the flag and a viewers map onto a production pool. prodPool() must still refuse.
     This is the check that caught a staged regression the rest of the suite did not. */
  for (const pid of PROD) {
    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'pools', pid),
        { showroom: true, viewers: { [GUEST]: FUTURE } });
    });
    await expect('a showroom flag on ' + pid + ' still grants a viewer nothing',
      getDoc(doc(g, 'pools', pid)), false, 'denied by NAME, not by the flag');
    await expect('nor its stages', getDoc(doc(g, 'pools', pid, 'stages', '21')), false);
    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'pools', pid),
        { showroom: deleteField(), viewers: deleteField() });
    });
  }

  /* ============================================================ THE PLAYERS ==== */
  results.lines.push('\nEACH PLAYER IS UNCHANGED ON THEIR PRODUCTION POOL');
  for (const [seat, email] of Object.entries(PLAYERS)) {
    const p = ctx(email);
    for (const pid of PROD) {
      await expect(seat + ' reads the ' + pid + ' pool document',
        getDoc(doc(p, 'pools', pid)), true);
      await expect(seat + ' reads a ' + pid + ' stage',
        getDoc(doc(p, 'pools', pid, 'stages', '21')), true);
      await expect(seat + ' writes a ' + pid + ' draft',
        setDoc(doc(p, 'pools', pid, 'drafts', '21'), { n: 21, picks: [] }), true,
        'drafting still works');
    }
    await expect(seat + ' reads config/roster', getDoc(doc(p, 'config/roster')), true,
      'isMember() still admits a player');
    await expect(seat + ' writes the persona ledger',
      updateDoc(doc(p, 'pools', 'vuelta-2026'),
        { personaLedger: { order: ['JJ'], by: {}, seen: {} } }), true);
    await expect(seat + ' cannot read a showroom they were not invited to',
      getDoc(doc(p, 'pools', SHOWROOMS[0])), false);
  }

  const jj = ctx(JJ);
  await expect('a player still cannot write a stage document',
    setDoc(doc(jj, 'pools', 'vuelta-2026', 'stages', '21'), { win: 'x' }), false,
    'owner only, unchanged');
  await expect('a player cannot widen the pool document',
    updateDoc(doc(jj, 'pools', 'vuelta-2026'), { name: 'hijacked' }), false);

  /* ============================== A MEMBER WHO IS NOT ON config/roster ========= */
  /* THE LOCKOUT CHECK. config/roster is the LEGACY single-pool roster, and isMember()
     is built on it. Four rules were tightened from signedIn() to isMember(), so any
     pool member who is not in that roster loses whatever those rules gate.
     Lowry City Rollers is the live case: a real pool whose members have no reason to
     be in a roster that predates it. The assertions below mirror what the board
     actually does on sign-in, in order, for such a member. */
  results.lines.push('\nA POOL MEMBER WHO IS NOT ON config/roster');
  const lowry = ctx(LOWRY);
  await expect('they read their own pool document',
    getDoc(doc(lowry, 'pools', 'lowry-city-rollers')), true, 'the members map, unchanged');
  await expect('they read its stages',
    getDoc(doc(lowry, 'pools', 'lowry-city-rollers', 'stages', '21')), true);
  await expect('they read its draft',
    getDoc(doc(lowry, 'pools', 'lowry-city-rollers', 'drafts', '21')), true);
  await expect('they WRITE its draft, which is the game',
    setDoc(doc(lowry, 'pools', 'lowry-city-rollers', 'drafts', '21'), { n: 21, picks: [] }), true);
  await expect('they read their own userPools',
    getDoc(doc(lowry, 'userPools', LOWRY)), true, 'resolvePool and the switcher');
  /* THE ONE THAT MATTERS. Every board writes this on sign-in, to keep the switcher and
     the not-a-member reroute working, and the write is swallowed by .catch(()=>{}).
     So a tightened rule here does not error: it silently stops maintaining the entry,
     and a member whose entry was never written lands on "You are not in a pool yet". */
  await expect('they WRITE their own userPools, which the board does on every sign-in',
    setDoc(doc(lowry, 'userPools', LOWRY), { pools: ['lowry-city-rollers'] }), true,
    'swallowed by catch(), so a denial is silent');
  await expect('they are still refused config/roster',
    getDoc(doc(lowry, 'config/roster')), false, 'no board reads it; guests stay out');
  await expect('they are still refused a production pool',
    getDoc(doc(lowry, 'pools', 'vuelta-2026')), false);
  await expect('they are still refused a showroom',
    getDoc(doc(lowry, 'pools', SHOWROOMS[0])), false);

  /* ============================================================== THE OWNER ==== */
  results.lines.push('\nTHE OWNER IS UNCHANGED');
  const o = ctx(OWNER);
  for (const pid of [...PROD, ...SHOWROOMS]) {
    await expect('owner reads ' + pid, getDoc(doc(o, 'pools', pid)), true);
    await expect('owner writes ' + pid,
      updateDoc(doc(o, 'pools', pid), { touched: true }), true);
    await expect('owner writes a ' + pid + ' stage',
      setDoc(doc(o, 'pools', pid, 'stages', '21'), { n: 21, win: 'owner' }), true);
  }
  /* PREDICTIONS ON A SHOWROOM, which is the one grant the owner did not have.
     Asserted in all three directions, because a grant is only as good as the two
     refusals beside it: the production pools must stay closed, and a viewer must
     never reach it however the flag is written. */
  for (const pid of SHOWROOMS) {
    await expect('owner WRITES predictions on ' + pid,
      setDoc(doc(o, 'pools', pid, 'predictions', 'JJ'),
        { seat: 'JJ', gc: 'a rider' }), true, 'the copy has no seat holder');
    await expect('owner writes a second seat on ' + pid,
      setDoc(doc(o, 'pools', pid, 'predictions', 'AA'), { seat: 'AA' }), true);
  }
  for (const pid of PROD) {
    await expect('owner still CANNOT write predictions on ' + pid,
      setDoc(doc(o, 'pools', pid, 'predictions', 'JJ'), { seat: 'JJ' }), false,
      'they hold no seat there, and the new clause excludes it by name');
  }
  await expect('owner CANNOT write predictions on an unflagged copy',
    setDoc(doc(o, 'pools', 'unflagged-copy', 'predictions', 'JJ'), { seat: 'JJ' }), false,
    'the showroom flag is required, not just the absence of a production name');
  /* THE FLAG ALONE MUST NOT BE ENOUGH. Staged deliberately: a production pool is given
     `showroom: true`, exactly the accident the name guard exists for, and the owner is
     still refused. Without prodPool() in showroomPool() this is the check that fails. */
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'pools', PROD[0]), { showroom: true });
  });
  await expect('a showroom flag on ' + PROD[0] + ' grants the owner nothing',
    setDoc(doc(o, 'pools', PROD[0], 'predictions', 'JJ'), { seat: 'JJ' }), false,
    'denied by NAME, so a stray flag cannot open a production pool');
  await expect('and a viewer still cannot write predictions there',
    setDoc(doc(ctx(GUEST), 'pools', PROD[0], 'predictions', 'JJ'), { seat: 'JJ' }), false);
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'pools', PROD[0]), { showroom: deleteField() });
  });

  /* A VIEWER NEVER WRITES PREDICTIONS, on the pool they are actually invited to.
     The guest block above covers this too; it is repeated here because the clause
     that moved is this one, and a grant added beside a refusal is where a refusal
     quietly stops being tested. */
  for (const pid of SHOWROOMS) {
    await expect('guest CANNOT write predictions on ' + pid,
      setDoc(doc(ctx(GUEST), 'pools', pid, 'predictions', 'JJ'), { seat: 'JJ' }), false);
  }

  /* ============================================== GUEST PASSES AND VISITS ==== */
  results.lines.push('\nTHE PASS TABLE AND THE VISIT LOG ARE OWNER ONLY');

  /* THE PASS ID IS A SECRET AND KNOWING IT BUYS NOTHING HERE. The test asks for the
     pass by its exact id, which is the strongest version of the question: a guest who
     has their own link already knows this string, and must still be refused. */
  const synth = ctx(GUEST_SYNTH);
  await expect('a LIVE guest cannot read their own pass',
    getDoc(doc(synth, 'guestPasses', PASS_ID)), false, 'even knowing its id exactly');
  await expect('a live guest cannot LIST the passes',
    getDocs(collection(synth, 'guestPasses')), false, 'it is a list of every live link');
  await expect('a live guest cannot write a pass',
    setDoc(doc(synth, 'guestPasses', PASS_ID), { revoked: false }), false);
  await expect('a live guest cannot MINT a pass',
    setDoc(doc(synth, 'guestPasses', 'minted-by-a-guest'), { email: GUEST_SYNTH }), false);
  await expect('a live guest cannot read the visit log',
    getDoc(doc(synth, 'guestVisits', VISIT_ID)), false, 'it is a record about them');
  await expect('a live guest cannot list the visit log',
    getDocs(collection(synth, 'guestVisits')), false);
  await expect('a live guest cannot write a visit',
    setDoc(doc(synth, 'guestVisits', VISIT_ID), { activeMinutes: 0 }), false,
    'minutes are counted server side or not at all');
  await expect('a live guest cannot forge a visit',
    setDoc(doc(synth, 'guestVisits', 'forged-by-a-guest'), { passId: PASS_ID }), false);

  /* AND THE GRANT THE REFUSALS ARE MEASURED AGAINST. A denial proves nothing about
     WHICH rule denied, so the same reads are run as the owner. */
  await expect('the OWNER reads a pass', getDoc(doc(o, 'guestPasses', PASS_ID)), true);
  await expect('the owner lists the passes', getDocs(collection(o, 'guestPasses')), true);
  await expect('the owner writes a pass, which is how one is revoked',
    updateDoc(doc(o, 'guestPasses', PASS_ID), { revoked: true }), true);
  await expect('the owner reads a visit', getDoc(doc(o, 'guestVisits', VISIT_ID)), true);
  await expect('the owner lists the visits', getDocs(collection(o, 'guestVisits')), true);

  /* The other three readers this suite already knows about, for completeness: the
     distinction is owner and not-owner, so none of them may look either. */
  await expect('an ordinary guest cannot read a pass',
    getDoc(doc(ctx(GUEST), 'guestPasses', PASS_ID)), false);
  await expect('a PLAYER cannot read a pass',
    getDoc(doc(ctx(JJ), 'guestPasses', PASS_ID)), false, 'not a player surface either');
  await expect('a signed-in stranger cannot read a pass',
    getDoc(doc(ctx(STRANGER), 'guestPasses', PASS_ID)), false);
  await expect('and nobody signed out can', getDoc(doc(ctx(null), 'guestPasses', PASS_ID)), false);

  /* THE SYNTHETIC GUEST IS STILL AN ORDINARY VIEWER, which is the whole reason the
     rules needed no concept of a pass. Asserted rather than assumed: if this failed, the
     link flow would be granting access some other way than the viewers map. */
  for (const pid of SHOWROOMS) {
    await expect('the synthetic guest reads ' + pid, getDoc(doc(synth, 'pools', pid)), true);
    await expect('and is refused ' + PROD[0] + ' from the same session',
      getDoc(doc(synth, 'pools', PROD[0])), false);
  }
  await expect('the synthetic guest writes nothing on a showroom',
    updateDoc(doc(synth, 'pools', SHOWROOMS[0]), { touched: true }), false);
  await db2Restore();

  /* ======================================================= THE DEMO POOL ==== */
  results.lines.push('\nA GUEST PLAYS ONE SEAT ON A DEMO POOL');
  const dg = ctx(GUEST);
  const dref = (c) => doc(c, 'pools', DEMO, 'drafts', '18');

  await expect('the guest READS the demo pool', getDoc(doc(dg, 'pools', DEMO)), true);
  await expect('and its draft', getDoc(dref(dg)), true);
  await expect('THE GUEST DRAFTS AS ' + DEMO_SEAT,
    setDoc(dref(dg), draftDoc([START_PICK, pick(DEMO_SEAT, 'J. Vingegaard')])), true,
    'one pick appended, carrying their own seat');

  /* Put it back before the refusals, so each one is measured against the same start
     state rather than against whatever the previous assertion left. */
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'pools', DEMO, 'drafts', '18'), draftDoc([START_PICK]));
  });

  for (const other of ['AA', 'JJ', 'JP']) {
    await expect('the guest CANNOT draft for ' + other,
      setDoc(dref(dg), draftDoc([START_PICK, pick(other, 'J. Vingegaard')])), false,
      'the appended pick must name their own seat');
  }
  await expect('and cannot append TWO picks at once',
    setDoc(dref(dg), draftDoc([START_PICK, pick(DEMO_SEAT, 'A'), pick(DEMO_SEAT, 'B')])), false,
    'a draft grows by one, so two is somebody rewriting the day');
  /* THE BOUNDARY THAT MATTERS: once the draft has GROWN, nothing can be edited in
     place. That is what stops a guest rewriting a pick another seat has made. */
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'pools', DEMO, 'drafts', '18'),
      draftDoc([START_PICK, pick(DEMO_SEAT, 'J. Vingegaard')]));
  });
  await expect('the guest cannot rewrite a pick in place',
    setDoc(dref(dg), draftDoc([START_PICK, pick(DEMO_SEAT, 'Somebody else')])), false,
    'same length, so it is an edit and not an append');
  await expect('nor rewrite somebody else\'s pick in place',
    setDoc(dref(dg), draftDoc([pick('JJ', 'x'), pick(DEMO_SEAT, 'J. Vingegaard')])), false,
    'the appended-pick branch needs the list to GROW, so an edit never qualifies');
  await expect('but CAN still append their own next pick',
    setDoc(dref(dg), draftDoc([START_PICK, pick(DEMO_SEAT, 'J. Vingegaard'), pick(DEMO_SEAT, 'W. van Aert')])), true,
    'growing by one, carrying their seat, from a draft that is already two long');

  /* THE RESET IS PERMITTED, and it is the button. It is NOT seat scoped, because the
     opening pick belongs to AA and a guest who could not write it could not reset the
     board they are playing on. A guest could therefore put a DIFFERENT single pick at
     the top, which on a throwaway copy whose other three seats are bots is an accepted
     trade, the same one PHASE2-DEMO.md already accepted about all four seats living in
     one picks array. It is written down here rather than left to be discovered. */
  await expect('and CAN reset to the opening state',
    setDoc(dref(dg), draftDoc([START_PICK])), true,
    'the Reset demo button, which is why this shape is allowed at all');

  await expect('the guest writes NOTHING ELSE on the demo pool',
    updateDoc(doc(dg, 'pools', DEMO), { touched: true }), false);
  await expect('not the persona ledger either',
    updateDoc(doc(dg, 'pools', DEMO), { personaLedger: { order: [], by: {}, seen: {} } }), false);
  await expect('not a stage', setDoc(doc(dg, 'pools', DEMO, 'stages', '17'), { n: 17 }), false);
  await expect('not a prediction, which PHASE2-DEMO.md granted and this does not',
    setDoc(doc(dg, 'pools', DEMO, 'predictions', DEMO_SEAT), { seat: DEMO_SEAT }), false);

  results.lines.push('\nAND THE SEAT IS WHAT GRANTS IT, not the invitation');
  const dgs = ctx(GUEST_SYNTH);
  await expect('a viewer with NO seat reads the demo pool', getDoc(doc(dgs, 'pools', DEMO)), true);
  await expect('and CANNOT write its draft',
    setDoc(dref(dgs), draftDoc([START_PICK, pick(DEMO_SEAT, 'J. Vingegaard')])), false,
    'viewerSeats is what grants, and they are not in it');
  await expect('a LAPSED viewer with a seat would still be refused',
    setDoc(dref(ctx(LAPSED)), draftDoc([START_PICK, pick(DEMO_SEAT, 'x')])), false);
  await expect('a signed-in stranger cannot write it',
    setDoc(dref(ctx(STRANGER)), draftDoc([START_PICK, pick(DEMO_SEAT, 'x')])), false);

  results.lines.push('\nAND NOWHERE ELSE, WHICH IS THE HALF THAT MATTERS');
  for (const pid of SHOWROOMS) {
    await expect('the demo guest cannot write the ' + pid + ' draft',
      setDoc(doc(dg, 'pools', pid, 'drafts', '21'), draftDoc([START_PICK])), false,
      'a showroom carries no demo flag');
  }
  for (const pid of PROD) {
    await expect('nor the ' + pid + ' draft',
      setDoc(doc(dg, 'pools', pid, 'drafts', '21'), draftDoc([START_PICK])), false);
    await expect('nor read ' + pid + ' at all', getDoc(doc(dg, 'pools', pid)), false);
  }
  await expect('nor the SANDBOX the demo was copied from',
    setDoc(doc(dg, 'pools', 'sandbox', 'drafts', '18'), draftDoc([START_PICK])), false,
    'the sandbox is not flagged demo, so the grant does not reach it');

  /* THE FLAG AND THE NAME ARE BOTH LOAD-BEARING, staged deliberately. Giving a
     production pool a demo flag and a viewerSeats entry is the accident the name guard
     exists for, and it is the one a reader would assume could never happen. */
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'pools', PROD[0]), {
      demo: true, showroom: true, viewers: { [GUEST]: FUTURE }, viewerSeats: { [GUEST]: DEMO_SEAT },
    });
  });
  await expect('a demo flag on ' + PROD[0] + ' grants the guest nothing',
    setDoc(doc(dg, 'pools', PROD[0], 'drafts', '21'), draftDoc([START_PICK])), false,
    'refused by NAME, before the flag is even read');
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'pools', PROD[0]), {
      demo: deleteField(), showroom: deleteField(),
      viewers: deleteField(), viewerSeats: deleteField(),
    });
  });

  /* And the mirror: take the demo flag OFF the demo pool with the seat left in place,
     which is the check PHASE2-DEMO.md listed and the one that proves the flag is doing
     the work rather than the viewerSeats map alone. */
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'pools', DEMO), { demo: false });
  });
  await expect('with demo:false the seat grants nothing',
    setDoc(dref(dg), draftDoc([START_PICK, pick(DEMO_SEAT, 'x')])), false);
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'pools', DEMO), { demo: deleteField() });
  });
  await expect('and with the flag ABSENT it is a refusal, not an error',
    setDoc(dref(dg), draftDoc([START_PICK, pick(DEMO_SEAT, 'x')])), false,
    'the in-guard is why this denies as a rule rather than erroring');
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'pools', DEMO), { demo: true });
  });

  results.lines.push('\nPLAYERS AND THE OWNER ARE UNCHANGED BY ANY OF IT');
  await expect('a player still drafts on their own pool',
    setDoc(doc(ctx(JJ), 'pools', PROD[0], 'drafts', '21'), draftDoc([START_PICK])), true);
  await expect('a player cannot write the demo draft',
    setDoc(dref(ctx(JJ)), draftDoc([START_PICK])), false,
    'they are in neither viewers nor viewerSeats there');
  await expect('the owner writes the demo pool', updateDoc(doc(o, 'pools', DEMO), { touched: true }), true);
  await expect('and its draft', setDoc(dref(o), draftDoc([START_PICK])), true);

  await expect('owner reads config/roster', getDoc(doc(o, 'config/roster')), true);
  await expect('owner writes config/roster',
    setDoc(doc(o, 'config/roster'), { players: {}, reviewers: {} }), true);

  await env.cleanup();

  console.log(results.lines.join('\n'));
  const total = results.pass + results.fail;
  console.log('\n' + results.pass + '/' + total + ' rules assertions passed');
  if (results.fail) process.exitCode = 1;
}

run().catch((e) => {
  console.error('\nFAILED TO RUN: ' + e.message);
  console.error('Is the Firestore emulator up? run.js starts it for you.');
  process.exitCode = 1;
});
