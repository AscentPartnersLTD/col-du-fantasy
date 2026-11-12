#!/usr/bin/env node
/* tools/showroom-copy.js - copy a production pool to its read-only SHOWROOM.
 *
 *   node tools/showroom-copy.js                     DRY RUN, both pools
 *   node tools/showroom-copy.js --only vuelta       DRY RUN, one pair
 *   node tools/showroom-copy.js --apply             write it
 *
 * DRY RUN IS THE DEFAULT and prints every intended write. The destructive direction is
 * never what you get by forgetting a flag, which is the same call `dryRun` makes in
 * /api/close-stage.
 *
 * IT HARD-REFUSES col-du-fantasy AND vuelta-2026 AS TARGETS. Not by convention and not
 * by a comment: by a check that runs before anything else and exits non-zero. The whole
 * point of the showroom is that production is never touched, and a copy tool pointed the
 * wrong way is the one thing in this design that could overwrite four players' season.
 *
 * NO REAL ADDRESS REACHES THE COPY, and that is ENFORCED rather than listed. Scrubbing a
 * known set of fields would be a curated list, which is the hazard this repo keeps
 * recording: `members`, `memberEmails` and a draft pick's `by` all carry one today, and
 * the next field nobody thought of carries one tomorrow. So every value is walked
 * recursively, anything email-shaped is replaced, and the result is RE-SCANNED. A
 * surviving address refuses the write.
 *
 * ---------------------------------------------------------------------------------
 * CREDENTIALS. This talks to the Firestore REST API and takes its token from the
 * environment. It deliberately does NOT read the firebase CLI's stored login.
 *
 *   PowerShell, against production:
 *     $env:CDF_ADMIN_TOKEN = (gcloud auth print-access-token)
 *     node tools/showroom-copy.js
 *
 *   Against the emulator, which needs no token and is how this tool was tested:
 *     $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
 *     node tools/showroom-copy.js --apply
 */
'use strict';

const PROJECT = 'col-du-fantasy';

/* source -> target. The KEY is production and is only ever READ. */
const PAIRS = {
  'col-du-fantasy': 'tour-showroom',
  'vuelta-2026': 'vuelta-showroom',
};

/* A target that is a production pool is refused before any work happens. */
const NEVER_A_TARGET = ['col-du-fantasy', 'vuelta-2026'];

/* Subcollections that are COPIED. engagement is deliberately absent: its document IDS
   are email addresses, so it cannot be copied without carrying one, and nothing a
   viewer sees reads it. */
const COPY_COLLECTIONS = ['stages', 'drafts', 'predictions'];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/* ------------------------------------------------------------------ transport -- */
const EMU = process.env.FIRESTORE_EMULATOR_HOST || '';
const BASE = EMU
  ? 'http://' + EMU + '/v1/projects/' + PROJECT + '/databases/(default)/documents'
  : 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const TOKEN = process.env.CDF_ADMIN_TOKEN || '';

function headers() {
  const h = { 'content-type': 'application/json' };
  /* The emulator enforces the same rules over REST as production does, and an
     unauthenticated request is refused by them. `Bearer owner` is the emulator's
     documented admin principal; it exists nowhere else and is never sent to
     firestore.googleapis.com. */
  if (EMU) h.authorization = 'Bearer owner';
  else if (TOKEN) h.authorization = 'Bearer ' + TOKEN;
  return h;
}

async function api(pathOrUrl, init) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : BASE + pathOrUrl;
  const r = await fetch(url, Object.assign({ headers: headers() }, init || {}));
  const text = await r.text();
  if (!r.ok) {
    /* Remote data fails LOUDLY. An empty or error body is never parsed into an
       empty result, which is how a partial copy would look like a complete one. */
    throw new Error('HTTP ' + r.status + ' from ' + url.replace(BASE, '') + ': ' +
      text.slice(0, 200));
  }
  return text ? JSON.parse(text) : {};
}

