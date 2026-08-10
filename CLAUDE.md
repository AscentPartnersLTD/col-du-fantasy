# Col du Fantasy - context for Claude Code

Read this first. It is the cold-start brief for this repo. If it disagrees with a
chat conversation, this file wins, because chat history disappears and the repo
does not. Keep this file updated in the same commit as any change it describes.

Operator: Allen Abbott. Owner account: allen@ascentpartnersltd.com.

`Vuelta-Fantasy-Build-Plan.md` is referenced in instructions but lives in Allen's
Claude project knowledge, not in this repo. Do not go looking for it here. Ask
Allen to paste the relevant section if a task depends on it.

## What this is

A private, operator-run daily-pick fantasy cycling pool. Four players per pool,
each picks two riders per stage. The winning direction depends on the race, see
Per-race scoring profiles below. Two live races share one codebase:

- Tour de France 2026 pool `col-du-fantasy`, board `/tour.html` (gold skin)
- Vuelta a Espana 2026 pool `vuelta-2026`, board `/vuelta.html` (red skin)

Live at https://coldufantasy.com from this repo via GitHub Pages, branch `main`,
CNAME in the repo root. `AscentPartnersLTD/ascent-design-drops` is the older
hosting repo and is no longer the one to commit to.

## Files that matter

Sources, edited by hand:

- `board.src.html` - the Tour-family board source. Contains the literal
  placeholders `{{DEFAULT_POOL}}` and `{{BUILD_STAMP}}`.
- `vuelta.src.html` - the Vuelta board source. Separate file, red skin, its own
  side games and calendar. Also contains `{{DEFAULT_POOL}}` and `{{BUILD_STAMP}}`.
- `build_boards.py` - substitutes the placeholders and writes the built files.

Built, never hand-edited:

- `tour.html` and `index.html` - byte-identical, `DEFAULT_POOL='col-du-fantasy'`
- `board.html` - generic board, `DEFAULT_POOL=''`, resolves `?pool=`
- `tour-staging.html` - same bytes as tour.html, separate URL for testing
- `vuelta.html` - `DEFAULT_POOL='vuelta-2026'`

Supporting: `operator.html` (owner console), `pools.html` (member router),
`admin.html`, `sw.js`, per-pool web manifests, stage profile art `1.jpg` to
`21.jpg` (Vuelta), team kit PNGs, jersey art, Cloudflare worker files
`worker3.js`, `worker4.js`, `wrangler.toml`.

## Build

```
python3 build_boards.py            # tour.html, index.html, board.html, tour-staging.html
python3 -c "import datetime;s=open('vuelta.src.html',encoding='utf-8').read();assert '{{DEFAULT_POOL}}' in s and '{{BUILD_STAMP}}' in s;st='<!-- build:'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%SZ')+' -->';open('vuelta.html','w',encoding='utf-8').write(s.replace('{{DEFAULT_POOL}}','vuelta-2026').replace('{{BUILD_STAMP}}',st))"
```

Two placeholders get substituted at build time:

- `{{DEFAULT_POOL}}` - the pool id, one value per built file, listed above.
- `{{BUILD_STAMP}}` - becomes `<!-- build:YYYYMMDD-HHMMSSZ -->` in UTC. It is
  computed once per run, so every file from one `build_boards.py` invocation
  shares a stamp and tour.html and index.html stay byte-identical. The Vuelta
  one-liner stamps itself, so it carries its own time unless run in the same
  second. Do not hand-write a stamp into a source file; that is exactly the
  frozen `20260715-143742 stage11` literal this replaced, which made every build
  claim to be from July 15.

The stamp is the fastest way to tell whether the CDN is serving a fresh copy:
read line 3 of the served file and compare it to the build you just pushed.

`build_boards.py` covers only the Tour family. The Vuelta build is the one-liner
above. Add `--staging-only` to build just the staging copy. Use `--staging-only`
whenever the live files are already built and committed, because a bare
`build_boards.py` rewrites tour.html, index.html, and board.html from source and
strips the redeploy comment off each one.

On Dragon, `python3` and `python` resolve to the Microsoft Store app execution
alias and fail from Git Bash with "Python was not found". Use `py -3`, which is
the real interpreter (Python 3.12.10). Substitute `py -3` for `python3` in both
commands above. The `python3` spelling is correct in the cloud sandbox.

After building, append a fresh redeploy comment to each changed HTML file so the
CDN drops the old copy.

## Validate before every push

Run all of these on every built file. Any failure blocks the push.

1. Zero U+2013 en dashes and zero U+2014 em dashes. Hyphens only, no HTML
   entities. This is non-negotiable and applies to every file in the project.
2. Count of `<script` equals count of `</script>`.
3. `DEFAULT_POOL` is correct per file: `col-du-fantasy` in tour.html and
   index.html, empty string in board.html, `vuelta-2026` in vuelta.html.
