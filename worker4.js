/* Col du Fantasy - race proxy + draft-completion watcher + on-the-clock push (Cloudflare Worker)
 *
 * v5 (2026-07-24): race feed now returns `finished` (bib,pos,name) from the live
 * stage classification (type "ite") so the break widget can move a pick that has
 * crossed the line to "Over the line" with its placing instead of dumping it in
 * "Off the back". Additive + guarded; the on-road path is unchanged.
 *
 * v4 (2026-07-19). Three jobs:
 * 1. Race feed proxy (original): browsers on coldufantasy.com cannot call the
 *    letour racecenter feed (CORS). ?stage=N fetches it server-side and returns
 *    clean JSON groups + jerseys. On-demand only.
 * 2. Draft-completion watcher (new): the boards' draft engine POSTs /done when
 *    a stage draft fills its final slot; state lands in KV (binding: STATE).
 *    A Claude scheduled task polls /state hourly and runs the post-draft step
 *    for any completion without an ack, then POSTs /ack. No Firestore access,
 *    no credentials anywhere - the ping carries the picks snapshot with it.
 *    Ground truth stays in Firestore; KV is only a mailbox. Public endpoints
 *    by design (private four-person game; worst-case vandalism = a spurious
 *    notification, which the Firestore read in the interactive step exposes).
 *
 * Routes:
 *   GET  /?stage=N                     race feed (unchanged from v2)
 *   POST /done?pool=ID&stage=N  body: {picks:[{n,player,rider}...]}
 *        stores done:{pool}:{stage} if absent (first write wins), 30d TTL
 *   GET  /state                        all done/ack records, newest first
 *   POST /ack?pool=ID&stage=N&by=X     stores ack:{pool}:{stage}
 *   POST /clear?pool=ID&stage=N        deletes both records (test cleanup)
 *
 * 3. On-the-clock web push (v4): seats opt in from the board (sw.js + VAPID).
 *    Any open board POSTs /clock when the draft's on-clock seat changes; the
 *    Worker dedups in KV and sends an EMPTY web push (no payload = no message
 *    encryption needed, only VAPID auth) to that seat's subscriptions; the
 *    service worker shows a generic "You're on the clock" notification.
 *   POST /push/sub?pool=ID&code=XX   body: {sub:<PushSubscription JSON>}
 *   POST /push/unsub?pool=ID&code=XX body: {endpoint}
 *   GET  /push/who?pool=ID           subscription counts per code
 *   POST /push/test?pool=ID&code=XX  fire a test push now
 *   POST /clock?pool=ID&stage=N&code=XX  dedup + push to the on-clock seat
 */

/* ---- VAPID (keys generated 2026-07-19; private key only lives here) ---- */
const VAPID_PUB = "BPwWSnnMDOdo5pRGDIjM5Favj-krr3z2dxmkn7FnrD7fiPGgzpKYXea0JpkXGK1ow3KY70JRek4KItwao6eBGKo";
const VAPID_PRIV_PKCS8 = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgONB5gNWfCh9y1hX6pD3sZhxHVG0YSWKe9rNAVbQpuGuhRANCAAT8Fkp5zAznaOaURgyIzORWr4_pK6989ncZpJ-xZ6w-34jxoM6SmF3mtCaZFxitaMNymO9CUXpOCiLcGqOngRiq";
const VAPID_SUB = "mailto:allen@ascentexeccoaching.com";

function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(bytes) {
  let bin = "";
  new Uint8Array(bytes).forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
let _vapidKey = null;
async function vapidJWT(aud) {
  if (!_vapidKey) {
    _vapidKey = await crypto.subtle.importKey("pkcs8", b64uToBytes(VAPID_PRIV_PKCS8),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  const enc = new TextEncoder();
  const head = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUB })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
    _vapidKey, enc.encode(head + "." + claims));
  return head + "." + claims + "." + bytesToB64u(sig);
}
async function sendPush(sub) {
  try {
    const ep = new URL(sub.endpoint);
    const jwt = await vapidJWT(ep.origin);
    const r = await fetch(sub.endpoint, { method: "POST", headers: {
      TTL: "3600", Urgency: "high",
      Authorization: "vapid t=" + jwt + ", k=" + VAPID_PUB } });
    return { ok: r.status === 201 || r.status === 200, status: r.status, gone: r.status === 404 || r.status === 410 };
  } catch (e) { return { ok: false, status: 0, gone: false, err: String(e && e.message || e) }; }
}
async function pushToSeat(env, pool, code) {
  const key = "subs:" + pool + ":" + code;
  const subs = JSON.parse((await env.STATE.get(key)) || "[]");
  if (!subs.length) return { sent: 0, of: 0 };
  const keep = [], results = [];
  for (const s of subs) {
    const r = await sendPush(s);
    results.push(r.status);
    if (!r.gone) keep.push(s);
  }
  if (keep.length !== subs.length) await env.STATE.put(key, JSON.stringify(keep));
  return { sent: results.filter(s => s === 201 || s === 200).length, of: subs.length, statuses: results };
}

