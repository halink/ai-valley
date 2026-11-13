> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Acceptance stop controls: independent offline review

Scope: optional `AcceptanceStopControl`, `ValleyRuntime` integration, and propagation of caller cancellation to model transport. This review does not authorize or execute a real model acceptance run. It uses synthetic price assessments, synthetic zero-cost replies, in-memory SQLite, mocked clocks, and blocked fetch. No credentials, existing saves, browser, npm, commit, or push were used.

## Findings and regression coverage

1. A successful reply could invoke the decision-evidence sink after its last lifecycle check, then apply the plan even when that sink stopped the run or failed. The implementer added another lifecycle/evidence check before plan application. Independent throw and signal-abort regressions verify zero applied plans.
2. Price-assessment callbacks can reenter admission. An outer reservation must not exceed the request ceiling after an inner reservation consumes its final slot. Dispatch must likewise recheck its token after an inner dispatch. Independent regressions exercise both cases; production fixes and final rerun are recorded below.
3. Endpoint sampling occurs after ordinary commit subscribers. If one throws, the exact endpoint may exist in SQLite while the endpoint evidence is absent. The implementation deliberately reports `runtime_failed`, no sample, and incomplete control instead of reconstructing evidence. The regression verifies this conservative behavior, including shutdown failure if the same subscriber also throws during stop.
4. Evidence-close failure on manual stop must remain visible as `shutdown_failed`. The regression checks that the stopped lifecycle cannot silently become complete.

Additional independent cases cover early watchdog firing and remaining-time rearming, a price assessment expiring during its own callback, unused backup routes with unknown prices, forged/duplicate dispatch tokens, ignored late settlement after cancellation, and faults clearing the timer or shutting down.

## Interpretation and remaining boundaries

- The fixed allowlist names eligible identifiers only. It does not establish current provider prices. Complete price assessments and billing receipts remain trusted injected inputs.
- The optional runtime rejects the default production model. There is no real-run CLI, authorization switch, writer integration, exclusive database creation, or price-verification service in this change.
- A stop aborts local request signals and prevents future admissions/late plan application. It cannot prove remote cancellation or zero charges for interrupted requests. Those remain unknown.
- The watchdog and final dispatch checks use monotonic time. Synchronous JavaScript and filesystem work cannot be preempted by an event-loop timer; this is not an operating-system hard kill deadline.
- Exact final game-minute clipping is distinct from midnight snapshots. This change does not provide daily endpoint samples or claim a nine-resident survival result.
- Endpoint samples are immutable summaries of committed resident state, not complete production/consumption accounting. `acceptancePassed` remains null.

## Verification

Independent regressions are in `tests/acceptance-stop-control-review.test.ts`. Initial execution exposed both admission reentrancy defects; no failing test was removed or weakened to hide them. The implementer added post-callback capacity checks for reservation and post-callback identity/lifecycle/dispatched checks for dispatch.

Persistence-failure follow-up rerun on 2026-11-07: all **13/13 independent tests pass**. Combined with the implementation suite and the existing nine-resident preparation review, **36/36 pass**, zero failures or skips. `node node_modules/typescript/bin/tsc --noEmit` and scoped `git diff --check` also passed. The final read-only review found no remaining blocker within the documented trusted-callback/offline scope. Full repository validation and build results belong to the implementing task; these focused tests alone do not constitute a full-suite pass.

## Final persistence-failure follow-up

The full-suite regression identified that closing evidence in a shutdown `finally` could incorrectly label evidence complete when the stop commit failed. The implementer restored failure propagation before evidence closure while keeping request revocation and abort ahead of storage. An independent acceptance-enabled test with both evidence channels verifies open sessions, no synthetic close rows, null audited wait counts and food totals, explicit `shutdown_failed`, aborted request signals, and ignored late replies. A second regression verifies stopping inside initial evidence startup cannot subsequently arm or restart the acceptance controller. Both pass in the 36-test follow-up run above.

## Final clock-close follow-up

Reviewed the final stop-time clock read: an unavailable or regressing clock changes an apparent endpoint closure to `clock_invalid`; reaching the wall deadline changes it to `wall_limit`. `controlComplete` also requires a known elapsed duration. The exact endpoint sample may remain present, but neither case reports successful control. The final combined stop-control rerun passes **32/32** (19 implementation tests plus 13 independent tests), zero failures or skips. This supersedes the earlier 30-test stop-control count; the earlier 36-test group additionally included six preparation-review tests and preceded these last two implementation tests. Full-suite verification after this final change remains the implementing task’s responsibility.

Implementer final validation (2026-11-07, Node v24.22.1): final repository suite **2000/2000 passed**, zero failed/skipped/cancelled, after the stop-persistence and final-clock fixes. Typecheck, server compilation, Vite build, offline preparation and `git diff --check` passed. Vite retained its existing >500 kB chunk warning. This aggregate result is separate from the 13 independently authored cases and is not a real-model acceptance run.
