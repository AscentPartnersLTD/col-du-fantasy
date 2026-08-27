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

The board and the Worker do NOT deploy the same way. The board goes out on push,
via GitHub Pages. The `col-break` Worker does not: there is no Workers Builds git
integration on it, so pushing `worker4.js` changes the repo and nothing else. It
has to be deployed by hand, from the repo root:

```
npx wrangler deploy
```

That is the whole command. `CLOUDFLARE_API_TOKEN` is stored permanently as a USER
environment variable on Gerald and wrangler reads it automatically, so there is no
login step and nothing to click.

If a shell does not see it, a fresh process does not always inherit a `setx`
variable, so read it back explicitly. PowerShell is the shell on both of Allen's
machines, and a leading `VAR=value` prefix is bash syntax that does NOT work
there:

```
$env:CLOUDFLARE_API_TOKEN=[System.Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN","User"); npx wrangler deploy
```

Do NOT try `wrangler login` on Gerald. Its OAuth flow crashes the local callback
server with a libuv assertion, `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING), file src\win\async.c, line 76`. The server dies before it can
accept the code, so approving the browser prompt faster does not help and never
will. The API token is the only path that works on this machine. This cost three
attempts and twenty minutes once already.

Assume nothing here is automatic: `wrangler.toml` claimed for months that a push
deployed the Worker, and it never did, which is how the live Worker ran the July
18 build while the repo looked correct. Any `worker4.js` change needs the command
run before it is live, and the repo cannot tell you whether it was.

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

STOP if you are about to call `/api/board-config`: it writes EVERY pool when `pools` is
omitted, which overwrites one race's calendar with another's. Always pass `pools`. Full
detail in Writing boardConfig below. This is the single most destructive default in the
stack and it gets worse with each race added.

Firestore, compat SDK. Nothing is hardcoded from a template; the board reads pool
data at runtime.

- `pools/{poolId}` - name, members map (email to seat code), order, names, judge,
  startStage, boardConfig (race calendar, weather), carriedJerseys
- `pools/{poolId}/drafts/{stage}` - picks, queue, status, lockAt timestamps, kassei
  - `kassei` per-seat field is an ordered array of two: `[firstChoice, tiebreaker]`
  - Old single-string values (pre-2026-08-22) are migrated on read to `[string, null]`
  - Scored stage kassei shape is unchanged: `{top, f, correct[]}`
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
7. `RACE_PROFILE` in the new board's first script block, every field filled from
   that race, including `teamResultStages` set from its actual route.
8. The race added to the `RACES` registry in all three feed layers: `api/break.js`
   in the coldufantasy-login repo, and `worker3.js` and `worker4.js` here.

## Adding the Giro, end to end

As of 2026-08-23 this is the whole list. If it grows, something got hardcoded
again and that is the bug, not the checklist.

1. `giro.src.html`, copied from the closest board, then decoupled per "Copying a
   board to start a new race" below.
2. Its `RACE_PROFILE`: id `giro`, host `racecenter.giroditalia.it` (VERIFY, it has
   never been checked), the maglia rosa, ciclamino, azzurra and bianca as the four
   jersey slots, the scoring profile, and `teamResultStages` from the real route.
3. `giro` in the `RACES` registry in `api/break.js`, `worker3.js`, `worker4.js`.
4. `POOL_PAGE` entry, `<poolId>.webmanifest`, icon set.
5. `giro-og.png` via `make_vuelta_og.py`, which takes the source card, recolors it
   and repaints the eyebrow. Recoloring ALONE is not enough: the card carries its
   race in text, so a recolored Vuelta card still reads VUELTA A ESPANA.
6. Stage profile art, and the scoring row in the table above.

Nothing else. No host, jersey color, or scale is written anywhere but the profile.

## The race profile, and what must never be hardcoded again

Added 2026-08-23, after a race day was lost to a feed still pointed at the Tour
while the Vuelta was on the road. It answered with the Tour's stage 2, which is
valid JSON for a real race, so nothing errored and the board told three players
that the rider who WON the stage was off the back.

Each board declares one `RACE_PROFILE` in its FIRST script block, which makes it a
global lexical binding every later block closes over. It carries: `id`, `name`,
`shortName`, `year`, `host` and `apiBase`, `site`, `routeUrl`, `stageUrl(n)`,
`stageCount`, `startCity`, `finishCity`, `poolId`, `boardPath`, `jerseys`,
`scoring`, `sideGames`, `combativityAward`, `teamResultStages`, and `startlist`
provenance.

Reading from it, and nowhere else: `FP_SCALE`, the break widget's `RACE_ID` and
jersey chip labels, the prediction widget's `JP_JERSEYS`, the jersey colors in CSS
(as `--jsy-1` to `--jsy-4`, each rule keeping its literal as the var fallback), the
stage-count prose, the route and per-stage official links, and the stage-exclusion
rule.

Two things stay OUT of the profile on purpose:

- The calendar. Firestore `boardConfig.race` is the source of truth for stages,
  routes and results. `stageCount` is carried for copy only, so prose has a number
  to read without a second list that can drift.
