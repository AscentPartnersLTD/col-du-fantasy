#!/usr/bin/env node
/* tools-rules-tests/run.js - start the Firestore emulator, run the rules tests, stop it.
 *
 *   node tools-rules-tests/run.js
 *
 * WHY THIS WRAPPER EXISTS. The alternative was `firebase deploy` as the compile step,
 * with four players as the canary. The emulator loads the SAME firestore.rules the
 * deploy publishes, so a syntax error or a widened grant surfaces here.
 *
 * It SKIPS LOUDLY rather than passing when it cannot run. A test harness that quietly
 * reports success when it never started is the fail-open shape this repo keeps
 * cataloguing, one level up from the rules it is checking.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');

function die(why, remedy) {
  console.error('\nRULES TESTS DID NOT RUN: ' + why);
  if (remedy) console.error(remedy);
  process.exit(2);
}

/* ---- prerequisites, each named separately ---- */
if (!fs.existsSync(path.join(REPO, 'firestore.rules')))
  die('firestore.rules is not in the repo root.');

if (!fs.existsSync(path.join(HERE, 'node_modules', '@firebase', 'rules-unit-testing')))
  die('the test dependencies are not installed.',
      '  cd tools-rules-tests && npm install');

/* The emulator is a Java process. Without a JDK the firebase CLI prints a download
   prompt and hangs, which looks like a slow test rather than a missing prerequisite. */
let javaOk = false, javaWhere = '';
const probe = (cand) => {
  if (!cand) return false;
  const r = spawnSync(cand, ['-version'], { encoding: 'utf8' });
  return r.status === 0 || /version/i.test(String(r.stderr || ''));
};
for (const cand of ['java', process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'java')]) {
  if (probe(cand)) { javaOk = true; javaWhere = cand; break; }
}
if (!javaOk) {
  /* Windows installs the JDK outside the shell's PATH until a new shell starts. Look
     where winget put it before declaring it missing. */
  try {
    const root = 'C:\\Program Files\\Eclipse Adoptium';
    for (const d of fs.readdirSync(root)) {
      const j = path.join(root, d, 'bin', 'java.exe');
      if (fs.existsSync(j)) {
        process.env.PATH = path.dirname(j) + path.delimiter + process.env.PATH;
        javaOk = true; javaWhere = j;
        break;
      }
    }
  } catch (e) { /* not Windows, or not installed */ }
}
if (!javaOk)
  die('no Java runtime, so the Firestore emulator cannot start.',
      '  winget install EclipseAdoptium.Temurin.21.JDK\n' +
      '  then open a NEW shell, or re-run this: it looks in Program Files too.');

console.log('java      ' + javaWhere);

/* The CLI is invoked through its JS ENTRY POINT, not the .bin shim. Node cannot spawn
   a .cmd without shell:true, and with shell:true on Windows cmd.exe re-splits the
   trailing command, so the wrapper returned 1 on a run whose own output said every
   assertion passed. A wrapper that reports failure on success is worse than none: it
   trains you to ignore it. */
const cli = path.join(HERE, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
if (!fs.existsSync(cli))
  die('firebase-tools is not installed in tools-rules-tests.',
      '  cd tools-rules-tests && npm install');

console.log('emulator  starting on 127.0.0.1:8080 ...\n');

/* ONE emulator run for BOTH suites. Starting it twice doubles the slowest part of
   the loop and leaves a window where the second start finds port 8080 still held by
   the first, which reads as a test failure and is not one. */
const suites = [
  'tools-rules-tests/rules.test.js',
  'tools-rules-tests/showroom-copy.test.js',
].join(' && node ');

const r = spawnSync(process.execPath, [
  cli,
  'emulators:exec',
  '--only', 'firestore',
  '--project', 'col-du-fantasy',
  'node ' + suites,
], { cwd: REPO, stdio: 'inherit', env: process.env });

if (r.error) die('could not start the emulator: ' + r.error.message);
process.exit(r.status === null ? 1 : r.status);
