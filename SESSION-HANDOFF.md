# Session handoff, 2026-08-27

Written because a context window ran out mid-stream, not because the work finished.
`CLAUDE.md` is still the cold-start brief and every durable rule learned in this
session was written into it as it was learned. This file holds only what CLAUDE.md
deliberately does NOT: what is mid-flight, what is unverified, and what to do next.

Delete this file once the open items below are closed.

## Where things are

Two repos, and it matters which:

- `C:\Users\bogie\col-du-fantasy` - PUBLIC, served by GitHub Pages. The board.
  HEAD `3b00db5`, clean, pushed. Live build `20260827-131050Z`, verified
  byte-identical to local.
- `C:\Users\bogie\coldufantasy-login` - PRIVATE, Vercel, deploys on push to main.
  HEAD `3713766`, clean, pushed. The API and the operator tooling.

It was NOT checked out on this machine at the start of this session and was cloned
during it. If it is missing again, clone it; the git credentials are cached.

Never put `SCORE_KEY` in the public repo. That is why `close-stage` lives in the
private one.

## What was built this session

- `api/pool-state.js` (private repo). Key-authenticated READ:
  `GET /api/pool-state?pool=vuelta-2026&stage=N`, header `x-cdf-key`. Returns the
  pool doc, a stage's draft with picks and kassei, and every scored stage. This is
  the keystone that removes the browser from a stage close.
- `tools/close-stage.js` (private repo). One command, eleven gates, retry ladder.
  Dry run by default, `--commit` to write.
- Board: 56 ART emblems, computed archetypes and datapoints, positional badges that
  name their board, abandoned riders greyed out.

## OPEN, in the order they matter

1. **Flag an already-locked pick on a rider who later abandons.** NOT implemented.
   Was item 4 of the abandoned-riders task. No seat currently holds such a pick, so
   it is not live-visible, but it is the piece most likely to bite. The data is
   already there: `window.__ACTIVE` and `riderIsOut(name)` are populated on load.

2. **`close-stage --commit` has never run for real.** It is verified against Stage 4
   in dry run, reproducing the stored stage exactly, but no live close has been done
   with it. The next real stage close is the acceptance test. Do NOT pass `--quick`;
   that skips the 60-second completeness hold and exists only for testing.

3. **`--void` is untested against a real void stage.** The logic omits `days` rather
   than zeroing, passes the baton only if a draft happened, and requires an explicit
   `voidLabel`, but it has not run.

4. **`memberEmails` returns 5 addresses for a four-seat pool.** `score-stage` mails
   all of them. Find out who the fifth is before the command sends mail unattended.

5. **`breakaway` is always false unless set by hand.** There is no reliable escape
   marker in the feed, and inferring one from a time gap is how a GC attack gets
   mislabelled a fuga. On a genuine breakaway stage it needs setting deliberately.

6. **The positional-ambiguity audit is incomplete.** Done: The Numbers panel, the
   palmares cards, and every `ordinal()` call site. NOT audited: callout tiles,
   standings tables and the See Placement toggle, Today's Order, the draft tilt
   strip, the trend chart, the rider value bars, the Arlequin bars and per-seat
   cards, Hall of Shame, Stage Winners Drafted, the Rider Value Leaderboard, Full
   Results. The ambiguity there is bar ordering and implicit ranking, which a grep
   for `ordinal(` does not catch. The rule is in CLAUDE.md.

7. **Phase 4 monitors.** Never started. Specced: break feed race label matches the
   configured race, deployed Worker matches repo source, the deployed Firestore
   ruleset matches `firestore.rules` in the repo, standings from stage docs match
   what the board renders, the scale constant appears once per board, no
   wrong-race strings in the active board.

8. **The persona ledger rule is PUBLISHED.** CLOSED 2026-08-27, ruleset `403efc66`
   at 20:54:38Z. Persistence is live for all four seats, not just the owner session.
   The published rule is the SHORT form and omits the shape checks the CLAUDE.md draft
   carried, so nothing constrains what `personaLedger` may contain. Restoring those
   four lines is a repo edit plus `firebase deploy --only firestore:rules`.

9. **The Tour pool has no `boardConfig.predictionsThroughStage`.** Since the deadline
   now fails CLOSED, its jersey predictions will never auto-reveal until one is set.

## Two process lessons that cost real time here

**CRLF.** `vuelta.src.html` and `CLAUDE.md` are stored with CRLF and carry exactly 19
bare LFs. Writing LF rewrites all 5000+ lines and buries the real diff. Every patch
script in this session converts line endings and asserts the bare-LF count is still
19 before writing. Do the same. A 10,000-line diff means the conversion was missed,
not that the change was large.

**Present is not legible.** The palmares cards carried board-name labels in the DOM
the whole time and still read as two bare positions, because they were 9.5px
uppercase grey between two bolder elements. Reading the markup is not the same as
looking at the render. Same class of error as the CLAUDE.md rule about images: a 200
is not evidence the picture is right.

For anything visual, render it and look. The SVG emblems were checked by rasterising
with `@resvg/resvg-js`, circle-masking at the real avatar sizes, and tiling contact
sheets. Four of 29 were redrawn only because of what that showed, and two of those
passed every structural test while being visually useless.

## Verification habits worth keeping

Compute against ground truth wherever it exists. The Phase 0 acceptance ran against
Stage 4, already closed, so the result could be diffed field by field against what
was stored rather than merely produced. The archetype and datapoint work extracted
the SHIPPED blocks from the built board and ran them on live pool state, which is how
a stale hardcoded expectation surfaced.

Derive test expectations from the same live data rather than typing them. A hardcoded
Arlequin count of 8 went stale the moment Stage 5 scored, and chasing that failure is
what exposed a datapoint claim that had quietly expired.
