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
        viewers: { [GUEST]: FUTURE, [LAPSED]: PAST },
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
