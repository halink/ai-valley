# Synthetic nine-resident continuity review

## Scope

Independent review of the opt-in sustained synthetic process scenario, its observation validator, guardian evidence binding, and per-request reconciliation. The reviewer changed only this review and `tests/production-model-continuity-review.test.ts`. Tests use fixed offline child processes, newly generated synthetic directories, empty child environments, and the existing offline guard. They do not read credentials, real saves, provider bills, or existing shared test fixtures.

The reviewer independently opens all four generated SQLite databases with `readOnly:true`. For short fixtures with at most 180 archived events, the test reconstructs the saved world from compressed state, terrain, resource base and changes, then computes its canonical fingerprint. This bounded decoder deliberately rejects larger histories rather than silently claiming full runtime-window reconstruction.

## First review findings

The initial run, recorded in `output/continuity-review/first.log`, confirmed four evidence defects:

1. Changing an already completed launch's rehearsal JSON did not block an actual resume. The guardian checked the process report hash but did not recheck its referenced rehearsal hash. A second 30-second launch was reserved and spawned despite the changed transcript.
2. A permutation of every per-request actor label, preserving coverage of all nine IDs and recomputing the surrounding hashes, passed reconciliation. The labels were not tied to the actual resident identity in each emitted prompt.
3. A rehashed request observation at the launch's admission cutoff passed. The evidence validator checked report completion bounds but not the request cutoff.
4. A rehashed request observation beyond the monotonic hard deadline passed. Individual monotonic timestamps were not bounded by the report lifetime.

These were evidence-validation and continuation defects. They did not demonstrate that the core runtime dispatched late or made a real network request. The first actual sustained run accepted 18 deterministic wait decisions, covered all nine residents, advanced the normal world clock from minute 480 to 505.98, and exited cleanly.

The initial controls also confirmed that a rehashed response mismatch between the two journals is rejected, and restoring an earlier valid session database after two completed launches blocks further reservation. The first test invocation reported 3 passes and 5 failures: four failing subtests plus their aggregate parent. No failures were suppressed or relabeled as successful execution.

Initial evidence directories:

- `output/continuity-rehearsal/case-dTtmDH/run`: sustained progress and actual transcript-tamper continuation reproduction.
- `output/continuity-rehearsal/case-OWpyOu/run`: two completed launches followed by a rejected session rollback.

## Follow-up verification

The author tightened all prior completion-report and rehearsal-hash checks before reservation, tied each actor to the fixed roster and actual emitted prompt prefix, and added wall/monotonic bounds for observations, acknowledgments, ticks and natural cutoff completion. Request timestamps were renamed from dispatch timestamps to observation timestamps: the 20 ms poll records a conservative upper bound on invocation, not the exact dispatch instant. The test reconciler also checks the replayed state at reported audit tips, and reads generated databases without writable `WorldStore` construction.

The expanded independent suite requires rejection of an older transcript or process report after a newer clean launch, so checking only the newest report is insufficient. It also mutates historical audit-tip references while preserving valid outer hashes, and checks early finish, repeated ticks, post-finish ticks and oversized game-time steps.

A follow-up invocation exposed a reviewer test-harness mistake: a nested test was queued using its outer context while its sibling awaited it. The unchanged 60-second bound cancelled that parent and two subtests. The log is retained as `output/continuity-review/second-harness.log` (9 passed, 0 failed, 3 cancelled). The test context was corrected, without changing source, execution budgets or assertions. The fixed-source evidence checks already completed in that invocation passed.

## Final independent result

The corrected final suite passed **12/12 tests, with 0 failures, 0 cancellations and 0 skipped**, in 43.629 seconds. Log: `output/continuity-review/final.log`. No unresolved blocking defect was found in this bounded review after the fixes.

- The sustained fixture accepted 18 synthetic 15-minute wait decisions, with prompt identity checked independently for all nine founders. Both journals contained matching one-to-one request/response/acknowledgment evidence.
- The ordinary runtime advanced from minute **480 to 506.1132** through **19 observed advancing ticks**, at the unchanged 20-real-minutes-per-day setting and one model slot. No manual tick or clock injection was used.
- Completion was recorded **24,281 ms after the original launch reservation**, including worker initialization, with a **22,607 ms observed runtime interval**. The entire 30-second reservation remained charged. The supervisor observed a real zero exit, an absent process group, and no issues.
- Fully rehashed actor permutations, cutoff/hard-deadline observations, early finish, invalid tick observations, cross-journal response mismatches, and historical report pointers to an existing but incorrect audit state were rejected.
- After two clean launches, modification of an older bound transcript or older completion report blocked a real resume before another reservation or spawn. Restoring a previous valid session database likewise preserved the two charged reservations and blocked continuation.

Final generated evidence:

- `output/continuity-rehearsal/case-wxL64W/run`: sustained runtime evidence, followed by a second clean launch and an intentionally altered older transcript whose next resume was blocked. The intentionally altered transcript is not a final clean artifact; its original successful observations are recorded in the test log and bound process report.
- `output/continuity-rehearsal/case-Stqoiy/run`: two clean launches, altered older process report, and blocked continuation.
- `output/continuity-rehearsal/case-O2wPNt/run`: two clean launches, valid earlier session restoration, and blocked continuation.

Final review-test SHA-256: `4c9d80482d6ea009f783ae7ad69aa615345a700550cbe63e59418f060f0eb3df`. The review test and document pass `git diff --check`. This independent suite executes one sustained epoch plus explicit continuation/tamper fixtures; the author's separate three-epoch and fourth-launch crash test is not represented here as an additional independently executed three-epoch run.

## Limits

All responses are synthetic selections of a menu's emitted 15-minute wait choice, with synthetic token usage of one input and one output token. Hashes are integrity/correspondence checks, not signatures, provider price authentication, or protection against a same-user adversary replacing the entire source and evidence set. These tests do not establish production isolation, remote cancellation, zero provider charges, fifteen-day acceptance, or real-model readiness. No whole-repository, browser, Vite, live-model, bwrap, or publication operation is part of this review.
