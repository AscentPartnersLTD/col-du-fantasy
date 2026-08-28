# The nationality side game: generalization report

Written 2026-08-28. This is the report CLAUDE.md points at from "Curated rosters are a
copy hazard, so compute them". It is a DESIGN report. Nothing in it is built.

The rules it has to satisfy live in CLAUDE.md under "The nationality side game is ONE
game per race, never two". This file carries the working, the measured numbers, and the
decisions Allen made on 2026-08-28.

## What the game is

One game whose nationality changes per race. The Tour de France features Americans, as
Captain 'Merica, awarding shields. The Vuelta a Espana features Belgians, as
Kasseistampers, awarding cobbles. The Giro will feature its own. They are not two games
that coexist. A board runs exactly one.

The country is FIXED FOR A WHOLE RACE, never per stage. The season prize is a jersey for
most awards across the race, and that cannot survive the nationality moving mid-race.

## The profile block

Everything race-specific becomes data:

    nationalityGame: {
      country:      'BEL',
      countryName:  'Belgium',
      demonym:      'Belgian',
      gameName:     'Kasseistampers',
      awardOne:     'cobble',
      awardMany:    'cobbles',
      emblem:       '/emblem-belgium.png',
      jerseyFront:  '/jersey-kasseistampers-front.jpg',
      jerseyBack:   '/jersey-kasseistampers-back.jpg',
      seasonJersey: 'Koning der Kasseistampers',
      accent:       '#EF3340',
      picks:        2
    }

The Tour's is the same shape: USA, Captain 'Merica, shield and shields,
`/emblem-captain.png`, `/jersey-merica.jpg`, accent `#B22234`, `picks: 1`.

Two of those fields were questioned and both were confirmed by Allen on 2026-08-28, so
the reasoning is recorded rather than left to be re-argued.

`accent`, because the Kasseistampers skin hardcodes `#EF3340` in fourteen CSS rules and
the shared `.mer-` base hardcodes `#B22234` in nine. A Giro skin would be a fifteenth
copy. This is the Fantasy Points scale mistake queued up to happen a third time, and the
answer is the same one: ONE declaration, read everywhere.

`picks`, because the two games already differ mechanically and the difference is
genuinely per-race. Captain 'Merica takes ONE pick. Kasseistampers takes a first choice
plus a tiebreaker, because Allen changed the rule mid-Vuelta to stop all four seats
auto-picking van Aert. That is a race-level rule. It must be data, not implicit in two
render functions that have quietly diverged.

## The rider list must be computed, not curated

DECISION: bake nationality into `RIDERS` at build time from the official feed. Option
(a) of the two considered. Allen leaned this way and the analysis agreed.

The decisive reason is not resilience, it is that the game must never disagree with
`RIDERS`. `RIDERS` is the bib table, and a pick is scored by resolving name to bib. If
the nationality roster is fetched at runtime and the feed returns a name spelling that
`RIDERS` does not carry, the pick either fails to resolve or resolves to the wrong bib,
silently, which is the failure recorded under "The startlist is scored by BIB". Seven
rows already differ in spelling between our table and the feed (Fisher-Black,
Paret-Peintre, Renard-Haquin, Dunbar, Schultz, Warbasse, Mulubrhan), plus around forty
short Spanish surnames. Resolving at runtime reintroduces that mismatch on every page
load. Resolving at build time settles it once, where it can be asserted and where a
failure blocks a push instead of losing a side game on race day.

Supporting reasons: the game keeps working when the feed is slow or down, which matters
because the roster loader already fails soft and a nationality game that silently
empties is worse than one that is simply present; the eligible-country list becomes
computable at build time, so the operator picks from a real menu instead of typing a
country code and hoping; and it costs one field, `q`, on 184 rows, roughly 1.5 KB.

What option (a) does not give you is the nationality changing mid-race. By the design
constraint above, that is not a thing that happens.

It does NOT replace the roster call. Who is IN the race comes from `RIDERS` plus `q`.
Who is STILL in it comes from `/roster`. Those stay separate, exactly as they are now.

