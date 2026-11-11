# Admission cancellation accounting review

## Scope

Independent review of the optional runtime cancellation observer, synthetic price bridge evidence, and bounded continuity validator. Production files are owned by the implementing reviewer; this review adds only `tests/production-model-admission-cancellation-review.test.ts` and this document.

A local `metrics.requests` start is durably committed before admission is checked again. Crossing the fixed admission cutoff during that commit can therefore produce one extra local start without a model intent, response, acknowledgement, success, or transport invocation. Treating starts and transport attempts as interchangeable incorrectly rejects that clean drain. Accepting arbitrary greater-than counters is also incorrect.

## Required accounting and ordering

- The optional synchronous observer runs only after a persisted start and explicit admission rejection while the runtime remains live and draining. Exceptions, stale generation, generic stop, failed price assessment, model failures, and responses must not become cancellations.
- The bridge validates the persisted actor, request number and revision, exactly one in-flight actor, draining session, no pending journal/session operation, equal attempts and completions, and actual transport count before recording evidence.
- Starts equal observed transport requests plus explicitly evidenced cancellations. All observed transport requests retain independent request/response/acknowledgement correspondence and equal success/local-decision counts. One-slot clean terminal drain permits at most one cancellation.
- A cancellation binds its persisted world fingerprint to model/session audit tips, fixed reason, wall and monotonic timestamps, actor/model, request number, revision, and actual ledger/transport counters. Hashes alone are not authority: the validator requires independent checkpoint lookup against replayed durable rows.
- Cutoff and hard deadline remain separate. A cutoff cancellation carries no provider request or cost. Hard-deadline failure cannot authorize clean continuation. No counter decrement, request-budget rollback, relocated dispatch, billing claim, or weakened acceptance threshold is needed. A bounded optional world receipt is required for independently verifying the cancellation identity and baseline.

## Review-found blocker and correction

The first checkpoint-only design was insufficient. Replaying authentic audit tips proves the checkpoint fingerprint and ledger counts, but does not itself prove the cancellation actor, request number, revision, or starting-counter baseline. An independent adversarial probe reused actual pre-stop model/session drain checkpoints, changed the reported starting request count and tick revisions, fabricated a cancellation, and recomputed all report and launch hashes. The checkpoint-only validator accepted it. The preserved counterexample is `output/admission-cancellation-review/checkpoint-forgery-red.log`.

The implementing reviewer corrected this by committing a bounded opt-in cancellation receipt into the world before notifying the bridge. The receipt records cumulative cancellation count, construction-time request/cancellation baselines, identity, request number, revision, and both clocks. The validator compares event fields against the independently reopened final-world receipt and requires exact count and baseline correspondence, in addition to the existing audit-tip checks. A report-only forgery must not be able to invent this durable receipt. The new regression rejects that same attack; final confirmation follows below.

## Independent evidence

The pre-fix counterexample increased the detached fixture's persisted starts from nine to ten without adding cancellation evidence. The existing greater-than comparison accepted it. The regression test correctly failed with “Missing expected exception”; see `output/admission-cancellation-review/red.log`.

Four deterministic runtime tests passed with mocked clocks and generated SQLite files (`output/admission-cancellation-review/runtime.log`):

1. Move time to the cutoff after the start commit. One cancellation is observed, no transport or ledger attempt occurs, and cleanly sealed journals/world reopen consistently.
2. Synchronously drain from a start subscriber. The same zero-transport terminal evidence is recorded with the manual-drain reason, and durable state reopens.
3. Drain reentrantly during price assessment immediately before dispatch. The observer fires synchronously once and the model is never called.
4. Throw from post-start admission. The runtime fails; no cancellation is reported.

