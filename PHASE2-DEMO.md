# Phase 2: the live-stage demo pools

Nothing in this file ships. It is the design for `tour-demo` and `vuelta-demo`, built
and proved against the Firestore emulator and then deliberately left out of the shipped
ruleset. Phase 1 finishes the READ-ONLY showroom; this is what Phase 2 picks up.

## Why it was left out

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

- Demo stage: Tour stage 13, Dole to Belfort (Allen's call, 2026-11-13). Vuelta stage 13,
  Almunecar to Loja, the biggest Fantasy Points swing on a breakaway stage at 78.
- The Tour pool drafts TEAMS, not riders. Stage 1 picks read "Lidl-Trek", "Ineos",
  "UAE Team Emirates", "Visma-Lease a Bike" plus "Missed 2nd (penalty)". Bots
  reproducing real picks have to honour that.
- The break widget needs a feed answering `{live, groups, finished}`. Probe the official
  feed for 15 minutes, then reconstruct from the stage result. Label it "Replay of
  Stage N" and never present it as live.
- Every `boardConfig` write passes `pools` explicitly. Never call `/api/board-config`
  without it.
