# Offline synthetic process failure diagnostics

The d44374c GitHub run failed in the third sustained launch with only `supervised_launch_failed`. The saved CI log established worker readiness and failure about 24.815 seconds after reservation, but did not retain the worker failure reason, watchdog report, or generated databases. The run had no artifacts. Its precise original cause is therefore still unknown. This change repairs observability; it does not declare that historical failure fixed or reclassify it as a pass.

## Diagnostic boundary

The existing 12 rehearsal validation predicates, their ordering, and the error message are unchanged. Rejected predicates now attach a non-enumerable `syntheticCheck` code. JSON/BigInt parsing errors remain errors. Unknown errors are reported as `unknown`, never as raw messages or stacks.

The worker records a bounded stage/reason/check projection and synthetic counters when possible. Its supplemental failure JSON is not a successful rehearsal report. Watchdog and guardian independently sanitize the diagnostic IPC. Guardian includes the real observed child/watchdog exit, trigger, cleanup state, and known supervision issues in its failure projection. All diagnostic strings are enumerated; numeric fields are finite and bounded. Actor coverage is a nine-bit mask, not resident names or prompt text. Wall and monotonic observation/finish offsets are relative to the original admission cutoff; nonnegative observation offsets still fail the original check.

Diagnostic failure cannot clear pending work, create a completion, refund a launch, authorize resume, or change the exit status to zero. Collection is guarded so a failure while observing status does not bypass existing cleanup. No budget, admission window, watchdog allowance, timeout, production capability, retry policy, or required-check rule changes.

## CI artifacts

CI creates a fresh private `output/continuity-ci-XXXXXX` root before tests. Each continuity fixture creates its own private case subdirectory and writes sanitized invocation JSON with exclusive creation. The artifact step, including after a test failure, selects only those case invocation JSON files.

It does not copy raw rehearsal reports, request bodies/replies, names, source/world hashes, stderr, paths, databases, credentials, runtime saves, or existing output directories. Original local run evidence remains where the fixture already stored it, outside the upload path. The artifact helper rejects alternate output roots, symlink roots, and insecure directory modes. This is a trusted-code projection, not a same-user adversarial filesystem sandbox.

`launchLedgerAttempts` and `launchLedgerCompleted` explicitly describe the latest completed launch ledger state; they must not be mistaken for the failed worker's counters. Worker counters, when available, are separate fields. Null denotes unavailable or rejected diagnostic data, not a successful check.

## Verification and limits

Author deterministic tests exercise every existing predicate family and a real `late_headers` failure with permanently charged reservation and rejected resume. Independent tests cover privacy, accessor/array-hook rejection, artifact permissions/path limits, and forged diagnostics having no ledger authority. Review history is in `docs/reviews/production-model-process-diagnostics.md`.

All runtime evidence is fixed offline synthetic evidence: `realModelExecuted=false`, `liveExecutionEnabled=false`, `actualProviderCostCny=null`, `readyForProduction=false`, and `acceptancePassed=null`. No real key, real save, provider call, network workaround, bwrap retry, GitHub rerun, commit, or push is part of this implementation. Remote CI evidence is pending a separately authorized publication/run.

### Frozen-source verification (2026-11-11)

- The ten-file targeted regression passed **133/133**, with zero failures, cancellations, or skips, in **342.702 seconds**. It includes both continuity suites, both process suites, both price-runtime suites, both supervisor suites, and the author/independent diagnostic suites. Log: `output/continuity-diagnostics-check/targeted-regression.log`.
- The real three-epoch fixture accepted 45 synthetic decisions, retained 90,000 ms of reservations, and advanced minute 480 to 557.8776. The expected fourth-launch crash left request 55 pending after 54 acknowledgments and retained 120,000 ms. The new projection reported worker exit 73, watchdog exit 1, `child_exit`, and an absent process group. Its next resume remained blocked before reservation. Local original evidence: `output/continuity-rehearsal/case-IG7kOE/run`.
- The separate `late_headers` negative control exited 1 with one attempt, zero completions, pending work in both journals, an unsealed runtime, and the full 30,000 ms charged. Its subsequent resume remained denied. This proves a diagnostic is not converted into successful execution.
- A fresh CI-style root produced 16 sanitized invocation JSON files across five private cases, 18,123 bytes total. The root is recorded in `output/continuity-diagnostics-check/artifact-root.txt`; none of the raw run directory was copied there.
- Local verification used installed Node **v24.22.1**, the offline guard, empty child environments, and test concurrency 1. The original GitHub run used Node v22.23.4; this is not an exact remote-environment reproduction or a claim that the original failure is fixed.
- Code hashes were captured before this regression in `frozen-code.sha256`. The five pre-existing food-gift candidates have a separate unchanged hash baseline. No whole-repository suite, browser/GPU, real-model acceptance, or remote artifact upload was performed.
- Final offline-guarded `tsc --noEmit` and server compilation to the dedicated check directory both passed. `git diff --check` and all frozen-code/food-gift hashes passed. Independent read-only review verified all 16 final artifacts against its own schema, enum, privacy, and permission checks. The final fourteen-file delivery manifest is `output/continuity-diagnostics-check/frozen-delivery.sha256`; no files were staged or committed.