The independent test file also checks balanced old reports, explicit terminal evidence, missing/empty evidence, duplicates, inconsistent starts/counters, wrong identity/revision/time, nonterminal request numbers, invalid or forged audit hashes, and absent/rejecting checkpoint lookup. It includes one separately authorized synthetic sustained process fixture and rehashes the entire report-to-launch chain for adversarial report mutations. The initial checkpoint-only implementation passed these eight tests (including one actual synthetic process launch), which exposed the need for the additional durable-receipt attack above. Final execution results for the stronger implementation follow below.

## Final execution results

`output/admission-cancellation-review/final-green.log`: **11 tests passed, zero failed** on the durable-receipt implementation. This includes all detached validator attacks, exact receipt equality after SQLite reopen, and failure to persist the receipt (no callback, no transport, no seal). Async and throwing observers also stop with `runtime_failed` rather than producing clean continuation.

The authorized real-clock synthetic sustained run completed successfully and its independent correspondence checks passed. Its generated evidence is `output/continuity-rehearsal/case-ilfKWx/run`. Detached mutations recomputed the rehearsal hash, process-report hash, and complete launch hash chain. Missing explanation for starts, forged nonterminal cancellation, reuse of an authentic drain checkpoint without a durable cancellation receipt, and post-cutoff transport observations were rejected. The real-clock run did not need to hit the narrow cancellation race; the deterministic mocked-clock SQLite tests exercise that boundary directly.

`output/admission-cancellation-review/resumed.log`: **one additional deterministic test passed**, reopening between two cancelled segments and checking cumulative receipt counts and constructor baselines. Thus the review has 12 passing tests across those two runs.

The optional receipt is bounded to one last-event record, a cumulative count, and the prior receipt hash. Ordinary runtime paths without the observer do not create it. The durable observer path adds a checkpoint before publishing evidence, without moving the existing start counter or transport admission. A subsequent review found one additional baseline-forgery case and a historical receipt-chain gap, addressed in the final verification below. This conclusion remains limited to the inspected code and targeted checks, not the full suite or production execution.

## Historical receipts and forged baseline review

A last-event receipt alone does not cryptographically anchor older cancellation bodies after another cancellation replaces it. The bounded correction is a hash of the entire preceding receipt and verification of the observed count-indexed chain against the final raw-world receipt. Missing, duplicated-conflicting, or hash-link-inconsistent receipt evidence must fail closed; no unbounded receipt array is stored in the world.

The current receipt also must not be copied into a forged initial snapshot to hide a cancellation. A targeted regression removed the cancellation array, incremented the starting request count, and copied the genuine final receipt into the initial snapshot, leaving the independently supplied final world unchanged. The intermediate validator accepted it; the red regression is `output/admission-cancellation-review/hidden-current-receipt-red.log`. Prior-receipt revision/request-number chronology plus exact cross-report receipt continuity prevent this forgery. The final rolling-chain implementation passed **all 12 independent tests** in `output/admission-cancellation-review/chain-deterministic.log`. Despite the name, that log includes the actual sustained process test too: generated evidence is `output/continuity-rehearsal/case-iHLUW4/run`. The two mocked resumed cancellations now verify a null first predecessor and exact hash linkage to the prior persisted receipt. History tests reject a missing predecessor, conflicting duplicate count, modified old receipt with a recomputed later link, a broken link, and a receipt dated beyond its containing snapshot. The independently reopened final world is the terminal anchor; supplying it can legitimately fill a missing copy of the final receipt in the detached history input.

The hidden-current-receipt regression now passes: initial snapshot chronology rejects a genuine current receipt masquerading as an old receipt. The full-chain forged-checkpoint regression also remains rejected. No unresolved safety-blocking defect was found after these corrections. The result is limited to bounded synthetic evidence and the targeted checks described here.

## Limits

All checks use the unchanged offline guard, a cleared environment, branded synthetic HTTP, and newly generated repository-local fixtures. No full suite, browser, external network, model keys, real saves, commits, or pushes are part of this review. No retry or bypass of the previously denied full-suite sandbox was attempted. These checks do not establish production readiness, provider billing, hostile-code isolation, power-loss durability, or a real six-hour run.