- `RIDERS`. It stays inline. The profile records only where it came from and when,
  so its age is visible. Moving 184 rows is its own job.

Three rules that came out of the incident:

1. ONE Fantasy Points scale constant per board, `FP_SCALE`, at the top level of
   `__runBoard`. Do not re-declare the table. It used to be written out five times
   on the Vuelta and four on the Tour, and when the Vuelta moved from top-15 to
   top-30 two copies were missed, so Hits and Misses and the What-if panel scored
   the primary metric on the wrong curve for days.
2. The board NAMES its race on every feed request and AUDITS the reply. Never let
   the server's default decide which race a board gets. The audit is two checks,
   because either alone can be defeated: the endpoint labels its answer, and the
   names behind the returned bibs are compared with the startlist, since bib
   numbers collide across races. Measured on live stage 2: 97.3 percent rider
   agreement for the right race, 0.0 percent for the wrong one, threshold 50.
   A failed audit throws rather than renders, is never cached as a good snapshot,
   and deliberately does NOT fall back to the last good card, because a stale card
   hides the fault.
3. Remote data fails LOUDLY. A 204 No Content or an empty body is raised as a
   bind-name error, never parsed into an empty result. "No riders" and "wrong URL"
   must not look the same.

## Stage exclusions

`RACE_PROFILE.teamResultStages` lists stages whose finishes are TEAM results, so a
rider's placing is his team's and says nothing about him. Per-rider aggregation
skips them; the stage still counts and still scores. Tour is `[1]`, its 2026 stage
1 being the Barcelona team time trial. Vuelta is `[]`, its stage 1 being an
individual time trial in Monaco with real finishes.

This is NOT `voidStage`, which cancels a stage outright and remains the separate
guard. Both are applied.

It was written as a bare `n===1` in three widgets, and the Vuelta inherited it when
the board was copied, silently deleting a whole scored stage from Hall of Shame,
Stage Winners Drafted, the Rider Value Leaderboard and the persona engine. One
`isTeamResultStage()` helper now answers the question so widgets cannot diverge.
When adding a race, set this from its actual route, not by copying.

## Void stages, and whether the baton passes

A void stage scores nothing. Whether it ADVANCES the pick order depends on one question
only: did a draft happen?

- A draft happened and the race was lost to something else: the baton PASSES. The stage
  counts as having happened, it scores nothing, nobody is penalized, and the next stage
  leads off one seat forward. Vuelta 2026 stage 3, Gruissan-Aude to Font Romeu, is the
  case. It was neutralized and then cancelled on 24 Aug after a hailstorm on the Col de
  Mont-Louis, with no result recorded, but all four seats had drafted and the race had
  covered 160 km. Ruling from Allen: play it the way the race did.
- No draft happened: the baton does NOT pass. Tour 2026 stage 9 is that case, a DNS for
  the whole pool with `picks: {}`, so the rotation stays in phase across it.

The flag that encodes this is `voidPool` on the `boardConfig.race` row, NOT `voidStage`
on the stage doc. `seasonOrder()` skips every `voidPool` row when it counts the rotation,
so `voidPool` means exactly "no draft was taken here". Setting it on a stage that WAS
drafted silently rewrites the leadoff for every earlier stage in the Draft Tilt strip and
labels the drafted stage "no draft". On stage 3 that would have moved stages 1 and 2 to
the wrong seats and denied that JB led off at all.

So, for a void stage that WAS drafted, write the race row as `upcoming:false`, `win:""`,
and an `extra` saying what happened, and leave `voidPool` OFF. The blank Winner cell plus
the note is what keeps the row from reading as unraced-but-upcoming. The greyed `.void`
row styling is the only thing given up, and it is not worth falsifying the draft order.

On the stage doc, `voidStage:true` with `picks` present and `days` OMITTED is what makes
the stage score nothing. `COMPLETED` filters on `!s.voidStage && s.days`, so either half
alone excludes it, and every scoring widget reads COMPLETED. Verified on stage 3: totals
held at AA 126, JB 98, JP 56, JJ 47, and Winners picked stayed 2/2 scored days. Picks
carry `f: null`; every unguarded consumer already tests `fin != null` or `f === 1`, so
they drop out cleanly, while Allegiances still counts the riders, which is correct
because the picks stand. Give the doc a `win` string, because the card head prints
`Winner: ${st.win}` and an absent field prints "undefined". Tour stage 9 used
"Neutralized"; Vuelta stage 3 uses "Cancelled".

The stamp on a void card is `voidLabel` on the stage doc, added 2026-08-25. It was a
hardcoded `DNS`, which was true of Tour stage 9 and a lie about Vuelta stage 3, where
all four drafted and the race ran 160 km before the hail. It is now DATA:

- `voidLabel: "DNS"` - no draft was taken. Tour 2026 stage 9.
- `voidLabel: "CANCELLED"` - drafted, then lost on the road. Vuelta 2026 stage 3.
- absent - the card reads `VOID`, neutral and true of any void stage.