4. Extract every inline `<script>` block without a `src` attribute to numbered
   `.js` files and run `node --check` on each.
5. Diff against HEAD before committing. If a built file shrank unexpectedly,
   something upstream was stale. Stop and investigate.

## Deploy

On Dragon with Allen's git credentials, commit and push normally. The GitHub
token is Allen's alone and is never read, echoed, or handled by Claude.

In the cloud sandbox, `git push` is blocked by the egress proxy with a 403. The
proven fallback is the GitHub web upload path in Allen's signed-in Chrome:
open `github.com/AscentPartnersLTD/col-du-fantasy/upload/main`, attach the changed
files, set the commit summary, click the green Commit changes button. Two gotchas
recorded from past runs: any JavaScript that returns `location.href` gets blocked,
and if the browser drops Allen's GitHub sign-in the upload page reports that
uploads require push access.

To clear a stop-hook complaint about unpushed commits in the sandbox:
`git fetch origin main` then `git reset --hard origin/main`. The built files live
in the outputs directory, so resetting the clone is safe.

## Verify live

GitHub Pages takes one to two minutes to rebuild, and the CDN then serves the old
file for a while. Do not trust the first check.

Container `curl` against coldufantasy.com returns 000, it is blocked. Verify from
a signed-in browser tab instead:

```
fetch('/vuelta.html?cb='+Math.random()).then(r=>r.text()).then(t=>console.log(t.length, t.includes('SOMETHING_YOU_JUST_ADDED')))
```

Reading committed file content is fine from the container:
`curl https://raw.githubusercontent.com/AscentPartnersLTD/col-du-fantasy/main/<file>`

## Data

Firestore, compat SDK. Nothing is hardcoded from a template; the board reads pool
data at runtime.

- `pools/{poolId}` - name, members map (email to seat code), order, names, judge,
  startStage, boardConfig (race calendar, weather), carriedJerseys
- `pools/{poolId}/drafts/{stage}` - picks, queue, status, lockAt timestamps
- `userPools/{email}` - the list of pool ids that email belongs to
- `users/{email}` - global profile

Write path when signed in as owner on a board tab: `firebase` and `db` are
reachable globals. Use dot paths so sibling fields are not clobbered:

```
await db.doc('pools/vuelta-2026').update({'boardConfig.weather': {...}})
```

Top-level await works in the browser console. `CDF` is not on `window`. Read the
value straight back to confirm the write landed.

## Pool routing and PWA manifests

A pool with its own skinned board file must open that file. The account menu's
pool switcher and the sign-in roster reroute both route through `poolHref()`,
which prefers a `boardPath` field on the pool doc and falls back to the
`POOL_PAGE` map. `onPoolPage()` lets the already-checked entry still navigate when
the pool is right but the shell is wrong.

When adding a race, create three things together or the switcher breaks: the new
board file, its entry in `POOL_PAGE`, and a `<poolId>.webmanifest` whose
`start_url` is that board. `loadPool()` swaps the manifest link href to
`<poolId>.webmanifest` at runtime for any non-primary pool.

iOS pins the URL at Add to Home Screen time and will not re-read the manifest for
an existing install. To get a correct home screen icon: delete the old icon, open
the board URL in Safari directly rather than inside an installed app, confirm the
right skin, then Share and Add to Home Screen.

## Per-race launch checklist

Every one of these ships in the same commit as a new race board, or the board is
half-wired in a way that is not obvious until someone hits it:

1. Board file, `<race>.html`, built from its own `<race>.src.html`.
2. `POOL_PAGE` entry mapping the pool id to that board file.
3. `<poolId>.webmanifest` whose `start_url` is that board.
4. Icon set: 32, 180, 192, 512, and a 512 maskable.
5. og-card: a race-specific image with an ABSOLUTE `og:image`, plus
   `og:image:width`, `og:image:height`, `og:image:alt`, `og:site_name`, and
   `twitter:image`. A relative og:image does not resolve for scrapers.
6. Scoring profile decided and written into the table above before launch.

## ASO rider images

The photo URLs are signed over the whole transform path. The trailing hex is a
signature, not an id. They cannot be resized, recropped, or synthesized: editing
any part of the path returns HTTP 401. Harvest them exactly as ASO emits them, or
do not use them.

`img-cycling-tdf-png` is Tour-specific. `img.aso.fr` is a CNAME for
`sni.www.letour.fr.edgekey.net`. The Vuelta bucket is `img-cycling-vue-png` and it
is keyed by editorial slug, not by bib, so a tdf URL cannot be mechanically
translated into a vue one. Hotlinking either bucket from coldufantasy.com is
outside any ASO terms and breaks all at once if signatures rotate.

## Copying a board to start a new race

When a new board is created by copying an existing one, the race-specific data
arrays must be decoupled in the SAME commit or they stay shared by accident.
`vuelta.src.html` was copied from `board.src.html` on 2026-08-08 and its `RIDERS`
array stayed byte-identical to the Tour's until 2026-08-09, so the Vuelta board
was serving the Tour startlist. Decouple at minimum: `RIDERS`, the team list, team
colors and art maps, the race calendar, and any baked fallback arrays.

