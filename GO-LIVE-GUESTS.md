# GO LIVE: the guest showroom

For after Granada. Nothing here is deployed. Work top to bottom; **every step has a
read-back, and a step is not done until its read-back says so.** A write that returned
without throwing is not the same claim as a write that landed.

Stop at the first read-back that disagrees and say what it said.

---

## 0. Before you start

```
cd C:\Users\bogie\cdf-guest
node tools-rules-tests/run.js
```

and the second suite, which reproduces the live membership shapes rather than a clean
fixture, and pairs every grant with a proof it denies when the grant is removed:

```
node_modules/.bin/firebase emulators:exec --only firestore "node tools-guest-access-test.js"
```

**Read-back:** `149 checks, 149 passed, 0 failed`.

and the two static gates, which take a second each:

```
node tools-rules-guard.js
```

```
node tools-guest-verify.js
```

**Read-back:** `25/25 invariants hold` and `66/66 checks passed`.

**Read-back:** `108/108 rules assertions passed` and `19/19 showroom-copy assertions
passed`, exit 0. If the emulator says port 8080 is taken, a previous run is still up:
kill the `java` process on 8080 and re-run.

---

## 1. Merge `guest-access` to main, and keep your race-tab work

You have uncommitted work on `main` in `C:\Users\bogie\col-du-fantasy` (the race-state
tab, roughly 476 lines across `vuelta.src.html` and `vuelta.html`, plus an untracked
`ltgp-pitch/`). **It must be neither lost nor swept into this merge.**

The guest branch also touches `vuelta.src.html`, so a merge with your changes sitting in
the tree is exactly the "edited a stale source file" shape CLAUDE.md records under the
pool-routing regression. Park it on its own branch first. That is reversible, visible in
`git log`, and nothing like a stash you later forget.

```
cd C:\Users\bogie\col-du-fantasy
git checkout -b race-tab-wip
git add vuelta.src.html vuelta.html
git commit -m "WIP: race-state tab, parked before the guest merge"
```

**Read-back:**

```
git log --oneline -1 race-tab-wip
git status --short
```

Expect your WIP commit, and a clean tree apart from `ltgp-pitch/` which stays untracked.

Now the merge:

```
git checkout main
git merge guest-access --no-edit
```

If `vuelta.html` conflicts, **do not hand-merge it.** It is a built file. Take the merged
source and rebuild:

```
py -3 -c "import datetime;s=open('vuelta.src.html',encoding='utf-8').read();st='<!-- build:'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%SZ')+' -->';open('vuelta.html','w',encoding='utf-8').write(s.replace('{{DEFAULT_POOL}}','vuelta-2026').replace('{{BUILD_STAMP}}',st))"
py -3 build_boards.py
git add vuelta.html vuelta.src.html tour.html index.html board.html tour-staging.html
git commit --no-edit
```

**Read-back, before pushing:**

```
node tools-validate-build.js
node tools-guest-verify.js
node tools-rules-guard.js
py -3 -c "s=open('vuelta.html',encoding='utf-8').read();print('POOL_PAGE',s.count('POOL_PAGE'),'legacy routes',s.count('/board.html?pool='),'dashes',s.count(chr(0x2013))+s.count(chr(0x2014)))"
```

Expect 16/16, 34/34, 25/25, and `POOL_PAGE 4 legacy routes 0 dashes 0`.

```
git push origin main
```

**Read-back:** wait one to two minutes, then in a browser on the live board:

```
fetch('/vuelta.html?cb='+Math.random()).then(r=>r.text()).then(t=>console.log(
  (t.match(/<!-- build:([^ ]+) -->/)||[])[1], t.includes('guestPill')))
```

Expect the stamp you just built and `true`. The CDN serves the old file for a while, so
do not trust the first check.

**Your race-tab work is on `race-tab-wip`.** Rebase it onto the merged main when you want
it back: `git checkout race-tab-wip && git rebase main`.

---

## 2. Deploy the rules

```
cd C:\Users\bogie\col-du-fantasy
firebase deploy --only firestore:rules
```

This needs your own Firebase login as `allen@ascentpartnersltd.com`. If it asks you to
log in, CLAUDE.md has the `--no-localhost` procedure and the libuv crash to expect.

**The Firebase CLI is not installed globally on Dragon and is not logged in there.**
`cdf-guest` has a local copy at `node_modules/.bin/firebase`, used by the test suites,
and `firebase login:list` on it says `No authorized accounts`. So either log that one in:

```
cd C:\Users\bogie\cdf-guest
node_modules\.bin\firebase login
node_modules\.bin\firebase deploy --only firestore:rules --project col-du-fantasy
```

or run the deploy from Gerald, which has done it before. Either way it is one sign-in,
and it is the only step in this runbook that cannot be done from a board tab.

**Read-back 1, the ruleset itself.** Read the live rules back and compare them with the
repo copy, per CLAUDE.md: never trust the console, and never trust that the deploy
printed success.

**Read-back 2, the people.** This is the one that matters, and it is why the rules go out
before any guest exists.

- **A named Grand Tour player** opens their board and confirms the standings, the stage
  ledger and the locked draft strip all render, and that the draft card behaves normally.