Set it deliberately per stage. NEVER derive one from the other: the board cannot tell a
non-start from an abandonment, and the whole point of the field is that guessing is what
told three players a raced stage never started. The renderer upper-cases and strips
`<>&`, and it is deliberately self-contained rather than calling `esc()`, because `esc`
lives in an earlier `<script>` block and a ReferenceError inside `stageCard()` blanks the
whole board. Same trap as the `MER` note in Open items.

The `.dns-stamp` and `.stage.dns` CSS classes now render more than DNS and are misnamed.
Renaming them is its own commit, like `gcPlace` and `barsPlace`.

## Writing boardConfig, two traps

`POST /api/board-config` writes to EVERY pool doc when `pools` is omitted. That default
was written when there was one race. There are two now, with different calendars, so
omitting `pools` overwrites the Tour's calendar with the Vuelta's. ALWAYS send
`pools:["vuelta-2026"]`, or whichever single pool is being changed. Confirmed
2026-08-25: the two pools hold genuinely different `boardConfig.race` arrays.

`config.race` is an ARRAY, so it REPLACES wholesale. Read the current 21 rows, edit the
one, send them all back. `sharedUpcoming`, `weather` and `next2` are maps and deep-merge,
which cuts both ways: a key not resent SURVIVES. Rolling `next2` from stage 4 to stage 5
left the old `extra`, "Short, savage Andorran day", attached to Falset > Roquetes. Send
every field the map should end up with, including the empty ones.

Upcoming-card intel has a precedence order, and the race row SHADOWS sharedUpcoming:

    drafts/{n}.intel  >  race row .intel  >  race row .extra  >  sharedUpcoming[n].intel

`extra` is promoted to `{summary: extra, facts: []}`, so a one-line `extra` on the race
row silently suppresses a whole `sharedUpcoming` intel block, facts and all. This is what
first swallowed the stage 4 Andorra intel: seven facts written, zero rendered, and the
card showed only "Short, savage Andorran day". Clear the race row's `extra` when the
intel lives in `sharedUpcoming`.

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

## Harvesting images, two rules learned the hard way

Both of these were real defects shipped in the same week, 2026-08-21.

1. Always run `ImageOps.exif_transpose(im)` BEFORE cropping or resizing. Pillow's
   `Image.open()` does not apply the EXIF orientation tag, so a source shot in
   portrait (tag 6 or 8) gets cropped on its raw sensor pixels and ships rotated
   90 degrees. This is how the Thibau Nys photo went out sideways with his head
   clipped. Only 1 of 17 files carried a bad tag, so spot-checking will miss it.
2. A file returning HTTP 200 with a valid free licence is NOT evidence that the
   image shows the rider. Four of seventeen Commons images passed both checks and
   were unusable: one was traffic cones with a distant rider, two were peloton
   shots where the subject could not be identified. LOOK at every harvested image,
   for example by tiling them into one contact sheet and reading it, before
   shipping. Prefer the initials avatar over a photo that does not show the rider.

## Copying a board to start a new race

When a new board is created by copying an existing one, the race-specific data
arrays must be decoupled in the SAME commit or they stay shared by accident.
`vuelta.src.html` was copied from `board.src.html` on 2026-08-08 and its `RIDERS`
array stayed byte-identical to the Tour's until 2026-08-09, so the Vuelta board
was serving the Tour startlist. Decouple at minimum: `RIDERS`, the team list, team
colors and art maps, the race calendar, and `RACE_PROFILE`.

Do NOT carry a baked fallback calendar across at all. `SHARED_UPCOMING` and
`RACE_BAKED` were exactly that and were deleted on 2026-08-23; the reasoning is in
Open items. A fallback holding another race is worse than no fallback, because it
renders as real. Firestore `boardConfig.race` is the calendar, and an empty
calendar renders as nothing, which is the correct failure.

## The rider search, and the one place it lives

Added 2026-08-25. The stage draft and the jersey predictions widget both search the
same 184-rider startlist, so they call ONE matcher, `riderMatches()`, and ONE row
renderer, `riderRows()`, wired by `wireRiderSearch()`. All three sit at the top level
of the FIRST board script block, just after `esc`, which is above both consumers.

Do not write a second search. That is the duplication bug the Fantasy Points scale had
when it was written out five times, and it fails the same silent way: one surface gains
accent folding or team disambiguation, the other does not, and nothing errors.

Normalization is `_nrm()`, which FOLDS accents rather than deleting them, so "Pogacar"
finds "T. Pogacar". There is a SECOND normalizer on the board, `norm()` in the break
widget, and it is NOT the one to reuse: it is declared inside that widget's IIFE in a
later script block, so referencing it from the predictions widget throws a
ReferenceError at load and blanks the board. Same trap as the `MER` note in Open items.

The callers differ only in what they exclude:

- draft: riders already taken this stage, plus riders out of the race (`activeOnly`).
- predictions: nothing. Any of the 184 is legal for any jersey, and two seats may name
  the same rider. Passing a `taken` set or `activeOnly` here would silently change the
  rules of the side game.

Results show the rider's TEAM alongside the name, and that is load-bearing rather than
decorative: this startlist carries THREE riders surnamed Rodriguez, bibs 65 (Carlos
Rodriguez, Netcompany INEOS), 166 (J. Rodriguez, EF Education-EasyPost) and 186
(Cristian Rodriguez, XDS Astana Team). A surname alone cannot tell them apart.