async function handlePush(request, url, env) {
  if (!env.STATE) return json({ error: "KV binding STATE missing" }, 500);
  const pool = (url.searchParams.get("pool") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const code = (url.searchParams.get("code") || "").replace(/[^A-Z]/g, "").slice(0, 4);

  if (url.pathname === "/push/sub") {
    if (!pool || !code) return json({ error: "need ?pool=ID&code=XX" }, 400);
    let sub = null;
    try { const b = await request.json(); sub = b && b.sub; } catch (e) {}
    if (!sub || !sub.endpoint) return json({ error: "body needs {sub}" }, 400);
    const key = "subs:" + pool + ":" + code;
    const subs = JSON.parse((await env.STATE.get(key)) || "[]").filter(s => s.endpoint !== sub.endpoint);
    subs.push({ endpoint: sub.endpoint, keys: sub.keys || null, at: new Date().toISOString() });
    await env.STATE.put(key, JSON.stringify(subs.slice(-5)));
    return json({ subscribed: true, devices: subs.length });
  }

  if (url.pathname === "/push/unsub") {
    if (!pool || !code) return json({ error: "need ?pool=ID&code=XX" }, 400);
    let endpoint = null;
    try { const b = await request.json(); endpoint = b && b.endpoint; } catch (e) {}
    const key = "subs:" + pool + ":" + code;
    const subs = JSON.parse((await env.STATE.get(key)) || "[]").filter(s => s.endpoint !== endpoint);
    await env.STATE.put(key, JSON.stringify(subs));
    return json({ unsubscribed: true, devices: subs.length });
  }

  if (url.pathname === "/push/who") {
    if (!pool) return json({ error: "need ?pool=ID" }, 400);
    const list = await env.STATE.list({ prefix: "subs:" + pool + ":" });
    const out = {};
    for (const k of list.keys) {
      const c = k.name.split(":").pop();
      out[c] = JSON.parse((await env.STATE.get(k.name)) || "[]").length;
    }
    return json({ pool, devices: out });
  }

  if (url.pathname === "/push/test") {
    if (!pool || !code) return json({ error: "need ?pool=ID&code=XX" }, 400);
    const r = await pushToSeat(env, pool, code);
    return json({ test: true, pool, code, ...r });
  }

  if (url.pathname === "/clock") {
    const stage = (url.searchParams.get("stage") || "").replace(/[^0-9]/g, "").slice(0, 2);
    if (!pool || !code || !stage) return json({ error: "need ?pool=ID&stage=N&code=XX" }, 400);
    const key = "clock:" + pool;
    const val = stage + ":" + code;
    const prev = await env.STATE.get(key);
    if (prev === val) return json({ pushed: 0, dedup: true });
    await env.STATE.put(key, val, { expirationTtl: TTL });
    const r = await pushToSeat(env, pool, code);
    return json({ pushed: r.sent, of: r.of, clock: val });
  }

  return null;
}

const YEAR = 2026;
const BASE = "https://racecenter.letour.fr/api";
const ALLOW_ORIGIN = "*"; // public race data; set to "https://coldufantasy.com" to lock it
const TTL = 60 * 60 * 24 * 30; // 30 days

const CORS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function getJSON(path) {
  const r = await fetch(`${BASE}/${path}`, { cf: { cacheTtl: 15, cacheEverything: true } });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

function poolStage(url) {
  const pool = (url.searchParams.get("pool") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const stage = (url.searchParams.get("stage") || "").replace(/[^0-9]/g, "").slice(0, 2);
  return pool && stage ? { pool, stage } : null;
}

// ---- Live active roster + daily abandon diff (v5) ----
// GET /roster?stage=N : N is the upcoming/current stage. Finds the latest raced
// stage <= N that has a general classification (itg = everyone still in the race),
// returns that active bib set, and diffs it against the most recent earlier stage
// stored in KV to report who has dropped out (abandon / DNF / DNS / OTL). The board
// filters its pick list to activeBibs (so abandoned riders cannot be drafted) and
// renders `out` in an "Out of the race" strip. KV keys: roster:active:{stage}.
async function handleRoster(request, url, env) {
  if (url.pathname !== "/roster") return null;
  if (!env.STATE) return json({ error: "KV binding STATE missing" }, 500);
  const hint = (url.searchParams.get("stage") || "").replace(/[^0-9]/g, "").slice(0, 2);
  if (!hint) return json({ error: "need ?stage=N (the upcoming or current stage)" }, 400);

  // latest raced stage <= hint with a general classification
  let useStage = null, gc = null;
  for (let s = Number(hint); s >= Number(hint) - 3 && s > 0; s--) {
    const rt = await getJSON(`rankingType-${YEAR}-${s}`).catch(() => null);
    const g = Array.isArray(rt)
      ? rt.filter((d) => d && d.type === "itg").sort((a, b) => (b.rankings || []).length - (a.rankings || []).length)[0]
      : null;
    if (g && (g.rankings || []).length) { useStage = s; gc = g; break; }
  }
  if (!gc) return json({ error: "no classification found near stage " + hint }, 404);

  const activeBibs = (gc.rankings || []).map((r) => r.bib).filter((x) => x != null);
  const activeSet = new Set(activeBibs);

  // names by bib for the drop list
  const comp = await getJSON(`allCompetitors-${YEAR}`).catch(() => null);
  const byBib = {};
  (Array.isArray(comp) ? comp : []).forEach((c) => {
    if (c.bib != null) byBib[c.bib] = (c.firstname ? c.firstname[0] + ". " : "") + (c.lastname || "");
  });

  const setKey = (s) => "roster:active:" + s;
  await env.STATE.put(setKey(useStage), JSON.stringify(activeBibs), { expirationTtl: TTL });
  let prevActive = null, prevStage = null;
  for (let s = useStage - 1; s >= useStage - 6 && s > 0; s--) {
    const v = await env.STATE.get(setKey(s));
    if (v) { prevActive = new Set(JSON.parse(v)); prevStage = s; break; }
  }
  const out = [];
  if (prevActive) for (const b of prevActive) if (!activeSet.has(b)) out.push({ bib: b, name: byBib[b] || ("#" + b) });

  return json({ stage: useStage, count: activeBibs.length, activeBibs, out, prevStage });
}

async function handleWatch(request, url, env) {
  if (!env.STATE) return json({ error: "KV binding STATE missing" }, 500);

  if (url.pathname === "/done") {
    const ps = poolStage(url);
    if (!ps) return json({ error: "need ?pool=ID&stage=N" }, 400);
    const key = `done:${ps.pool}:${ps.stage}`;
    const existing = await env.STATE.get(key);
    if (existing) return json({ stored: false, already: JSON.parse(existing) });
    let picks = null;
    try { const b = await request.json(); if (b && Array.isArray(b.picks)) picks = b.picks.slice(0, 40).map(p => ({ n: p.n, player: String(p.player || "").slice(0, 8), rider: String(p.rider || "").slice(0, 60) })); } catch (e) {}
    const rec = { pool: ps.pool, stage: ps.stage, at: new Date().toISOString(), picks };
    await env.STATE.put(key, JSON.stringify(rec), { expirationTtl: TTL });
    return json({ stored: true, rec });
  }

  if (url.pathname === "/ack") {
    const ps = poolStage(url);
    if (!ps) return json({ error: "need ?pool=ID&stage=N" }, 400);
    const by = (url.searchParams.get("by") || "claude").slice(0, 30);
    const rec = { pool: ps.pool, stage: ps.stage, by, at: new Date().toISOString() };
    await env.STATE.put(`ack:${ps.pool}:${ps.stage}`, JSON.stringify(rec), { expirationTtl: TTL });
    return json({ acked: true, rec });
  }

  if (url.pathname === "/clear") {
    const ps = poolStage(url);
    if (!ps) return json({ error: "need ?pool=ID&stage=N" }, 400);
    await env.STATE.delete(`done:${ps.pool}:${ps.stage}`);
    await env.STATE.delete(`ack:${ps.pool}:${ps.stage}`);
    return json({ cleared: true });
  }

  if (url.pathname === "/state") {
    const out = [];
    const list = await env.STATE.list({ prefix: "done:" });
    for (const k of list.keys) {
      const done = JSON.parse((await env.STATE.get(k.name)) || "null");
      if (!done) continue;
      const ack = JSON.parse((await env.STATE.get(`ack:${done.pool}:${done.stage}`)) || "null");
      out.push({ ...done, acked: !!ack, ack });
    }
    out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    return json({ records: out, count: out.length });
  }

  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      const url = new URL(request.url);
      const watched = await handleWatch(request, url, env);
      if (watched) return watched;
      const pushed = await handlePush(request, url, env);
      if (pushed) return pushed;
      const roster = await handleRoster(request, url, env);
      if (roster) return roster;

      const stage = (url.searchParams.get("stage") || "").replace(/[^0-9]/g, "");
      if (!stage) return json({ error: "missing ?stage=N" }, 400);

      const [pack, comp, jerseysRaw, rankRaw] = await Promise.all([
        getJSON(`pack-${YEAR}-${stage}`),
        getJSON(`allCompetitors-${YEAR}`),
        getJSON(`rankingTypeJerseys-${YEAR}-${stage}`).catch(() => null),
        getJSON(`rankingType-${YEAR}-${stage}`).catch(() => null),
      ]);

      const byBib = {};
      (Array.isArray(comp) ? comp : []).forEach((c) => {
        if (c.bib != null) {
          byBib[c.bib] = (c.firstname ? c.firstname[0] + ". " : "") + (c.lastname || "");
        }
      });

      // Riders who have crossed the line on THIS stage, from the live stage
      // classification (type "ite" = individuel etape). `position` is the placing.
      // Wrapped so a feed change can never break the on-road path - finished just
      // falls back to []. This is what lets the widget move a finisher off the road.
      let finished = [];
      try {
        const ite = Array.isArray(rankRaw) ? rankRaw.find((d) => d && d.type === "ite") : null;
        if (ite && Array.isArray(ite.rankings)) {
          finished = ite.rankings
            .filter((r) => r && r.bib != null && r.position != null)
            .map((r) => ({ bib: r.bib, pos: r.position, name: byBib[r.bib] || "#" + r.bib }))
            .sort((a, b) => a.pos - b.pos);
        }
      } catch (e) { finished = []; }

      const snaps = (Array.isArray(pack) ? pack : []).filter((x) => x.groups && x.groups.length);
      if (!snaps.length) return json({ live: false, stage, groups: [], finished });
      const cur = snaps.sort((a, b) => (b._updatedAt || 0) - (a._updatedAt || 0))[0];

      const groups = cur.groups
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((g) => {
          const bibs = (g.bibs || []).map((b) => b.bib).filter((x) => x != null);
          const riders = (g.bibs || []).map((b) => byBib[b.bib] || "#" + b.bib);
          return {
            name: g.name || "",
            order: g.order || 0,
            gap: g.computedRelative != null ? g.computedRelative : g.relative != null ? g.relative : 0,
            kmToGo: Math.round((g.computedRemainingDistance != null ? g.computedRemainingDistance : g.remainingDistance || 0) / 100) / 10,
            count: riders.length,
            riders,
            bibs,
          };
        });

      const jerseys = {};
      if (Array.isArray(jerseysRaw)) {
        const CODE = { pmt: "yellow", pmp: "green", pmm: "polka", pmj: "white" };
        jerseysRaw.forEach((e) => {
          const key = CODE[e && e.type];
          const bib = e && e.rankings && e.rankings[0] && e.rankings[0].bib;
          if (key && bib != null) jerseys[key] = { bib, name: byBib[bib] || "#" + bib };
        });
      }

      return json({ live: true, stage, updatedAt: cur._updatedAt || null, groups, jerseys, finished });
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};
