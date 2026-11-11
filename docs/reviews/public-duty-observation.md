# Public duty observation review

Independent synthetic review of public-duty receive/inspect boundaries. No runtime saves, credentials, browser/model calls, install, commit, or push were used.

## Findings

1. Kitchen receive targets the physical table but only checks/claims the kitchen work key. A different active table claim does not prevent receiving. Preserve the kitchen group while also checking and claiming the actual table, including on later work ticks and final completion.
2. Inspection currently targets the service seat itself and claims a separate inspection key. It can overlap another service or bed user. Preferred correction: use a fixed adjacent, geometrically reachable point with direct view of the service point; do not query hidden occupancy to decide whether a distant inspection opportunity appears. Preserve existing bed permissions.
3. During service, moving a client to another valid room coordinate can trigger movement back to the service point rather than rejecting loss of position. The primary worker is covering this with a clientId-held position invariant and its own test.

## Independent regression coverage

`tests/public-duty-observation-review.test.ts` adds 13 assertions. Initial result: 10 passed, 3 failed (the table claim and both inspection-position cases). All fixtures are synthetic; helpers originate from the primary synthetic fixture, assertions are independently written.

Passing checks: lazy movement definition reads do not mutate the world; provider coordinate loss prevents completion; missing client indoor origins do not invent entry coordinates; a newly obstructed target prevents service and stock consumption; two concurrent explicit funded requests consume exactly one public ration and wage, preserve total money, and leave private provider inventory untouched. Foreign-trade initialization is performed before the money snapshot to exclude normal one-time trader capitalization.

Run: `node --import tsx --test tests/public-duty-observation-review.test.ts`.

This report records the review baseline while the primary worker is applying corrections. Rerun the tests against final changes before claiming completion.

## Verification after correction

Reran against the primary worker's second revision: **13/13 passed**. Inspection now uses adjacent visible standing points; kitchen receive checks its physical table as well as its kitchen group. The independent suite found no remaining failure in these covered cases.

## Final independent follow-up

Added explicit `PublicShift` typing to the synthetic shift fixture, resolving the inferred-null `clientId` TypeScript errors. Added kitchen/care regressions for stale receive submission after sight/route loss, asserting rejection leaves the entire world unchanged. Added working-client displacement and missing-coordinate regressions, asserting failure on the first subsequent tick with no automatic movement back, no material consumption, and no payment.

Final verification: **17/17 passed** with `node --import tsx --test tests/public-duty-observation-review.test.ts`; repository `./node_modules/.bin/tsc --noEmit` completed successfully (exit 0).

## SQLite underway-path follow-up

Added kitchen and care cases that select the real final-menu receive, begin indoor travel, save and reload with `WorldStore(':memory:')`, then put a synthetic stored body on the restored path's next cell. Both verify a detour still exists but the stale saved route stops immediately at the original position without crossing, serving, taking materials, or changing provider money. Independent suite now passes **19/19**.

A completeness edge was identified and subsequently corrected by the primary worker: `dutyOpportunities` returns early when `w.duties` is absent, hiding even a legal known-address inspection. An initialized empty shift list does not have this problem. Normal formal-world advancement initializes duties, so this affects pre-initialization/legacy-state menus rather than material or visibility safety. Generic movement reaches only the doorway and does not fully replace interior inspection. The suggested minimal correction is to make the shift list optional while leaving known-place inspection independent; no production changes were made by this reviewer.


## Final boundary verification

The primary worker removed the duty-initialization dependency. New independent kitchen/care assertions verify that a hidden known address offers identical inspection labels/actions with and without duties state, while neither version offers receive.

The primary worker also accounts for the next-tick start when producing or submitting a receive action. New kitchen/care tests verify that only `travel + duration - 1` remaining minutes at the doorway are insufficient (both menu and cached submission reject); an already seated resident with exactly `duration` minutes remaining can select and complete the service exactly at the shift end.

Latest independent suite: **23/23 passed**. The earlier initialization completeness issue is resolved in the reviewed production version. No remaining failures were found in this review's covered boundaries.

## Age-routing verification

Added two parameterized kitchen/care regressions for ages 6, 10 and 17. Each follows the final menu from a hidden known address through inspection (no service or consumption), then a separate explicit receive that completes exactly one service. The age gate continues to reject claim, attend, stay, reschedule and withdraw; under-six inspection remains rejected. Treating inspection as a non-labor visit restores access to already-permitted public service rather than granting work permission.

Latest independent suite: **25/25 passed**.

## Final aggregate verification

The primary worker reran the final production snapshot after all follow-up corrections: **3395/3395 offline repository tests passed, with zero failures or skips**. Full TypeScript checking, server compilation and frontend build passed; frontend only reported the existing large-chunk advisory. No dependency installation, real save/credential reads, model/browser calls, commit or push occurred.