- **Someone in each other pool** does the same on theirs. **Lowry City Rollers
  specifically**: its members are not on the legacy `config/roster`, and that is exactly
  the group the rules were nearly tightened against. Ask them to sign out and back in, so
  the sign-in path runs, not just a warm session.

If anybody reports "You are not in a pool yet", stop and say so. That is the lockout
signature, and the fix is in `firestore.rules` at the `userPools` write.

---

## 3. Build the showrooms

The copy tool reads production and writes the two copies. Production is only ever read.

**There are two ways to run it. Use the first one.**

### 3a. The console snippet, which needs nothing installed

```
cd C:\Users\bogie\col-du-fantasy
node tools/showroom-copy.js --emit
```

This writes nothing and talks to nothing. It prints a snippet to paste into a signed-in
**owner** board console, which already holds the one credential that can do this:
`allow write: if owner()` on `pools/{poolId}`. Same shape as `close-stage.js --emit` and
`guest-add.js`.

It is **dry run first**: `APPLY = false` at the top. Paste it, read what it says it would
do, then set `APPLY = true` and paste it again.

**Why this is the default route now:** the token route below wants
`gcloud auth print-access-token`, and **gcloud is not installed on Dragon**. That made
this step impossible on the machine the rest of the work happens on. The snippet uses the
session you are already in.

The snippet carries the **same scrub**, spliced out of the tool rather than rewritten, so
the two cannot drift. `tools-guest-verify.js` parses the emitted snippet and asserts the
splice is still there.

**Read-back, dry run:** one line per pair, a document count per subcollection, how many
values were scrubbed, and `DRY RUN: would write n document(s). Nothing was written.`
**If it prints `REFUSED`, stop and read the line.** A refusal means an address survived
the scrub and that document was not copied.

**Read-back, apply:** `WROTE n document(s)` with the same `n`, then a printed summary per
showroom: `showroom: true`, `members: 0`, `memberEmails: "dropped"`, the seat order, and
the stage and draft counts. `members: 0` is not cosmetic. Anything in that map is a key
that could match a caller, and membership is what grants a draft write.

### 3b. The token route, if gcloud is ever installed

```
cd C:\Users\bogie\col-du-fantasy
$env:CDF_ADMIN_TOKEN = (gcloud auth print-access-token)
powershell -c "if($env:CDF_ADMIN_TOKEN){'token set, '+$env:CDF_ADMIN_TOKEN.Length+' chars'}else{'NOT SET'}"
```

**Dry run first. This writes nothing.**

```
node tools/showroom-copy.js
```

**Read-back:** it prints `DRY RUN   production`, both pairs, a document count per
subcollection, how many values it scrubbed, and ends `WOULD WRITE n document(s)` with
`Nothing was written.` **If it prints `REFUSED`, stop and read the line.** A refusal means
an address survived the scrub and that document was not copied.

Then:

```
node tools/showroom-copy.js --apply
```

**Read-back:** `WROTE n document(s)`, with the same `n` the dry run predicted. Then
confirm no address reached the copy, in a signed-in owner board console:

```
for (const p of ['tour-showroom','vuelta-showroom']) {
  const d = (await db.doc('pools/'+p).get()).data();
  console.log(p, 'showroom:', d.showroom, 'members:', Object.keys(d.members||{}),
              'viewers:', Object.keys(d.viewers||{}));
}
```

Expect `showroom: true`, members keyed only on `@showroom.invalid`, and **viewers empty**.
Inviting is a separate, deliberate act.

---

## 4. Unhold the login repo

The guest allowlist lives in `coldufantasy-login`, in `api/auth/[action].js`.

**A change IS needed, and it is already written and committed on branch `guest-access`
in that repo. It is NOT pushed.**

`isMember(email)` returned true for any address with a non-empty `userPools/{email}`,
which is exactly what `guest-add.js` writes, so a guest could already get a sign-in code
with no change at all. That is how it was left, and it was wrong.

**An invitation expires. `userPools` does not.** The expiry lives in the showroom pool's
`viewers` map; `userPools` is only a hint for the pool switcher and grants nothing. So a
lapsed guest would keep getting a code, sign in, have every read refused by
`firestore.rules`, and land on "You are not in a pool yet."

Not a security hole. The rules are the boundary and were already denying them. It is the
wrong **answer**: an expired guest must get the same silent nothing as anyone off the
roster, and must get it before an email is sent.

The fix resolves `userPools` rather than trusting it. Each pool it names is opened, and
the address qualifies if it is a **member** of that pool (every player, unchanged) or a
**live viewer** of it. A non-timestamp expiry is refused there exactly as the rule
refuses it, so the two cannot drift. The two named-pool fallbacks stay for a member whose
`userPools` entry was never written.

```
cd C:\Users\bogie\coldufantasy-login
git log --oneline -1 guest-access
git diff main..guest-access -- "api/auth/[action].js"
```

Read the diff, then push it. **Vercel deploys this repo from git**, confirmed by polling
production until the route changed, which took about forty seconds.

