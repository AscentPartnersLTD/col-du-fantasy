/* End-to-end test for tools/showroom-copy.js, against the Firestore emulator.
 *
 * It seeds a production-shaped pool, runs the real tool as a child process, and reads
 * the result back. The point is the SCRUB: an address is planted in a draft pick's
 * `by` field, which no curated list of fields would have covered, and the test fails
 * if it reaches the copy.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const PROJECT = 'col-du-fantasy';
const EMU = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const BASE = 'http://' + EMU + '/v1/projects/' + PROJECT + '/databases/(default)/documents';

let pass = 0, fail = 0;
function check(ok, label, detail) {
  (ok ? pass++ : fail++);
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(58) + (detail || ''));
}

const enc = (x) => {
  if (x === null) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return { integerValue: String(x) };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(enc) } };
  const fields = {}; for (const [k, v] of Object.entries(x)) fields[k] = enc(v);
  return { mapValue: { fields } };
};
const encDoc = (o) => { const fields = {}; for (const [k, v] of Object.entries(o)) fields[k] = enc(v); return { fields }; };

async function put(path, obj) {
  const r = await fetch(BASE + path, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify(encDoc(obj)),
  });
  if (!r.ok) throw new Error('seed ' + path + ': ' + r.status + ' ' + (await r.text()).slice(0, 120));
}
async function raw(path) {
  const r = await fetch(BASE + path, { headers: { authorization: 'Bearer owner' } });
  return { ok: r.ok, status: r.status, text: await r.text() };
}
async function wipe(path) {
  await fetch(BASE + path, { method: 'DELETE', headers: { authorization: 'Bearer owner' } }).catch(() => {});
}

const PLAYER = 'jj@players.test';
const PLAYER2 = 'aa@players.test';

async function run() {
  console.log('\nSHOWROOM COPY, END TO END ON THE EMULATOR');

  /* ---- seed a production-shaped vuelta-2026 ---- */
  await put('/pools/vuelta-2026', {
    name: 'Vuelta',
    members: { [PLAYER]: 'JJ', [PLAYER2]: 'AA' },
    memberEmails: [PLAYER, PLAYER2],
    order: ['JJ', 'AA'],
    predictionsLocked: true,
    boardConfig: { race: [{ n: 21, route: 'Granada' }] },
  });
  /* THE PLANTED ADDRESS. A draft pick carries `by`, set from the drafting session's
     own email. A scrub written as a list of known fields misses it. */
  await put('/pools/vuelta-2026/drafts/21', {
    n: 21,
    picks: [{ n: 1, player: 'JJ', rider: 'W. van Aert', by: PLAYER, admin: false }],
    queue: [],
  });
  await put('/pools/vuelta-2026/stages/21', { n: 21, win: 'someone', reads: { JJ: 'a read' } });
  await put('/pools/vuelta-2026/predictions/JJ', { seat: 'JJ', gc: 'someone' });

  await wipe('/pools/vuelta-showroom/drafts/21');
  await wipe('/pools/vuelta-showroom/stages/21');
  await wipe('/pools/vuelta-showroom/predictions/JJ');
  await wipe('/pools/vuelta-showroom');

  const env = { ...process.env, FIRESTORE_EMULATOR_HOST: EMU };
  const runTool = (args) => spawnSync(process.execPath,
    [join(REPO, 'tools', 'showroom-copy.js'), ...args],
    { cwd: REPO, encoding: 'utf8', env });

  /* ---- 1. dry run writes nothing ---- */
  const dry = runTool(['--only', 'vuelta']);
  check(dry.status === 0, 'dry run exits 0', dry.status === 0 ? '' : dry.stderr.slice(0, 90));
  check(/DRY RUN/.test(dry.stdout), 'it says DRY RUN');
  check(/WOULD WRITE \d+ document/.test(dry.stdout), 'it prints what it would write',
    (dry.stdout.match(/WOULD WRITE \d+ document\(s\)/) || [''])[0]);
  check(/scrubbed/.test(dry.stdout), 'it reports the scrub in the dry run');
  const after = await raw('/pools/vuelta-showroom');
  check(!after.ok, 'the target does not exist after a dry run', 'HTTP ' + after.status);

  /* ---- 2. apply ---- */
  const app = runTool(['--only', 'vuelta', '--apply']);
  check(app.status === 0, 'apply exits 0', app.status === 0 ? '' : app.stderr.slice(0, 120));
  check(/WROTE \d+ document/.test(app.stdout), 'it reports what it wrote',
    (app.stdout.match(/WROTE \d+ document\(s\)/) || [''])[0]);

  const pool = await raw('/pools/vuelta-showroom');
  check(pool.ok, 'the showroom pool now exists');
  /* The emulator pretty-prints, so the value is `"booleanValue": true` with a space.
     The first version of this assertion matched the compact form and failed on a
     document that was entirely correct. */
  check(/"showroom"\s*:\s*{\s*"booleanValue"\s*:\s*true/.test(pool.text),
    'the copy declares itself a showroom', 'the rule requires the flag AND the name');
  check(/copiedFrom/.test(pool.text), 'it records what it was copied from');
  check(!/memberEmails/.test(pool.text), 'memberEmails is dropped', 'a second copy of the same addresses');

  /* ---- 3. THE SCRUB, which is the point ---- */
  const bodies = [pool.text,
    (await raw('/pools/vuelta-showroom/drafts/21')).text,
    (await raw('/pools/vuelta-showroom/stages/21')).text,
    (await raw('/pools/vuelta-showroom/predictions/JJ')).text].join('\n');

  check(!bodies.includes(PLAYER) && !bodies.includes(PLAYER2),
    'NO real address appears anywhere in the copy',
    'including the one planted in a draft pick');
  /* THE MEMBERS MAP IS EMPTY AND PRESENT, which is two assertions and both matter.
     Empty, because anything in it is a key that could match a caller and `inPool()` is
     what grants a draft WRITE. Present, because a pool document with no `members` field
     makes `em() in poolCfg(poolId).members` an evaluation error rather than a false. */
  const poolObj = JSON.parse(pool.text);
  const memberField = (poolObj.fields || {}).members;
  check(!!memberField && !!memberField.mapValue, 'the members field is PRESENT',
    'absent, it makes inPool() an evaluation error instead of a false');
  check(memberField && Object.keys(memberField.mapValue.fields || {}).length === 0,
    'the members map is EMPTY', 'no key, so no caller can ever match it');
  check(!/showroom\.invalid/.test(pool.text), 'no placeholder member was invented',
    'placeholders built from the seat collided when two addresses shared one');
  check(/van Aert/.test(bodies), 'the picks themselves survived the scrub');
  check(/a read/.test(bodies), 'the stage reads survived');

  /* ---- 4. the refusal ---- */
  const src = join(REPO, 'tools', 'showroom-copy.js');
  const { readFileSync } = await import('node:fs');
  const tool = readFileSync(src, 'utf8');
  check(/NEVER_A_TARGET\s*=\s*\['col-du-fantasy',\s*'vuelta-2026'\]/.test(tool),
    'both production pools are named as forbidden targets');
  check(/REFUSED: .* is a production pool and can never be a target/.test(tool),
    'and the refusal exits before any work');

  console.log('\n' + pass + '/' + (pass + fail) + ' showroom-copy assertions passed');
  if (fail) process.exitCode = 1;
}

run().catch(e => { console.error('FAILED TO RUN: ' + e.message); process.exitCode = 1; });