/* ------------------------------------------------- Firestore typed-value codec -- */
function decode(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return { __ts: v.timestampValue };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = decode(vv);
    return o;
  }
  if ('referenceValue' in v) return { __ref: v.referenceValue };
  return null;
}
function encode(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x)
    ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(encode) } };
  if (typeof x === 'object') {
    if (x.__ts) return { timestampValue: x.__ts };
    if (x.__ref) return { referenceValue: x.__ref };
    const fields = {};
    for (const [k, v] of Object.entries(x)) fields[k] = encode(v);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}
const decodeDoc = (d) => {
  const o = {};
  for (const [k, v] of Object.entries((d && d.fields) || {})) o[k] = decode(v);
  return o;
};
const encodeDoc = (o) => {
  const fields = {};
  for (const [k, v] of Object.entries(o)) fields[k] = encode(v);
  return { fields };
};

/* ------------------------------------------------------------------ scrubbing -- */
/* Seat codes are what the showroom shows instead of a person. A map KEYED by email,
   which is what `members` is, keeps its value and loses its key. */
function placeholderFor(seatOrIndex) {
  return String(seatOrIndex).toLowerCase().replace(/[^a-z0-9]/g, '') + '@showroom.invalid';
}

function scrub(value, report, path) {
  path = path || '';
  if (typeof value === 'string') {
    if (EMAIL_RE.test(value)) {
      EMAIL_RE.lastIndex = 0;
      report.push(path || '(root)');
      return value.replace(EMAIL_RE, 'someone@showroom.invalid');
    }
    EMAIL_RE.lastIndex = 0;
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => scrub(v, report, path + '[' + i + ']'));
  if (value && typeof value === 'object') {
    if (value.__ts || value.__ref) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      let key = k;
      EMAIL_RE.lastIndex = 0;
      if (EMAIL_RE.test(k)) {
        /* A map keyed by email: `members` is email -> seat, so the SEAT becomes the
           placeholder and the mapping survives with nobody's address in it. */
        EMAIL_RE.lastIndex = 0;
        key = placeholderFor(typeof v === 'string' ? v : Object.keys(out).length);
        report.push((path ? path + '.' : '') + '<key>');
      }
      out[key] = scrub(v, report, (path ? path + '.' : '') + key);
    }
    return out;
  }
  return value;
}

/* The scrub is not trusted: the result is re-read and any surviving address refuses
   the write. A scrubber that misses a field and says nothing is the failure this
   exists to prevent. */
function findEmails(value, hits, path) {
  path = path || '';
  if (typeof value === 'string') {
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(value) && !/@showroom\.invalid$/i.test(value.trim())) {
      hits.push(path + ' = ' + value);
    }
    EMAIL_RE.lastIndex = 0;
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => findEmails(v, hits, path + '[' + i + ']')); return; }
  if (value && typeof value === 'object') {
    if (value.__ts || value.__ref) return;
    for (const [k, v] of Object.entries(value)) {
      EMAIL_RE.lastIndex = 0;
      if (EMAIL_RE.test(k) && !/@showroom\.invalid$/i.test(k)) hits.push(path + '.<key> = ' + k);
      EMAIL_RE.lastIndex = 0;
      findEmails(v, hits, (path ? path + '.' : '') + k);
    }
  }
}

/* --------------------------------------------------------------------- the run -- */
function log(s) { console.log(s); }