The search CSS is written once against both mounts, `#draftMount` and `#jerseyPreds`,
rather than copied. Only two things differ and both are overridden explicitly: the
predictions panel runs full width because there is no Lock button beside the field, and
its input is 16px because anything smaller makes iOS Safari zoom the page on focus,
which is the opposite of the point on a phone.

## Jersey predictions: the deadline stage

Added 2026-08-25. The widget used to flip `predictionsLocked` the instant the fourth
seat submitted, with no deadline, so an early pool could close the picks before anyone
had stages to judge from. After Stage 3 was cancelled the group asked for more stages.

The reveal now waits on TWO conditions:

1. All four seat docs exist. This half is SERVER-enforced and unchanged: the security
   rule permits the flip only once all four `predictions/{seat}` docs exist, so a
   refusal is the normal "not everyone is in yet" and stays swallowed.
2. The deadline stage is scored. This half is CLIENT-enforced, checked in
   `jpDeadlineMet()` before `jpTryLock()` attempts anything.

The deadline is `boardConfig.predictionsThroughStage` on the pool doc, a stage number.
It is data, not code, so it moves without a rebuild. Absent or zero means the old
behavior, lock as soon as all four are in, which is what the Tour board still does.

"Scored" is the same test the rest of the board uses: not `voidStage`, and carrying
`days`. `jpDeadlineMet()` reads the already-loaded stages first, then falls back to a
direct read of `pools/{poolId}/stages/{n}`, so a stage scored after the board loaded
still opens the reveal without a refresh.

The lock is retried in two places, because the deadline stage is typically scored long
after the last seat submitted and nothing submits again to trigger the flip: once on
boot, and again on every pool-doc snapshot, which is what a stage close writes.

WORTH KNOWING, and not currently a defect: the deadline is NOT enforced by the
database. Every seat runs the same code so the behavior is correct, but the rule would
still permit a seat with devtools to flip `predictionsLocked` early once all four docs
exist. Writes to a seat's own prediction stay allowed while `predictionsLocked` is
false, which is what keeps the picks editable through the deadline, so that half needed
no rule change either. If the deadline should be enforced rather than merely observed,
the rule needs the stage read added; the exact text is in the 2026-08-25 session notes
and was handed to Allen rather than published.

## NEVER write boardConfig.next2

Added 2026-08-25 after writing it broke the Stats card in production.

The board reads `next2` as a FLAT object: `{n, route, type, km, profile, line}`. A
keyed map like `{"6":{...}}` leaves `N2.n` and `N2.route` undefined and the "Next two
stages" card renders `STAGE UNDEFINED / undefined`.

The second half is worse and is what makes this a rule rather than a typo. `NEXT2` is
read as:

    const NEXT2 = (CDF.boardConfig && CDF.boardConfig.next2 !== undefined)
      ? CDF.boardConfig.next2 : NEXT2_BAKED;

so the field merely EXISTING is enough. Any written value is truthy, the card's
`if(!N2)` fallback never runs, and the derivation is dead. Deleting the field is what
restores it, not correcting its shape.

So: do not write `next2` at all. Left unset, the card derives the next stage from
`boardConfig.race`, including the profile image and the rotated pick order via
`orderFor()`, and it self-maintains as `upcoming` advances. Writing it is strictly
worse than leaving it empty, in every case, with no exception worth carving out.

Verified live with the field deleted: "Stage 6 Alcossebre > Castello, 177.4 km,
Pick JP > JB > AA > JJ".

Any close script that writes `next2` carries this bug, and anything copied from that
script inherits it. The reference close script had exactly this pattern and it has
been removed.

## riderProfile pins bypass the persona engine, and must SAY SO

Added 2026-08-25, after four pins cost most of a day.

`riderProfile.{seat}.pin` is honored in step 1 of `PERSONA_BY`:

    /* 1) explicit pin in RIDER_PROFILE always wins */

Step 2 opens with `if(assigned[p]) return;`, so a pinned seat never reaches the hold
check and the ledger is never read for it. Every hand edit to `personaLedger.by` was
silently discarded, four times across two builds, while the ledger itself looked
correct on read-back. `order` appeared to survive only because the engine rewrites it
with `fanOrder`, which already matched.

The pins held `contador / valverde / cancellara / pirate`. Feeding those pins plus a
correct ledger to the real engine reproduces the reverted set exactly, all four names.
They have been cleared, and the ledger now controls assignment.

Two rules out of it:

1. Do NOT reintroduce pins as a rotation mechanism. Rotation is the ledger's job.
   A pin is an operator override and nothing else.
2. A pin must be VISIBLE on the card. The board now prints "Persona pinned, rotation
   bypassed" on any seat whose assignment came from a pin, and "Pin not in the bank,
   ignored" when a pin is set but its id matches no persona, which is its own silent
   failure. A silent pin is indistinguishable from a broken engine, and that is the
   whole reason this took hours instead of minutes.

When personas will not rotate, check `riderProfile` BEFORE the ledger. The card now
answers the question without a console read.