## Per-race scoring profiles

The two races do NOT score the same way. Never apply one race's rule to the other.
The three methods are named exactly `Placement`, `Rank`, and `Fantasy Points`.
Never write "Placement points" or "Rank points"; Fantasy Points is the only method
whose name contains "points".

| | Tour, `/tour.html` | Vuelta, `/vuelta.html` |
|---|---|---|
| System of record | Placement | Fantasy Points |
| Second board | Rank | Rank |
| Third view | Fantasy Points, toggle-only | Placement, toggle-only |
| Card toggle reads | See Fantasy Points | See Placement |

Direction is the thing that silently breaks. Fantasy Points is highest-leads.
Placement and Rank are lowest-leads. `orderBy()` sorts ascending and is correct
only for Placement and Rank; Fantasy Points must sort descending. Anything keyed
to the primary board (standings sort, day-winner-on-top in stage cards, hero
leader chips, trend-line captions) has to follow that race's profile.

## Scoring math, locked

- Placement: sum of both picks' actual finish positions, lower is better.
- Rank: all eight picks in a stage ranked 1 to 8 by finish; a player's day is the
  sum of their two picks' ranks; exactly 36 per stage.
- Fantasy Points: top-15 scale, 25 for a win down to 1 for 15th, nothing past
  15th, higher is better.
- Missed pick: scores one slot behind the worst actual pick anyone made that
  stage.
- Standings are computed from the stage data array. A player's hand tally is not
  authoritative and appears only in a reconciliation panel.

## Writing conventions for anything user-facing

- No em dashes, no en dashes, hyphens only, no HTML entities.
- American spelling.
- Board text never references how the board was made and never says "you".
- Results-based neutral framing. Never frame reconciliation as one person against
  another.
- Per-player pick reads carry both upside and downside. Analysis, never judgment,
  never downside alone.
- Never invent a pick, a finish position, or a result. If the data looks
  inconsistent, ask Allen rather than making the math work.

## Open items

- Pool switch routing fix: SHIPPED 2026-08-09, REGRESSED, RE-APPLIED 2026-08-10.
  `patch_pool_routing.py` puts `poolHref()`/`onPoolPage()` into both sources; it is
  idempotent and a no-op once applied. Keep it as the record of the edit.
  How it regressed, because this will happen again: commit `9abcb7d` was titled
  "Vuelta combativity awards" but its diff also reverted every routing edit AND the
  `{{BUILD_STAMP}}` placeholder in `vuelta.src.html` and `vuelta.html`, restoring
  the frozen July literal. `board.src.html` was untouched, which is why only the
  Vuelta side lost the fix. That is the signature of editing a STALE local copy of
  a source file and committing it: git records the reversal as part of the same
  diff. It was NOT the build. The Vuelta build is a pure substitution, so it can
  only ever mirror whatever `vuelta.src.html` already contains.
  Guard: before editing either source, confirm it is at origin/main, and after any
  Vuelta commit re-check `POOL_PAGE` is 4, old `/board.html?pool=` routes are 0,
  and `{{BUILD_STAMP}}` is present.
- Optional follow-on, still open: set `boardPath: '/vuelta.html'` on
  `pools/vuelta-2026` so routing is data-driven and the next race needs no code
  edit. The code already prefers `boardPath` over the `POOL_PAGE` map.
- `og:image` on the Vuelta board is still `tour-og.png`, so link shares preview a
  Tour graphic. BLOCKED, asked for twice, 2026-08-10. The swap needs `vuelta-og.png`
  and `make_vuelta_og.py`. Both have been reported as "in the chat" and then as
  "saved to Downloads"; neither has actually appeared in either place. Nothing is
  wrong with the plan, the two files just have not landed. `board.src.html` already
  has the full absolute-URL og set pointing at `tour-og.png`, which is correct for
  the Tour; mirror that block into `vuelta.src.html` the moment the asset exists.
  Gate before flipping og:image: `https://coldufantasy.com/vuelta-og.png` must
  return 200 with content-type image/png, and the PNG must be 1200x630.
- Rename `gcPlace` and `barsPlace`, which now render Fantasy Points on the Vuelta
  board and so are misleadingly named. Approved 2026-08-10 as its OWN commit, not
  bundled with feature work.
- `SHARED_UPCOMING` and `RACE_BAKED` in `vuelta.src.html` still hold Tour data.
  They sit below the Vuelta calendar in the fallback chain and are only reachable
  as a last resort. Could be emptied.
- Stage ledger lacks deeper climb and gradient detail.
- Allegiances has no per-team official links; lavuelta has no per-team pages.
- The Vuelta reskin change list lives in Allen's Claude project knowledge rather
  than in this repo. Commit it here so it survives a lost conversation.
