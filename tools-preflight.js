#!/usr/bin/env node
/* SESSION PREFLIGHT. Run this FIRST, every session, before any other work.
 *
 *   node tools-preflight.js
 *   node tools-preflight.js --no-fetch     skip the network fetch, for an offline look
 *
 * WHY THIS EXISTS. Thirteen stage closes have produced thirteen different failures,
 * and the closes themselves were never the fragile part. Three things have to line up
 * before a close is even possible: a clone somebody remembered to fetch, a CDF_KEY that
 * is set on this machine, and a reachable feed. A different one breaks on a different
 * night, and each time it is diagnosed from scratch at the worst moment.
 *
 * The specific failure that produced this file, on 2026-09-04: a session reported
 * tools-combatif-gate.js missing, ran `git log --all` to confirm it, and was wrong both
 * times, because the clone was 18 commits stale and `git log --all` only ever sees what
 * has been fetched. The same session raised a roster-floor alarm that commit 293dde3 had
 * already fixed three days earlier. Both alarms had one cause.
 *
 * A STALE CLONE DOES NOT REPORT STALENESS. IT REPORTS ABSENCE, AND ABSENCE IS WHAT A
 * READER ACTS ON. That is the whole failure in one sentence, and it is the same shape
 * the repo already records about the col-break Worker: a comment in the repo is not
 * evidence that a pipeline exists, so check the provider.
 *
 * Every check names its own remedy. A check that fails without telling you what to do
 * is how a five-minute problem becomes an hour. Any FAIL exits non-zero and the session
 * stops here.
 */
'use strict';

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = __dirname;
const POOL = process.env.CDF_POOL || 'vuelta-2026';
const RACE = process.env.CDF_RACE || 'vuelta';
const HOST = 'racecenter.lavuelta.es';
const API = 'https://api.coldufantasy.com';

const NO_FETCH = process.argv.includes('--no-fetch');

/* ------------------------------------------------------------------ output -- */

const results = [];
function record(ok, label, detail, remedy) {
  results.push({ ok: ok, label: label, detail: detail, remedy: remedy });
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + String(label).padEnd(34) +
    (detail == null ? '' : detail));
}

/* ---------------------------------------------------------------- helpers -- */

