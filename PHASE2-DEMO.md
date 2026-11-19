# Phase 2: the live-stage demo pools

PART OF THIS SHIPPED ON 2026-11-19, and the rest of the file is kept because the part
that did not ship is still the design for it.

WHAT SHIPPED: `tour-demo`, a copy of `sandbox` backfilled with col-du-fantasy stages 1
to 13, so the board reads as a real season through stage 17 with stage 18 open and one
pick in it. A guest holding a seat in `viewerSeats` appends picks to that pool's draft
and nothing else anywhere. The Reset button puts the stage back to the pick it opens on.

WHAT DID NOT, and the absence is now asserted by `tools-guest-access-test.js` rather
than left as a thing nobody got round to:

- the predictions grant, and the `predictionsLocked` flip, which the block below also
  designed. The brief was "drafts for their own seat only, and nothing else anywhere".
- `vuelta-demo`. One demo pool is enough to show the game, and a second is a second
  thing to keep in step.
- bots. The other three seats do not pick for themselves, so a guest makes their own
  picks and the draft then waits. That is deliberate in this version and is the obvious
  next piece.

THE DRAFT GRANT IS SEAT SCOPED, which this design said it could not cheaply be. The
trade below was accepted on the grounds that all four seats live in one `picks` array;
what makes the scoping cheap in the end is that A DRAFT ONLY EVER GROWS BY ONE PICK, so
the rule reads the pick that was just appended and insists it carries the caller's own
seat. The reset shape, a list of one pick or none, is allowed alongside it, because the
opening pick belongs to AA and a guest who could not write it could not reset the board
they are playing on. A guest can therefore put a different single pick at the top of a
throwaway copy, which is the residue of the trade and is written down rather than
discovered.

## Why it was left out, and how each reason was answered

Each of the three held until the week it shipped. 1 was answered by the pool existing,
so every refusal is now measured against it. 2 was answered by retiring that sentence in
`tools-rules-guard.js` and replacing it with five narrower ones. 3 happened: the
showroom went live on 2026-11-18 on its own.

Three reasons, in order of weight.

1. A write grant for a pool type that does not exist cannot be proved unreachable
   against live data, because there is no live data. Every other guest grant on this
   branch can: a viewer condition on a production pool is denied by `prodPool()` by
   name, and that is testable today.
2. `tools-rules-guard.js` asserts "not one allow-write clause mentions a viewer". That
   is a flat, checkable sentence to say before handing a link to a guest, and it stops
   being true the moment the demo grant lands.
3. The showroom goes live on its own. The demo does not block it.

`tools-guest-access-test.js` asserts the deferral rather than working around it: if a
viewer write clause appears in `firestore.rules` while that file still calls this phase
2, the suite fails.

## The rules block, as built and passed

Goes after `predsLocked()`. A demo seat comes from `viewerSeats` and NOT from `members`,
which is the whole point: `inPool()` stays false for a guest, so every member-gated
statement stays dead for them, and the guest never appears in a map that is email to
seat.

```
    function isDemoPool(poolId)  { return !prodPool(poolId) && poolExists(poolId)
      && ('demo' in poolCfg(poolId)) && poolCfg(poolId).demo == true; }
    function hasDemoSeat(poolId) { return isDemoPool(poolId)
      && ('viewerSeats' in poolCfg(poolId)) && (em() in poolCfg(poolId).viewerSeats); }
    function demoSeat(poolId)    { return poolCfg(poolId).viewerSeats[em()]; }
    function allFourPreds(poolId) {
      return exists(/databases/$(database)/documents/pools/$(poolId)/predictions/JJ)
        && exists(/databases/$(database)/documents/pools/$(poolId)/predictions/JB)
        && exists(/databases/$(database)/documents/pools/$(poolId)/predictions/JP)
        && exists(/databases/$(database)/documents/pools/$(poolId)/predictions/AA);
    }
```

The `('demo' in ...)` guard is not decoration. Without it a pool carrying no `demo`
field made this an EVALUATION ERROR rather than a false. It denied either way, but an
error that happens to deny is not the same claim as a rule that denies, and the next
error at that line would be indistinguishable from this one.

Added inside `match /pools/{poolId}`, AFTER the existing statements, because Firestore
stops at the first granting statement:

```
      allow update: if viewerOf(poolId) && hasDemoSeat(poolId)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['predictionsLocked'])
        && request.resource.data.predictionsLocked == true && allFourPreds(poolId);
      match /drafts/{stage} {
        allow write: if viewerOf(poolId) && hasDemoSeat(poolId);
      }
      match /predictions/{seat} {
        allow read:  if viewerOf(poolId) && hasDemoSeat(poolId) && demoSeat(poolId) == seat;
        allow write: if viewerOf(poolId) && hasDemoSeat(poolId) && demoSeat(poolId) == seat
          && !predsLocked(poolId);
      }
```

`viewerOf()` already requires `showroom == true`, so a demo pool must carry BOTH flags,
or `showroomPool()` has to be widened to accept either. Decide that before writing the
block: carrying both is the smaller change and keeps one read path.

### The accepted trade, stated rather than discovered later

A draft document holds all four seats in one `picks` array, so a rule cannot cheaply
scope a draft write to one seat. In a demo pool the other three seats are bots in a
throwaway copy, so this is an accepted trade, the same shape as the `personaLedger`
rule accepting cross-seat writes in a four person pool. It grants nothing in a showroom,
which has no demo flag.

## The checks that went with it, all passing before removal

Against `tour-demo` and `vuelta-demo` as a guest with `viewerSeats[guest] = 'AA'`:

- reads the pool doc, the stages, and the draft
- WRITES the draft; denied once `viewerSeats` is removed and denied again once the
  `demo` flag is removed with the seat left in place
- writes AA predictions; denied for JJ, JB and JP
- reads AA predictions before the lock; denied for every other seat before the lock
- fires `predictionsLocked` when all four seat documents exist; refused with three
- cannot set `predictionsLocked` false
- cannot write a stage, the `personaLedger`, an arbitrary pool field, or engagement
- an expired or malformed invitation writes nothing at all

## Still open for Phase 2

- BOTS. The other three seats do not pick for themselves, so the draft stops after the
  guest's turn. This is the piece that turns a demo into a game.
- The demo opens on stage 18 and not stage 13, which this file proposed. Stage 18 is
  where the sandbox already sat, with AA's opening pick already made and JB on the
  clock, so the board is playable on the first tap rather than after three bot turns
  that do not exist yet.
- The Tour pool drafts TEAMS, not riders. Stage 1 picks read "Lidl-Trek", "Ineos",
  "UAE Team Emirates", "Visma-Lease a Bike" plus "Missed 2nd (penalty)". Bots
  reproducing real picks have to honour that.
- The break widget needs a feed answering `{live, groups, finished}`. Probe the official
  feed for 15 minutes, then reconstruct from the stage result. Label it "Replay of
  Stage N" and never present it as live.
- Every `boardConfig` write passes `pools` explicitly. Never call `/api/board-config`
  without it.