## Eligibility

Any country with FOUR OR MORE riders in the field is selectable. Judged ONCE, on the
startlist at race start, and never recomputed during the race. A season jersey must not
become uncontestable halfway through because somebody abandoned.

Show the ACTIVE count on the card alongside it, so a shrinking pool is visible. Belgium
is already 18 in the field and 17 active.

FAILURE MODE TO DESIGN FOR, rather than discover later: a country eligible at launch
dropping below four active mid-race. It does not happen to Belgium here, but Austria
sits at exactly 4 and is one abandon from 3, and Switzerland went 6 to 3 across the full
207-row feed. When it happens the game must keep running with two riders left and simply
say so. It must NOT switch country, must NOT disable itself, and must NOT stop painting
the card. A card that disappears is the exact failure the 2026-08-28 session was about.

## The real menu for the 2026 Vuelta

Measured 2026-08-28: the board's own 184-rider startlist joined by bib to
`racecenter.lavuelta.es/api/allCompetitors-2026`, with active counts from
`col-break/roster?stage=7&race=vuelta`. All 184 bibs matched the feed with zero misses,
so the 2026-08-27 startlist audit still holds.

| Country | In field | Active | Eligible at 4+ |
|---|---|---|---|
| ESP | 30 | 29 | yes |
| FRA | 23 | 23 | yes |
| BEL | 18 | 17 | yes, current |
| ITA | 13 | 13 | yes |
| GBR | 12 | 11 | yes |
| AUS | 12 | 12 | yes |
| NED | 9 | 8 | yes |
| DEN | 8 | 8 | yes |
| SLO | 7 | 7 | yes |
| NOR | 7 | 7 | yes |
| GER | 7 | 7 | yes |
| USA | 5 | 5 | yes |
| COL | 5 | 5 | yes |
| AUT | 4 | 4 | yes, exactly on the line |
| NZL | 3 | 3 | no |
| LUX | 3 | 2 | no |
| SUI | 3 | 3 | no |

Below that: POR, IRL and KAZ at 2 each; CAN, CZE, ECU, ERI, GUA, HUN, MEX, MON and VEN
at 1 each.

Fourteen countries qualify. The notable ones are at the bottom, not the top:

- AUT qualifies at exactly 4, all four active: Gall, Muhlberger, Gogl, Konrad. One
  abandon takes it under.
- USA qualifies at 5 on this race, so the two games COULD have coexisted here
  legitimately. That is not an argument for it. The Vuelta card was disqualified by the
  design, not by the field.
- COL qualifies at 5: Tejada, Sosa, Martinez, J. Rodriguez, Buitrago.
- SUI misses at 3. Kung, Weiss, Thalmann. Tudor is a Swiss team fielding mostly
  non-Swiss riders here.
- NZL misses at 3, one of whom is Finn Fisher-Black.
- DEN at 8 is the strongest small nation and includes Pedersen, Skjelmose and Cort.

## Bios degrade, they never gate

DECISION by Allen, 2026-08-28: bio-less cards ARE acceptable. The operator can pick any
qualifying country immediately, with initials avatars and no blurbs. Bios are a
nice-to-have written when someone feels like it, never a gate on the feature.

This matters because bios are the one part that does not generalize. `BELGIAN_RIDERS`
carries a hand-written blurb and a repo-hosted photo per rider, each with a `/* src: */`
citation. Nationality is computable; bios are not, and inventing either the blurb or the
citation would break the never-invent rule.

So a missing bio degrades to the initials avatar. It never blocks a pick and never
blanks the card. The initials fallback already exists and is already preferred over a
photo that does not show the rider, per "Harvesting images".

## Open, and deliberately not done

`USA_RIDERS` on the Vuelta board still holds the Tour's list. It is dormant, since
`sideGameOn('merica')` is false, and it was NOT hand-corrected to the five real
Americans, because the fix Allen wants is this generalization and not a second curated
list for a game this race does not play. Tracked in CLAUDE.md Open items.