## Persona rotation, and the ledger

Rule from Allen, 2026-08-25: when ANY player changes position in the standings, ALL
FOUR personas re-draw. Not only the seats that moved.

The engine used to compare each seat's own position against the stored one, so seats
that happened to stay put kept their names. After stage 4 that would have left AA and
JP wearing the same personas while only JJ and JB rotated. `PERSONA_BY` now computes
`orderChanged` ONCE, across the whole order, and that single boolean decides the whole
board. Unchanged order means everyone holds; any change means everyone re-draws.

Two guards survive the change and are deliberately separate from it:

- The winner tier still follows the Fantasy Points leader, since that is the Vuelta's
  system of record. A seat can move on the tier check alone, with the order unchanged,
  when it gains or loses the lead: a new leader gives up a style name and a former
  leader hands the champion name back rather than sitting on it.
- The seen-history guard still blocks repeats, and movers still exclude every persona
  on the previous board, so there are no swaps and no hand-me-downs. The bank carries
  12 winner and 44 style rows, which is ample for a full four-seat re-draw.

`order` in the ledger is the STANDINGS at the moment of the assignment, written from
`fanOrder`. It used to hold seat order, which is why the held check was comparing a
standing against a seat list and the same personas kept reappearing. If a stale seat
order is ever restored there, every load will see a change that never clears.

## The persona ledger is INERT until a rule is published

The persistence has been in the board since commit `9455c5f` (2026-08-21) and was
never removed. It is not missing code. It is code whose write is DENIED, silently,
because no Firestore rule permits it, and the failure is swallowed on purpose so the
board behaves exactly as it does today.

What it does when permitted: writes `order`, `by` and `seen` together in a
`runTransaction`, and ONLY when the computed assignment or the stored order differs
from what is stored. Writing on every load would make the next load see
`order === current`, mark everyone as having held, and freeze the personas forever.
That failure is silent, which is why the guard is in the code rather than in a note.
Both halves are compared, not just `by`: if the standings moved but the re-draw landed
on the same names, snapshotting only `by` would leave the old order in place and every
later load would re-draw forever.

The rule to publish, in the `pools/{poolId}` match block:

```
allow update: if request.auth != null
  && request.auth.token.email in resource.data.members
  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['personaLedger'])
  && request.resource.data.personaLedger.keys().hasOnly(['order','by','seen'])
  && request.resource.data.personaLedger.order is list
  && request.resource.data.personaLedger.by is map
  && request.resource.data.personaLedger.seen is map;
```

KNOWN WEAKNESS, accepted rather than overlooked: `hasOnly(['personaLedger'])` scopes
the write to that one field but says nothing about WHOSE part of it is being written.
Any pool member can rewrite the whole ledger, including another seat's `by` and `seen`
history. Firestore rules cannot cheaply constrain a per-seat sub-map without naming
every seat, so a member could wipe or forge another seat's persona history. In a
private four-person pool that is a reasonable trade, but it is a trade, and it should
be made on purpose. Tightening it means enumerating the seats in the rule and checking
that only the caller's own key changed.

Until this is published, every rotation stays a hand edit in the console and drifts the
moment nobody does it. That is the actual problem the persistence solves.

## Void stages COUNT for Allegiances and the Arlequin

Added 2026-08-25, after the mistake was made by hand.

Two tallies read the same stage array and must never be made consistent with each
other, because they are counting different things:

- Allegiances and Le Maillot Arlequin count PICKS. `STAGES` is iterated whole, with
  no `COMPLETED` filter and no `voidStage` check. A cancelled stage wipes the result,
  not the drafting: the riders were really chosen, so the teams were really collected.
- Scoring counts RESULTS. `COMPLETED` filters on `!voidStage && s.days`, so a void
  stage scores nothing.

Both are correct. They are not in conflict.

This is load-bearing right now. Stage 3 was cancelled for hail after all four seats
had drafted. JJ took Skjelmose (Lidl-Trek) and Johannessen (Uno-X Mobility) that day,
and those are the only two teams he holds from it. Verified live 2026-08-25:

    seat   including void   excluding void
    JJ            8                6
    JP            6                6
    AA            5                4
    JB            5                5

Filtering the void stage drops JJ from 8 to 6 and erases his entire Arlequin lead,
tying him with JP. That is exactly the wrong answer that was reached once by hand.

The tally site carries the same warning in a comment. Do not "fix" it.

## Every ordinal names its board

Added 2026-08-26, after a badge on the Numbers panel was read as stage-over-stage
movement by the person who designed the board.

THE RULE. A bare ordinal or delta anywhere on the board defaults to Fantasy Points,
the system of record. Anything derived from Placement or Rank must name that board in
the VISIBLE LABEL, next to the number. Prose around it does not count: people read
the number and skip the paragraph. That is exactly how this one was misread.

What went wrong: the Fantasy Points panel carried badges reading UP 2 and DOWN 1. The
arithmetic was correct, the Placement position minus the Fantasy Points position, but
UP and DOWN on a leaderboard read as movement over time. It was also backwards in
emphasis: a delta against Placement sitting on the authoritative panel implies
Placement is the baseline.

