# Medical destination safety review

Date: 2026-11-07

## Result

No blocking findings remain in the final reviewed integration. The original destination-safety findings and the subsequent registered-bed and test-type findings are resolved. This is an independent targeted review of the working tree, not a claim about the entire application or a clean repository baseline. Production and test files were read only; this review document is the only file written by the reviewer.

## Scope

Reviewed `src/world/building-safety.ts`, the medical appointment and transport integration in `health.ts` and `medical-transport.ts`, the hazard integration, health movement validation in `engine.ts`, medical opportunity filtering, and the guardian evacuation binding in `shared/health.ts` and `world/guardian-evacuation.ts`.

The checkout contains unrelated existing work. Nothing was reverted, committed, pushed, or run against a real save. Tests used local installed dependencies and synthetic worlds, including in-memory SQLite. No browser, network, model invocation, credentials, or package installation was used.

## Findings resolved

1. Remote active-footprint oracle: the initial implementation inferred a distant destination's live footprint from visibility of a flood origin. Destination hazard inspection now requires inspecting the destination itself or an authoritative physical check. The regression verifies that changing an unseen remote footprint does not change the menu, including when the origin is visible.
2. Early land pickup and delivery: actual activity identity, exhausted outdoor and room paths, and completed work are now required. Actual bed arrival alone cannot settle delivery early. A flood introduced before final delivery prevents settlement.
3. Multiple movement steps in one tick: the outdoor loop now synchronizes transport and validates health before each next step. The road-step regression confirms discovery after the first step prevents a second step.
4. Type errors: the hazard phase narrowing and reloaded test fixture building type errors are resolved. The current typecheck passes.

## Verified behavior

- Known unsafe medical destinations are rejected in menus, action start, travel, and actual delivery. A stale selection cannot spend pickup supplies or invent transport.
- Recorded flood footprints and legacy flood cores retain their respective geometry. Wind protection retains the condition-35 threshold. Outside a relevant hazard, condition values 1 and 34 remain compatible with medical use.
- A previously unknown hazard is discovered on approach without silently changing the chosen destination. Interruption retains actual carrier and passenger positions and does not emit a delivered event.
- Dynamic flooding survives in-memory SQLite reload and stops an active transport before another movement when the destination is observable.
- Appointment proposals, acceptance, attendance, payment, and refunds retain their separate consent and provider-use requirements. Doctor-owned clinic use does not grant another provider ownership or authorization. Unsafe cancellation refunds unused fees and materials only once.
- Guardian evacuation is limited to a current adult guardian and a child under six, with local observed danger and no refusal. The danger binding is preserved in the transport and must match the activity. The original threat is required before pickup; it need not remain active after pickup. Current guardian authority is still required during delivery.
- Weather remains disabled. Delivery does not manufacture a diagnosis or treatment.

## Executed validation

All commands used Node and already installed dependencies:

- `node --import tsx --test tests/medical-destination.test.ts tests/health.test.ts tests/ferry-rescue.test.ts tests/ferry-rescue-review.test.ts`: 52 passed, 0 failed.
- `node --import tsx --test tests/guardian-evacuation.test.ts`: 6 passed, 0 failed.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.

Additionally, four independent assertions reused the guardian test fixture through an in-memory transpilation, without writing test files:

- Ending the source danger after pickup still allows actual delivery.
- Removing the current guardian relationship after pickup, then advancing 32 minutes, interrupts at the original actual position.
- Flooding the receiving doorway after pickup, then advancing 32 minutes, interrupts at the original actual position.
- A normal 32-minute batch advance can continue through actual delivery.

The full test suite is intentionally left to the coordinating worker. These checks do not establish broader route safety for all medical transport. The later guardian-specific route integration is described below.


## Subsequent guardian route integration

The new `evacuationDangerId`-bound rescue applies the existing frontier retreat edge predicate to menu pickup reachability, child-to-destination reachability, actual pickup delivery routing, engine initial routing, and each actual movement edge. The per-edge predicate is refreshed during guardian evacuation movement. It permits leaving an existing danger but rejects entering another observed danger. Ordinary medical rescues without this binding retain their existing route behavior. This is a bounded guardian evacuation rule, not a comprehensive audit of every medical route.

The three new real-route regressions for additional observed flood warnings and storms passed. Existing destination, health, and ferry-rescue compatibility tests also passed in the expanded run.

The intermediate expanded run exposed registered-bed allocation failures: an absent registered resident's bed remained offered and could be occupied through actual evacuation. This is now fixed in `bedAvailable`: another living local resident with matching `homeId`, membership in `b.residents`, and that actual `residentBed` allocation reserves the bed even when physically absent. Existing lease and stay checks remain in place. The final regressions verify menu rejection, rejection of selected delivery, and revalidation of a newly allocated bed during transport.

The intermediate test-only type errors (`never[]` fixture inference and incomplete `AgencyState`) are also resolved.

### Final integration rerun

- `node --import tsx --test tests/medical-destination.test.ts tests/guardian-evacuation.test.ts tests/guardian-evacuation-review.test.ts tests/health.test.ts tests/ferry-rescue.test.ts tests/ferry-rescue-review.test.ts`: **75 passed, 0 failed**.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed**.

Final disposition: no remaining blocker in this targeted review. Ordinary medical and ferry-rescue compatibility remains green. The coordinator retains responsibility for the full-suite run.
