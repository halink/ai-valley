# Shared room exit boundary review

## Scope and conclusion

Independent review of the shared physical exit changes and pickup callers in rooms, engine, bodies, medical transport, family relocation, and industry. No production source was changed by this reviewer. The examined implementation resolves the reproduced blocked-exit teleport and puts initial pickup validation before material and participant mutations. No new blocking defect was found in the reviewed paths.

## Reproduction and verification

The independent suite is `tests/room-exit-boundaries-review.test.ts`.

- Original four-test run: three failures and one passing compatibility case. `output/room-exit-boundaries-review/expanded-initial.log` preserves this result. Body, normal medical, and animal pickup incorrectly succeeded despite an unrelated stored body blocking the exit.
- After the fix, those four cases pass.
- Added family escort and safe-ground pickup tests verify that a valid initial arrangement becomes rejected after an exit blocker is introduced, without participant, material, event, phase, or agreement changes.
- Added same-room medical delivery confirms that a blocked exterior exit does not prevent a legitimate interior transfer or suppress its normal single cloth/water charge.
- Combined independent, existing family-relocation, and existing safe-ground suites: **49 passed, 0 failed**, recorded in `output/room-exit-boundaries-review/compatibility.log`.

The earlier parent boundary suite plus this independent suite passed **24/24** (`shared-final.log`). After adding legacy exit reconstruction and immediate decline cases, the final combined result is **26/26**, recorded in `output/room-exit-boundaries/green-final.tap`. The final caller preflight change was independently rerun with **7/7** passing in `output/room-exit-boundaries-review/final-preflight-review.log`. TypeScript `tsc --noEmit` exited 0 (`typecheck.log`), and `git diff --check` passed.

The family and safe-ground cases can also be rejected by their existing action-specific validators. They verify the public completion contract, but are not claimed as independent red-to-green evidence for the newly added physical-exit helper. The original three failing cases supply that evidence.

## Design checks

1. `roomExitPlan` distinguishes null paths from zero-length successful paths and validates actual source coordinates and entry clearance independently of `roomPath`, which otherwise accepts a blocked origin or zero-length blocked endpoint.
2. `prepareRoomExit` retains no-exit early returns. This avoids applying exit requirements to waiting, eating, unilateral decisions, and legitimate same-building work. The same-room medical regression test checks this specifically.
3. Engine startup checks exit feasibility before body reservation, but commits exit state after successful reservation. A reservation failure therefore cannot move a resident outside first.
4. Body pickup uses a shallow candidate world that removes only the legally selected body's obstruction. This permits picking up the sole body blocking an exit without ignoring other bodies. The positive test verifies a one-cell real exit journey, not teleportation.
5. Normal medical and safe-ground pickup check before inventory debits, serial allocation, transport creation, patient plan cancellation, and participant movement. Family and animal callers check before escort/carrier and delivery state changes.
6. Existing exit journeys validate identity, live door coordinates, entry target, integer clear positions, next-edge adjacency, and endpoint before clearing `inside`. Legacy activities without an exit journey reconstruct one rather than letting outdoor movement silently erase indoor position.
7. The final `|| path.length` addition in body, medical, family, and animal pickup preconditions correctly validates malformed same-building states with an outdoor path before committing side effects. It does not require an exit for legitimate same-building transfers with an empty outdoor path.
8. Preflight and actual prepare calls are synchronous. The reviewed intervening mutations do not introduce a new room obstacle; the body-specific candidate explicitly accounts for removal of its obstacle.

## Limits and residual coverage

- This independent suite does not separately exercise same-room body storage, same-room animal placement, or family `returnChild`; their conditional no-exit logic was inspected, not independently driven here.
- Ferry-release/refund ordering was inspected but not independently exercised here.
- Mid-journey shared-exit corruption, stale saved journeys, gift return, and generic stationary actions belong to the parent's dedicated boundary suite; this report does not substitute the 49 compatibility successes for those tests.
- The body pickup timer may reach zero before an exit failure. That records already-performed preparation time; the test protects body/storage/carry state and emitted completion facts, not a rollback of elapsed work.
- No real model, credentials, runtime saves, network publication, or push was used. All test worlds are synthetic; existing persistence tests use their isolated fixtures.

## Subsequent commit review

A second reviewer reran the original blocked-exit probe and all four tracked gift-return/exit-boundary files on the frozen final candidate: **43/43 passed**. A separate on-disk SQLite check closed and reopened the queued and in-flight return states, then closed and reopened the failed states again. Both stayed at the original indoor position with no automatic retry and zero model requests. Evidence is local under `output/personal-food-gift-return-commit-review/`, including `final-original-probe.log`, `final-focused.log`, `final-disk-exit.log`, and `final-focused-verification.json`.

That reviewer also independently drove four supplementary synthetic cases: same-room body storage, same-room animal placement, family `returnChild` reaching its original indoor bed despite a blocked exterior exit, and physically leaving a source room after source ownership/residency rights were revoked. **4/4 passed**, recorded in `same-room-compatibility-probe.second.log`. The initial `returnChild` fixture lacked the child's initial room permission and was rejected by the existing social-space validator; that first failed fixture run is retained in `same-room-compatibility-probe.log`, and was corrected by supplying a legitimate initial permission rather than weakening production validation. These output-only probes are supplementary, not additional tracked tests or a substitute for the final full suite. Ferry release/refund remains an inspected but not separately driven case in this review.