function sh(cmd) {
  return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function get(url, headers, timeoutMs) {
  return new Promise(resolve => {
    const req = https.get(url, {
      headers: Object.assign({ 'user-agent': 'cdf-preflight/1' }, headers || {}),
      timeout: timeoutMs || 20000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

/* ------------------------------------------------------------ the checks -- */

/* WHICH MACHINE. Dragon and Gerald hold different credentials, and the repo records
   commands that work on one and crash on the other. Naming the machine up front stops a
   session applying Gerald's instructions on Dragon. */
function checkMachine() {
  const host = os.hostname();
  /* Match on a prefix, not on equality: this workstation reports "Dragon_PC" and an
     exact-match table silently reported it as an unknown machine. */
  const H = String(host).toUpperCase();
  const known = ['Dragon', 'Gerald'];
  const name = known.filter(k => H.indexOf(k.toUpperCase()) === 0)[0] || null;
  record(true, 'machine',
    host + (name ? ' (' + name + ')' : ' (not a machine CLAUDE.md names)') +
    '  user ' + (os.userInfo().username || '?') + '  ' + process.platform);
  if (name === 'Gerald') {
    console.log('         note: CLOUDFLARE_API_TOKEN lives here, and `wrangler login` cannot work.');
  }
  return name;
}

/* GIT. The fetch is the point. Everything else in a session is judged against what the
   remote actually holds, and a conclusion drawn before this ran is not a conclusion. */
function checkGit() {
  let fetched = false;
  if (!NO_FETCH) {
    try { sh('git fetch origin --prune'); fetched = true; }
    catch (e) {
      record(false, 'git fetch', 'could not reach origin: ' + String(e.message).split('\n')[0],
        'Check the network and your GitHub credentials, then re-run. Do NOT conclude a\n' +
        '         file is missing or a bug is live until this passes.');
      return null;
    }
  }
  record(fetched, 'git fetch', fetched ? 'origin fetched' : 'SKIPPED with --no-fetch',
    fetched ? null :
      'You passed --no-fetch. Nothing below about missing files can be trusted.\n' +
      '         Re-run without --no-fetch before drawing any conclusion.');

  let behind = null, ahead = null, head = '?', remote = '?';
  try {
    head = sh('git rev-parse --short HEAD');
    remote = sh('git rev-parse --short origin/main');
    const c = sh('git rev-list --left-right --count HEAD...origin/main').split(/\s+/);
    ahead = Number(c[0]); behind = Number(c[1]);
  } catch (e) {
    record(false, 'git position', 'could not read: ' + e.message, 'Is this a git repo with an origin remote?');
    return null;
  }

  record(behind === 0, 'clone is current',
    'HEAD ' + head + ', origin/main ' + remote + ', ' + ahead + ' ahead, ' + behind + ' behind',
    behind === 0 ? null :
      'You are ' + behind + ' commit(s) behind. STOP. Reconcile before any other work:\n' +
      '           git merge --ff-only origin/main\n' +
      '         If that is refused, you have local changes; save them, then merge.\n' +
      '         A FETCH ALONE IS NOT ENOUGH. It updates the remote refs and leaves the\n' +
      '         working tree exactly as stale as it was. Reconcile, do not just look.\n' +
      '         A stale clone reports ABSENCE, not staleness, and absence is what you act on.');

  let dirty = '';
  try { dirty = sh('git status --porcelain'); } catch (e) { }
  const modified = dirty.split('\n').filter(l => l.trim() && !l.startsWith('??'));
  /* A dirty tree on a CURRENT clone is ordinary working state and passes. Dirty AND
     behind is the one combination that must STOP: a fast-forward is not available, and
     merging or resetting on Allen's behalf is exactly the destructive guess this check
     exists to prevent. Report it and wait for him.
     This used to be record(true, ...), which could never fail, so the case Allen most
     wanted stopped was the one case the preflight had no opinion about at all. */
  const blocked = modified.length > 0 && behind > 0;
  record(!blocked, 'working tree',
    (modified.length ? modified.length + ' modified' : 'clean') +
    ', ' + dirty.split('\n').filter(l => l.startsWith('??')).length + ' untracked' +
    (blocked ? ', and ' + behind + ' behind' : ''),
    blocked ? 'DIRTY TREE AND ' + behind + ' COMMIT(S) BEHIND. STOP and report to Allen.\n' +
      '         Do NOT merge, do NOT reset, and do NOT work on top of it.' : null);

  return { behind: behind, ahead: ahead, head: head };
}

/* THE OFFICIAL FEED. Read-only and needs no credential, so it isolates a network fault
   from a missing key. */
async function checkFeed() {
  const url = 'https://' + HOST + '/api/rankingType-2026-1';
  const r = await get(url);
  const ok = r.status === 200 && r.body && r.body.trim().length > 2;
  record(ok, 'official feed reachable',
    ok ? HOST + ' answered 200, ' + r.body.length + ' bytes'
       : HOST + ' answered ' + (r.error ? r.error : r.status),
    ok ? null :
      'The race feed is unreachable. A close cannot be computed without it.\n' +
      '         Check general connectivity first; this endpoint needs no credential.');
  return ok;
}

/* CDF_KEY AND POOL STATE. The one real blocker, and the only check that can tell you
   the pool's own opinion of where the season is. */
async function checkPoolState() {
  const key = process.env.CDF_KEY;
  if (!key) {
    record(false, 'CDF_KEY present', 'not set in this process',
      'Set it ONCE as a Windows USER environment variable so it survives reboots and\n' +
      '         every new shell, the same way ANTHROPIC_API_KEY and CLOUDFLARE_API_TOKEN\n' +
      '         already live on this machine. In PowerShell, as Allen:\n' +
      '           [System.Environment]::SetEnvironmentVariable("CDF_KEY","<the x-cdf-key>","User")\n' +
      '         Then open a NEW shell. A process started before the variable was set does\n' +
      '         not inherit it. To use it in the current shell without reopening:\n' +
      '           $env:CDF_KEY=[System.Environment]::GetEnvironmentVariable("CDF_KEY","User")');
    return null;
  }
  record(true, 'CDF_KEY present', 'set, ' + key.length + ' chars, value never logged');

  const url = API + '/api/pool-state?pool=' + encodeURIComponent(POOL) + '&stage=1';
  const r = await get(url, { 'x-cdf-key': key });
  if (r.status !== 200) {
    record(false, 'pool-state answers 200', 'HTTP ' + (r.error ? r.error : r.status) + ' for pool ' + POOL,
      r.status === 403
        ? 'The key is set but REJECTED. It is wrong, rotated, or for another pool.\n' +
          '         Get the current x-cdf-key from Allen and set it again as above.'
        : 'pool-state did not answer. Check the network, then the endpoint.');
    return null;
  }

  let ps;
  try { ps = JSON.parse(r.body); }
  catch (e) {
    record(false, 'pool-state answers 200', '200 but the body is not JSON',
      'The endpoint answered but did not send a pool. Do not parse this into an empty\n' +
      '         result; treat it as a fault and stop.');
    return null;
  }
  record(true, 'pool-state answers 200', 'pool ' + POOL + ', ' + r.body.length + ' bytes');

  const doc = ps.poolDoc || {};
  const order = Array.isArray(doc.order) ? doc.order : [];
  const scored = Array.isArray(ps.scoredStages) ? ps.scoredStages : [];
  record(order.length > 0, 'pool order and startStage',
    'startStage ' + doc.startStage + ', order ' + (order.length ? order.join(' > ') : 'MISSING') +
    ', scored ' + JSON.stringify(scored),
    order.length ? null :
      'pool.order is empty. The rotation cannot be computed from an empty order.');
  return { startStage: doc.startStage, order: order, scored: scored };
}

/* THE CLOSER. Deliberately does not assume a path: tools-close-stage.js at root is the
   convention every other tool here follows, and tools/close-stage.js is where an earlier
   session left an uncommitted copy. Report which one is actually here rather than
   naming one and letting the reader assume it exists. */
function checkCloser() {
  const candidates = ['tools-close-stage.js', path.join('tools', 'close-stage.js')];
  const found = candidates.filter(p => fs.existsSync(path.join(REPO, p)));
  if (!found.length) {
    record(false, 'stage closer present', 'neither ' + candidates.join(' nor '),
      'No closer on disk. The close is a hand paste from a signed-in browser console\n' +
      '         until one is committed. See the close-stage section in CLAUDE.md.');
    return null;
  }
  let tracked = false;
  try { tracked = sh('git ls-files ' + found[0]).length > 0; } catch (e) { }
  record(true, 'stage closer present',
    found[0] + (tracked ? ' (tracked)' : ' (UNTRACKED, local only, not at origin)'));
  if (!tracked) {
    console.log('         note: untracked means no other machine and no other session has it.');
  }
  return found[0];
}

/* -------------------------------------------------------------------- main -- */

(async () => {
  console.log('SESSION PREFLIGHT  ' + new Date().toISOString());
  console.log('repo ' + REPO + '\n');

  checkMachine();
  const git = checkGit();
  await checkFeed();
  const pool = await checkPoolState();
  const closer = checkCloser();

  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed.');

  if (failed.length) {
    console.log('\nSTOP. Do not start work. Fix these first:\n');
    failed.forEach(f => {
      console.log('  FAIL  ' + f.label + (f.detail ? '  (' + f.detail + ')' : ''));
      if (f.remedy) console.log(f.remedy.split('\n').map(l => '        ' + l.trim()).join('\n'));
      console.log('');
    });
    process.exit(1);
  }

  console.log('\nReady. Next step for a close:');
  console.log('  node ' + (closer || '<no closer on disk>') +
    ' ' + ((pool && pool.startStage) ? pool.startStage : '<stage>'));
  process.exit(0);
})().catch(e => {
  console.error('\nPREFLIGHT FAILED: ' + e.message);
  process.exit(1);
});