The fix moved the badge to the PLACEMENT panel and relabelled it "+2 on FP". The
rendering decided it over merely relabelling in place: `.wi-row` declares five columns
for both panels and the Placement row only ever filled four, so the fifth column was
already reserved and empty. Moving the badge costs no width at any breakpoint and
frees 60px for the bar on the Fantasy Points side, where relabelling in place would
have widened the tighter panel.

Surfaces checked and left alone, because they are already unambiguous:

- Palmares cards. Two position badges side by side, but each ordinal sits directly
  above its own board name, Fantasy Points and Rank. The label is the layout.
- Stage card and awards prose that says "3rd out of the break" or a Kasseistampers
  finish. Those ordinals are RACE finishing positions, not pool board positions, and
  the surrounding words say so.

Fixed alongside the badge: two persona lines emitted a bare ordinal off the Placement
board and now say "3rd on Placement".

## Abandoned riders, and the roster that drives them

Added 2026-08-27. Read this before touching any rider picker.

WHO IS OUT COMES FROM DATA, never a list. The source is the col-break Worker's
`/roster?stage=N&race=vuelta`, which reads the general classification (`itg`) for the
most recent stage that HAS one. Chosen over the alternatives for reasons worth keeping:

- `itg` lists who REMAINS in the race, so an abandonment or a time-limit exclusion
  simply stops appearing. Nothing to maintain and no special case for the time limit.
- `/roster` already walks BACKWARD up to three stages looking for a classification, so
  a cancelled stage is skipped by the endpoint. Stage 3 has no `itg` at all and needs
  no guard here.
- `/api/pool-state` cannot answer it. It carries pool PICKS, so it knows nothing about
  the riders nobody drafted.
- The stage FINISHERS array is deliberately not the source. Absence from one stage's
  finishers is not abandonment, and using it would produce false positives.

Verified live 2026-08-27: 180 active of 184, resolving exactly Uijtdebroeks 28,
Kirsch 143, Chumil 194 and van Sintmaartensdijk 208. Belgians available computes to
17, not 18.

WHAT WAS ALREADY THERE, AND WHY NOTHING WORKED. The whole greyed-out treatment
existed and had never been wired to anything:

- `.mer-out` (opacity plus grayscale), `.mer-outtag` printing "Abandoned", and the
  featured slot printing "Abandoned - not selectable" all hang off `u.out`, and
  NOTHING anywhere set that field.
- Both chip click handlers already refuse a chip carrying `data-out`.
- `window.__ACTIVE` was referenced by the draft search filter and NEVER POPULATED, so
  that guard was dead code and every abandoned rider stayed selectable.

Do not rediscover this. The mechanism is sound; it was only ever missing its input.

HOW IT IS WIRED NOW. A loader sits immediately after `_nrm` in the FIRST board script
block, so `RIDERS` and `_nrm` are both above it:

- `window.__ACTIVE` is a Set of active bibs, `window.__OUT` the RIDERS rows that are gone.
- `riderIsOut(name)` maps name to bib through `_BIBMAP` and answers from `__ACTIVE`.
- `_markOut()` stamps `u.out` on `BELGIAN_RIDERS` and `USA_RIDERS` in place, so every
  consumer sees it without each render site asking.
- The loader FAILS SOFT. If the roster cannot be read, `__ACTIVE` stays null,
  `riderIsOut` returns false, and every rider stays selectable. A board that blocks
  every pick is worse than one that blocks none.
- The roster lands AFTER first paint, so the loader repaints the Kasseistampers card,
  the Merica card and the draft. The draft is repainted unconditionally rather than on
  `_markOut()`, because `_markOut` only tracks the two side-game rosters and a drafted
  rider may be in neither.

The draft search SHOWS abandoned riders greyed rather than hiding them, and emits no
`data-i`, which is what the click handler keys on. A rider vanishing from a familiar
list reads as a bug; a rider shown as gone reads as information.

A pick locked BEFORE its rider abandoned is never silently changed. It stands exactly
as drafted and is flagged, in the completed-draft mini bar and in the live ticker, so
the seat knows before the stage is scored rather than after.

## The startlist is scored by BIB, so a wrong bib is silent and total

Added 2026-08-27, after two bibs were found swapped on a live board.

`RIDERS` is not a display list. It is the bib table, and it is what turns a pick into
a result. `close-stage.js` builds `bibByName` from it, resolves every pick to a bib,
and reads the finish off `posByBib`. Its own gate says it: "a pick did not resolve to
a bib; never fall back to name matching". So a name attached to the wrong bib does not
error, does not look wrong, and does not fail a gate. It hands one rider another
rider's finish, forever, and the board reports it with full confidence.

The same table is read by `belFinOf()` for the Kasseistampers call, by `nameByBib()`
for the stage winner and the top Belgian, by the break widget's rider audit, and by
`_BIBMAP` / `riderIsOut()` for the abandoned-rider greyout. One wrong row corrupts all
of them at once and none of them complains.