```
git checkout main && git merge --ff-only guest-access && git push
```

**Read-back, the one that matters: a PLAYER must still be able to sign in.** This touches
the allowlist every player goes through. Have a Grand Tour player and a Lowry City Rollers
member each sign out and request a code, before any guest is invited.

**Read-back:** with a test address that has a `userPools` entry, request a code and
confirm one arrives. The endpoint always answers 204 so it never leaks membership, which
means **the email arriving is the only proof**, not the HTTP status.

---

## 5. End to end, with the test address, before any real guest

**The test guest is `info@ascentpartnersltd.com`, and the reason is not arbitrary: it is
an address that is in NO pool's `members` map.** That matters more than it looks.

A member can write `pools/{poolId}/drafts`. If the test address is also somebody's seat
anywhere, it holds the member grant AND the viewer grant at once, and a test that passes
proves nothing about what a guest can do: it proves what a member can do. Your personal
Gmail is a member of all four pools, so it cannot be the test guest.

`info@ascentpartnersltd.com` also shares a domain with the owner address, and the rules
compare the owner EXACTLY. The emulator suite proves another address on that domain gets
no owner rights, so this run is the live confirmation of the same thing.

`guest-add.js` enforces this rather than trusting it: the snippet it prints reads every
pool's members map before writing anything, and refuses outright if the address is a
member of any of them.

```
cd C:\Users\bogie\col-du-fantasy
node tools/guest-add.js info@ascentpartnersltd.com "Test Guest" 2027-01-31
```

Paste the printed snippet into a signed-in **owner** board console. It is **dry run
first**: it reads, prints what it would do, and writes nothing until you set
`APPLY = true` and run it again. The second run prints its own read-back; expect a
timestamp for that address on both showrooms.

Then, **in a browser where you are not signed in as yourself** (a private window is
enough, since the session cookie is per-browser):

1. Open `https://coldufantasy.com/vuelta.html?pool=vuelta-showroom`, sign in with the
   emailed code.
   **Read-back:** the board loads and a **Guest view** pill shows under the masthead.
2. Confirm the viewer experience is whole: play the anthem, switch tabs, toggle See
   Placement, open panels, expand a rider, read a stage.
   **Read-back:** all work. A viewer who cannot change a chart type is a locked screen.
3. Confirm the game is closed. In that guest's console:
   ```
   await db.doc('pools/vuelta-showroom').update({name:'x'}).then(()=>'WROTE - WRONG').catch(e=>'refused: '+e.code)
   await db.doc('pools/vuelta-showroom/stages/21').set({win:'x'}).then(()=>'WROTE - WRONG').catch(e=>'refused: '+e.code)
   ```
   **Read-back:** both `refused: permission-denied`.
4. Confirm production is refused:
   ```
   for (const p of ['col-du-fantasy','vuelta-2026'])
     console.log(p, await db.doc('pools/'+p).get().then(()=>'READ - WRONG').catch(e=>'refused: '+e.code));
   ```
   **Read-back:** both refused.
5. Switch boards through the account menu.
   **Read-back:** it moves between the two showrooms and offers neither production pool.
6. Open a bare `https://coldufantasy.com/vuelta.html` as that guest.
   **Read-back:** it reroutes to the showroom rather than showing the roster error.

Then revoke and prove revocation works:

```
node tools/guest-remove.js info@ascentpartnersltd.com
```

Paste it, run the dry run, then set `APPLY = true` and run it again. Reload the guest's
board. **Read-back:** refused.

---

## 6. The real guests

One at a time, each with an expiry date you choose:

```
node tools/guest-add.js <address> "<Name>" <YYYY-MM-DD>
```

Paste each snippet into an owner console, run the dry run, then set `APPLY = true` and
run it again. Check its read-back before doing the next one.

If a snippet refuses with "is already a MEMBER of", that address belongs to a player.
Do not work around it: pick another address. A guest who is also a member can write a
draft, which is the one thing this whole design exists to prevent.

**Read-back, all of them at once:**

```
for (const p of ['tour-showroom','vuelta-showroom']) {
  const v = (await db.doc('pools/'+p).get()).data().viewers || {};
  console.log(p, Object.entries(v).map(([e,t]) => e.slice(0,2)+'***  until '+
    (t.toDate ? t.toDate().toISOString().slice(0,10) : t)));
}
```

Expect one line per guest with a future date.

**Send them:**

- `https://coldufantasy.com/vuelta.html?pool=vuelta-showroom`
- `https://coldufantasy.com/tour.html?pool=tour-showroom`

**To remove one:** `node tools/guest-remove.js <address>`, paste, and confirm
their key is gone from both maps. Access stops on their next request; the rule reads the
map, so removing the key is the whole revocation. Expiry does the same thing on its own
if you forget.

---

## What is NOT in this runbook

- **Phase 2 demo pools** (`tour-demo`, `vuelta-demo`). Separate work, separate go-live.
- **Deleting a showroom.** To rebuild one, re-run `tools/showroom-copy.js --apply`: it
  overwrites the documents it writes. It does not delete documents that no longer exist
  in production, so a stale stage would linger. If that matters, delete the copy first.
