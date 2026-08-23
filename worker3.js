/* Col du Fantasy - race proxy + draft-completion watcher (Cloudflare Worker)
 *
 * v3 (2026-07-18). Two jobs:
 * 1. Race feed proxy (original): browsers on coldufantasy.com cannot call the
 *    race center feed (CORS). ?stage=N fetches it server-side and returns
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
 */

/* Race registry, the same shape the primary proxy uses (api/break.js in the
   coldufantasy-login repo). A hardcoded host is what pointed the Vuelta board at the
   Tour and rendered another race's groups as fact, so the race is resolved per
   request and never baked in.

   Resolution order: an explicit ?race= from the caller wins, because the boards now
   name their race on every request and a board must never depend on how this worker
   is configured. Otherwise the RACE var from wrangler, otherwise vuelta.
   RACE_HOST and RACE_YEAR override the default race's host and edition, so a moved
   race center or a new year needs no code change.

   Workers only expose env inside the fetch handler, so this resolves per request and
   the resolved object is threaded through rather than held in a module global, which
   two concurrent requests for different races would corrupt. */
const RACES = {
  tour:   { host: "racecenter.letour.fr",   year: 2026 },
  vuelta: { host: "racecenter.lavuelta.es", year: 2026 },
};

function resolveRace(url, env) {
  const asked = String(url.searchParams.get("race") || "").toLowerCase();
  if (RACES[asked]) return { id: asked, base: `https://${RACES[asked].host}/api`, year: RACES[asked].year };
  const e = env || {};
  const dk = RACES[String(e.RACE || "").toLowerCase()] ? String(e.RACE).toLowerCase() : "vuelta";
  const host = String(e.RACE_HOST || "").trim() || RACES[dk].host;
  const year = parseInt(e.RACE_YEAR || "", 10);
  return { id: dk, base: `https://${host}/api`, year: Number.isInteger(year) && year > 2000 ? year : RACES[dk].year };
}
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

async function getJSON(path, race) {
  const r = await fetch(`${race.base}/${path}`, { cf: { cacheTtl: 15, cacheEverything: true } });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

function poolStage(url) {
  const pool = (url.searchParams.get("pool") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const stage = (url.searchParams.get("stage") || "").replace(/[^0-9]/g, "").slice(0, 2);
  return pool && stage ? { pool, stage } : null;
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

      const race = resolveRace(url, env);
      const stage = (url.searchParams.get("stage") || "").replace(/[^0-9]/g, "");
      if (!stage) return json({ error: "missing ?stage=N" }, 400);

      const [pack, comp, jerseysRaw] = await Promise.all([
        getJSON(`pack-${race.year}-${stage}`, race),
        getJSON(`allCompetitors-${race.year}`, race),
        getJSON(`rankingTypeJerseys-${race.year}-${stage}`, race).catch(() => null),
      ]);

      const byBib = {};
      (Array.isArray(comp) ? comp : []).forEach((c) => {
        if (c.bib != null) {
          byBib[c.bib] = (c.firstname ? c.firstname[0] + ". " : "") + (c.lastname || "");
        }
      });

      const snaps = (Array.isArray(pack) ? pack : []).filter((x) => x.groups && x.groups.length);
      if (!snaps.length) return json({ live: false, race: race.id, stage, groups: [] });
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
            // remainingDistance is the field the official race center displays and the
            // one that reconciles with the published stage length. See the note in the
            // primary proxy (api/break.js in coldufantasy-login) for the measurements.
            kmToGo: Math.round((g.remainingDistance != null ? g.remainingDistance : g.computedRemainingDistance || 0) / 100) / 10,
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

      return json({ live: true, race: race.id, stage, updatedAt: cur._updatedAt || null, groups, jerseys });
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};