WHAT WAS WRONG. Vuelta 2026 bibs 103 and 104 were swapped. Ours had 103 L. de Vylder
and 104 R. Debruyne; the official list has 103 R. Debruyne and 104 L. de Vylder. Every
other Alpecin bib matched, so the error was ours, not the feed's. Fixed 2026-08-27.

The full 184 were then audited by bib against
`https://racecenter.lavuelta.es/api/allCompetitors-2026`, comparing surname tokens and
team slug. No bib is missing, none is extra, no team is wrong, and 103/104 was the only
identity error. Seven rows differ in spelling only and are correct riders: hyphenated
surnames the feed splits (Fisher-Black, Paret-Peintre, Renard-Haquin), known short
first names (Eddie Dunbar, Nick Schultz, Larry Warbasse), and one transliteration
(Mulubrhan). Around 40 more carry the short Spanish surname where the feed carries both
surnames, which is the display convention and is deliberate.

NOTHING SCORED WAS CORRUPTED, and this was checked rather than assumed. No seat drafted
either rider in any of stages 1, 2, 4, 5 or 6. Stage 6's top Belgian genuinely WAS
R. Debruyne, 3rd, and the stored stage doc names him correctly, because that stage was
closed by hand from the result rather than through the bib table. JJ named Debruyne as
his Kasseistampers TIEBREAKER, not his first choice, and only a first choice can be on
target, so `correct: []` is right. Had he named him first, `belFinOf('R. Debruyne')`
would have returned bib 104, de Vylder's finish, and denied him the cobble with no
error anywhere. That is how close this came to deciding a side game wrongly.

THE RULE. Audit the whole startlist against the official competitor list, by bib, on
every race launch and after any edit to `RIDERS`. `RACE_PROFILE.startlist` now carries
an `audited` date beside `captured` so the age of the CHECK is visible, not just the
age of the capture. Cross-checking against procyclingstats is not a substitute: the
bib is what scores, and only the race's own feed is authoritative about bibs.

## Where the site update stands, 2026-08-27

Allen's numbering, recorded as his rather than as a verified finding: of the full site
update, JOB 2 is the abandoned-rider work above and is COMPLETE. JOBS 1, 3, 4, 5 and 6
are UNSTARTED. The session that wrote this did not hold that six-job list and cannot
name those five jobs; get the list from Allen before assuming what they are.

`SESSION-HANDOFF.md` in this repo carries the other open items, including the
positional-ambiguity audit that is only partly done and the automation phases. Delete
that file once its items close.

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
- Fantasy Points: Vuelta uses top-30 scale, 50 for a win down to 1 for 30th;
  Tour uses top-15 scale, 25 for a win down to 1 for 15th. Nothing past the
  cutoff, higher is better. The table lives in `RACE_PROFILE.scoring.fantasyScale`
  and is read through `FP_SCALE`. There is exactly ONE copy per board; never write
  the numbers a second time.
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

- The Giro host `racecenter.giroditalia.it` in the Adding the Giro checklist is a
  GUESS and has never been checked. Verify it, and verify that the bind names
  match the ASO shape, before writing it into a profile. A wrong host is exactly
  the failure this whole refactor was about.
- `col-break` deploy: CLOSED 2026-08-23, deployed by Allen, source=wrangler, the
  first deployment of this Worker not hand-pasted through the dashboard. Verified
  live on the deployed copy: the default answers race=vuelta with one group,
  Peloton 183, on a current timestamp, and `?race=tour` answers race=tour with
  five groups on the stale Tour snapshot. The fallback now agrees with the primary
  about which race it is describing.
  Two things worth keeping from how this went. It was first misdiagnosed here as
  "Workers Builds has not rebuilt yet", and a session sat waiting for a rebuild
  that was never coming, because `wrangler.toml` said a push deployed the Worker.
  The Cloudflare deployments API showed every earlier deployment as
  source=quick_editor. A comment in the repo is not evidence that a pipeline
  exists; check the provider.
  And `wrangler login` cannot work on Gerald at all, see Deploy above for the
  libuv assertion. The API token path is the only one, and the token is now a
  permanent user environment variable, so a deploy is one command with no login.
- Machine Gerald (bogie): the Claude Code Grep tool returns false negatives on this
  machine. In the 2026-08-22 session it returned "No matches found" for POOL_PAGE,
  mfb, header, mast, hero, body, and other strings that bash grep found in the same
  files. Use `grep` or `rg` via Bash for existence checks on Gerald, and treat a
  zero result from the Grep tool as unproven rather than as absence.
- Jersey prediction colors use the OFFICIAL 2025 jersey art carried forward, because
  lavuelta.es had not published the 2026 assets as of 2026-08-21: of the six ranking
  jerseys only `2026/icg.png` (combined) existed, the other five returned 404. Values
  sampled from the official 2025 PNGs are red `#d81830` general, dark green `#003018`
  points, blue `#0060a8` mountains, white/grey young. RE-CHECK once
  `lavuelta.es/img/ranking-jerseys/2026/*.png` fills in and correct them if the 2026
  designs differ. Classification NAMES are confirmed for 2026: General, Puntos,
  Montaña, Joven, plus Equipo and Combativo.
