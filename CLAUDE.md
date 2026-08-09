# Col du Fantasy - context for Claude Code

Read this first. It is the cold-start brief for this repo. If it disagrees with a
chat conversation, this file wins, because chat history disappears and the repo
does not. Keep this file updated in the same commit as any change it describes.

Operator: Allen Abbott. Owner account: allen@ascentpartnersltd.com.

## What this is

A private, operator-run daily-pick fantasy cycling pool. Four players per pool,
each picks two riders per stage, lower cumulative placement points wins. Two live
races share one codebase:

- Tour de France 2026 pool `col-du-fantasy`, board `/tour.html` (gold skin)
- Vuelta a Espana 2026 pool `vuelta-2026`, board `/vuelta.html` (red skin)

Live at https://coldufantasy.com from this repo via GitHub Pages, branch `main`,
CNAME in the repo root. `AscentPartnersLTD/ascent-design-drops` is the older
hosting repo and is no longer the one to commit to.

## Files that matter

Sources, edited by hand:

- `board.src.html` - the Tour-family board source. Contains the literal
  placeholder `{{DEFAULT_POOL}}`.
- `vuelta.src.html` - the Vuelta board source. Separate file, red skin, its own
  side games and calendar. Also contains `{{DEFAULT_POOL}}`.
- `build_boards.py` - substitutes the placeholder and writes the built files.

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
python3 -c "s=open('vuelta.src.html',encoding='utf-8').read(); open('vuelta.html','w',encoding='utf-8').write(s.replace('{{DEFAULT_POOL}}','vuelta-2026'))"
```

`build_boards.py` covers only the Tour family. The Vuelta build is the one-liner
above. Add `--staging-only` to build just the staging copy.

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

## Scoring, locked

- Placement points: sum of both picks' actual finish positions, lower is better.
- Rank points: all eight picks in a stage ranked 1 to 8 by finish; a player's day
  is the sum of their two picks' ranks; exactly 36 rank points per stage.
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

- Pool switch routing fix: SHIPPED 2026-08-09. `patch_pool_routing.py` applied to
  both sources, rebuilt, validated, pushed to main. The switcher and the sign-in
  roster reroute now go through `poolHref()`, and `onPoolPage()` gives the
  checked entry an escape hatch when the shell is wrong. The script is idempotent
  and now a no-op against these sources; keep it as the record of the edit.
- Optional follow-on, still open: set `boardPath: '/vuelta.html'` on
  `pools/vuelta-2026` so routing is data-driven and the next race needs no code
  edit. The code already prefers `boardPath` over the `POOL_PAGE` map.
- `og:image` on the Vuelta board is still `tour-og.png`, so link shares preview a
  Tour graphic. Needs a Vuelta asset.
- `SHARED_UPCOMING` and `RACE_BAKED` in `vuelta.src.html` still hold Tour data.
  They sit below the Vuelta calendar in the fallback chain and are only reachable
  as a last resort. Could be emptied.
- Stage ledger lacks deeper climb and gradient detail.
- Allegiances has no per-team official links; lavuelta has no per-team pages.
- The Vuelta reskin change list lives in Allen's Claude project knowledge rather
  than in this repo. Commit it here so it survives a lost conversation.