async function listDocs(poolId, coll) {
  const out = [];
  let token = '';
  do {
    const page = await api('/pools/' + poolId + '/' + coll + '?pageSize=300' +
      (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    for (const d of page.documents || []) {
      out.push({ id: d.name.split('/').pop(), data: decodeDoc(d) });
    }
    token = page.nextPageToken || '';
  } while (token);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const only = args.includes('--only') ? String(args[args.indexOf('--only') + 1] || '') : '';

  log('SHOWROOM COPY  ' + (apply ? 'APPLY' : 'DRY RUN') +
      (EMU ? '   emulator ' + EMU : '   production'));
  log('');

  /* ---- the refusal that matters, before any work ---- */
  for (const [src, dst] of Object.entries(PAIRS)) {
    if (NEVER_A_TARGET.includes(dst)) {
      console.error('REFUSED: ' + dst + ' is a production pool and can never be a target.');
      process.exit(2);
    }
    if (src === dst) {
      console.error('REFUSED: ' + src + ' would copy onto itself.');
      process.exit(2);
    }
  }
  if (!EMU && apply && !TOKEN) {
    console.error('REFUSED: --apply against production needs CDF_ADMIN_TOKEN.');
    console.error('  $env:CDF_ADMIN_TOKEN = (gcloud auth print-access-token)');
    process.exit(2);
  }

  let planned = 0, refusals = 0;

  for (const [src, dst] of Object.entries(PAIRS)) {
    if (only && !src.includes(only) && !dst.includes(only)) continue;
    log('  ' + src + '  ->  ' + dst);

    /* ---- the pool document ---- */
    const poolRaw = decodeDoc(await api('/pools/' + src));
    const scrubReport = [];
    const pool = scrub(poolRaw, scrubReport, '');

    /* the copy declares itself, so the rule can require both the name and the flag */
    pool.showroom = true;
    pool.name = (poolRaw.name || src) + ' (showroom)';
    pool.copiedFrom = src;
    pool.copiedAt = { __ts: new Date().toISOString() };
    /* viewers is NOT populated here. Inviting somebody is a separate, deliberate act,
       and a copy tool that also hands out access is two decisions in one command. */
    if (!pool.viewers) pool.viewers = {};
    delete pool.memberEmails;   /* a second copy of the same addresses */

    const hits = [];
    findEmails(pool, hits, 'pool');
    if (hits.length) {
      console.error('    REFUSED: an address survived the scrub:');
      hits.slice(0, 5).forEach(h => console.error('      ' + h));
      refusals++;
      continue;
    }

    log('    pool document     ' + Object.keys(pool).length + ' fields' +
        (scrubReport.length ? ', ' + scrubReport.length + ' scrubbed' : ''));
    if (scrubReport.length) {
      log('      scrubbed: ' + [...new Set(scrubReport)].slice(0, 8).join(', '));
    }
    planned++;
    if (apply) {
      await api('/pools/' + dst, { method: 'PATCH', body: JSON.stringify(encodeDoc(pool)) });
    }

    /* ---- the subcollections ---- */
    for (const coll of COPY_COLLECTIONS) {
      let docs = [];
      try { docs = await listDocs(src, coll); }
      catch (e) { log('    ' + coll.padEnd(17) + ' unreadable: ' + e.message.slice(0, 60)); continue; }

      let scrubbedHere = 0, blocked = 0;
      for (const d of docs) {
        const rep = [];
        const clean = scrub(d.data, rep, '');
        scrubbedHere += rep.length;
        const h = [];
        findEmails(clean, h, coll + '/' + d.id);
        if (h.length) {
          console.error('    REFUSED ' + coll + '/' + d.id + ': ' + h[0]);
          blocked++;
          continue;
        }
        if (apply) {
          await api('/pools/' + dst + '/' + coll + '/' + d.id,
            { method: 'PATCH', body: JSON.stringify(encodeDoc(clean)) });
        }
      }
      refusals += blocked;
      planned += docs.length - blocked;
      log('    ' + coll.padEnd(17) + String(docs.length).padStart(3) + ' document(s)' +
          (scrubbedHere ? ', ' + scrubbedHere + ' value(s) scrubbed' : '') +
          (blocked ? ', ' + blocked + ' REFUSED' : ''));
    }
    log('    engagement        skipped: its document ids are addresses');
    log('');
  }

  log((apply ? 'WROTE ' : 'WOULD WRITE ') + planned + ' document(s)' +
      (refusals ? ', REFUSED ' + refusals : ''));
  if (!apply) log('Nothing was written. Re-run with --apply.');
  if (refusals) process.exit(1);
}

main().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