- `barsRankPts()` was deleted 2026-08-21 along with the whole Overview bars block. It
  was kept deliberately in an earlier pass as the retired Fantasy-Points-on-Rank lens;
  that decision is now reversed on purpose, because with no bars anywhere on the board
  a bars renderer has nothing to draw into. Do NOT restore it. The table twin
  `gcRankPts()` is a separate function and still present.
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
- og:image on the Vuelta: CLOSED 2026-08-23. `vuelta-og.png` and
  `make_vuelta_og.py` are both in the repo. The script builds the card from the
  repo's own `tour-og.png`, so nothing has to be produced outside the repo, which
  is why this sat blocked from 2026-08-10: the two files were reported as saved
  twice and never landed. Recoloring alone is NOT enough, because the card carries
  its race in text and a recolored Tour card still reads TOUR DE FRANCE 2026, so
  the script also repaints the eyebrow. Verified live: 200, image/png, 1200x630,
  byte-identical to the committed file.
- Rename `gcPlace` and `barsPlace`, which now render Fantasy Points on the Vuelta
  board and so are misleadingly named. Approved 2026-08-10 as its OWN commit, not
  bundled with feature work.
- `SHARED_UPCOMING` and `RACE_BAKED`: CLOSED 2026-08-23, both DELETED rather than
  translated. They were not the harmless last resort they were assumed to be.
  `boardConfig.sharedUpcoming` was empty in Firestore, so the baked Tour course
  intel WAS the live fallback for `intel`, and `reads` and `flag` had no
  `boardConfig.race` guard at all. Vuelta stage 15 would have printed the Tour's
  "Champagnole > Plateau de Solaison". Each array had exactly one reader and both
  now degrade to empty: an empty line is honest, another race's stage reads as
  real.
- Stage ledger lacks deeper climb and gradient detail.
- Allegiances has no per-team official links; lavuelta has no per-team pages.
- The Vuelta reskin change list lives in Allen's Claude project knowledge rather
  than in this repo. Commit it here so it survives a lost conversation.
- Persona bank expansion, 27 rows to 56: BLOCKED 2026-08-11. Needs
  `persona-bank-additions.js` (29 rows: 4 winner, 25 style). It does not exist
  anywhere on Dragon. This is the third file in three sessions reported as saved
  from chat that never landed, after `vuelta-og.png` and `make_vuelta_og.py`. The
  bank cannot be written from scratch here: every row carries a `/* src: URL */`
  citation that has to be fetched and checked, and inventing either the blurb or
  the citation would violate the never-invent rule above. Ask Allen to confirm the
  file is on disk before starting.
- `MER` cannot be added to `PSTATS` as written. `PSTATS` is an IIFE at
  vuelta.src.html:2772 and builds `S[p]` at :2785. Every `MER` is declared later
  and in a narrower scope: :2966 inside the palmares-cards IIFE that opens at
  :2963, :3523 inside the Merica widget, :3545 inside the Kasseistampers widget.
  Referencing `MER[p]` from the PSTATS builder throws `ReferenceError: MER is not
  defined` at load and blanks the board. To expose a Kasseistampers count to the
  persona engine, hoist ONE computation of it above :2772 and have the three
  existing sites read that, in a commit of its own. Note :2966 and :3545 both
  count `s.kassei.correct`, so the Kasseistampers tally is already duplicated.
- Persona ART coverage is currently complete, 27 emblems for 27 rows. Any bank
  growth that ships without emblems regresses that: 56 rows with 27 emblems is 48
  percent coverage, and the uncovered rows fall through to the generic jersey
  avatar. The fallback is safe, `ART[unknownId]` is undefined and the renderer
  branches on falsy at :2986, so it degrades rather than errors. Ship art with
  rows, or accept the mixed look deliberately.
- Void card stamp: CLOSED 2026-08-25. Driven by `voidLabel` on the stage doc in both
  boards, see Void stages above. Live values set the same day: Vuelta stage 3 CANCELLED,
  Tour stage 9 DNS. The `.dns-stamp` / `.stage.dns` class names were left misnamed on
  purpose; renaming is its own commit.
- `RACE_TOP5` on the Vuelta board: CLOSED 2026-08-25, DELETED rather than translated,
  the same call made on `SHARED_UPCOMING` and `RACE_BAKED`. It held the 2026 TOUR top
  fives. Verified before deleting that nothing read it: exactly one occurrence per file
  across the whole repo, the declaration. The Tour board keeps its own copy, which is
  correct there and is also currently unread. If a top-5 display is ever built, source
  it from the race being displayed and give it the same provenance comment the startlist
  carries, so its age is visible.
- Rename `.dns-stamp` and `.stage.dns`, which now render and style more than DNS. Same
  shape as the `gcPlace` / `barsPlace` rename below, and the same rule: its own commit,
  not bundled with feature work.
- `/api/board-config` still DEFAULTS to writing every pool when `pools` is omitted. The
  callers are all correct today and CLAUDE.md warns twice, but the safe fix is to make
  `pools` required and 400 without it, in the coldufantasy-login repo. Recommended, not
  done: it is a different repo with its own Vercel deploy, and per the col-break lesson
  the pipeline should be checked with the provider before assuming a push ships it.
