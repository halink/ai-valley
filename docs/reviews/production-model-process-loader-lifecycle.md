# Synthetic worker loader lifecycle: independent review

## Scope and conclusion

Reviewed the compiler owner, main-thread shutdown bridge, narrow worker lifecycle changes, and loader regression tests. No blocking issue was found in this patch. The dispatch-clock request-observation changes were preserved; this review did not modify implementation or tests.

The repair targets the cause of the normal-exit race: the worker must retain its leader until the compiler child owned by the tsx ESM loader thread has actually closed. It does not relax acceptance or reinterpret an orphaned descendant as clean execution.

## Invariants checked

- Compiler initialization follows the private watchdog gate. The loader realm explicitly installs the offline guard before importing esbuild, and requires an empty environment.
- Spawn capture covers only the synchronous initialize call and is restored in `finally`. The captured ChildProcess supplies close evidence; no arbitrary PID or general descendant adoption is introduced.
- Main-thread shutdown unregisters tsx before requesting compiler stop. A referenced MessagePort keeps the leader alive until acknowledgment. `esbuild.stop()` resolving and child `exit` alone are insufficient.
- Missing close or acknowledgment does not create a new execution allowance. The existing external deadline and TERM/KILL windows remain responsible for bounded failure. Malformed acknowledgment, compiler errors, and unexpected early close cannot become success.
- Guardian and supervisor checks still require observed clean worker exit, the expected trigger and identity, an absent process group, and no issues. A missing leader with a still-present group remains a `signal_failed` failure.

## Independently executed checks

1. `tests/production-model-process-signals.test.ts`: **17 passed, 0 failed**. This includes the retained `signal_failed` result when a leader disappears while its group remains present. Log: `output/process-loader-lifecycle/review-signals.log`.
2. Real MessageChannel no-ack experiment: the peer was unreferenced and swallowed the stop message; the child ignored TERM. With the unchanged AcceptanceProcessSupervisor implementation configured for a 1000 ms test budget and 150 ms TERM grace, the leader remained alive until the supervisor killed it. Completion took approximately 1.156 seconds, with `wall_limit`, observed SIGKILL exit, both signals sent, group absent, and cleanup complete. Script and log: `output/process-loader-lifecycle/review-no-ack.mjs` and `review-no-ack.log` in that directory. This was a shortened-budget mechanism test, not a production 30-second run.

The subsequently added persistent no-ack regression was reviewed but was not independently rerun here. Its 3000 ms test budget, real MessageChannel, unreferenced nonresponding peer, and original `signalSyntheticProcessGroup` identity validation are appropriate. Its assertions distinguish deadline-driven failure from accidental natural exit or a false successful acknowledgment.

## Environment and evidence limits

The local runtime was **Node v24.22.1**. These results do not establish compatibility across all supported Node releases, including the declared Node 22 minimum. Loader/esbuild initialization behavior is version-sensitive and should be rechecked on dependency or runtime changes.

The initial real-loader test used `/proc/self/task/<tid>/children`, but the local environment returned ENOENT for those entries, as recorded in `output/process-loader-lifecycle/probe-task.log`. Replacing that unsupported enumeration with the PID returned after the captured child's real close and checking `/proc/<pid>/stat` for ENOENT is appropriate for this focused test. It does not weaken the production guardian's independent process-group and identity checks, nor claim to inventory arbitrary descendants.

The combined regression run was still in progress during the independent review; author results are recorded separately below. No real model, credentials, or real save data were accessed during this review. The patch remains a trusted offline fixture lifecycle repair, not a hostile-code sandbox or production-execution approval.

## Author verification after review

- Four-file process regression: **51/51 passed**, including the initial nine loader tests, original signal counterexamples, crash paths, guardian/watchdog SIGKILL, and actual 30-second synchronous/sealed blocking cases. Duration 165.8 seconds; `output/process-loader-lifecycle/regression.log`.
- Final loader suite with the added persistent no-ack test: **10/10 passed**. Eight consecutive normal/resume launches each had zero issues, absent group, clean worker exit, and neither TERM nor KILL attempted. The no-ack counterexample remained alive until actual SIGKILL under the shortened external test budget. `output/process-loader-lifecycle/loader-final.log`.
- Six-file continuity/diagnostics/supervisor regression: **72/72 passed**, duration 166.4 seconds; `output/process-loader-lifecycle/continuity-regression.log`. This includes the formerly blocked three-epoch continuity chain: 45/45 requests completed with 90,000 ms reserved. A fourth-launch response crash then retained attempt 55 pending, 54 acknowledgments, and the full 120,000 ms reservation; resume was rejected. Evidence: `output/continuity-rehearsal/case-zIEfD3/run`.
- Full TypeScript check, server compilation to `output/process-loader-lifecycle/build`, and `git diff --check` passed. Logs: `typecheck-final.log` and `server-build.log` in the same evidence directory.
- Guardian, watchdog, supervisor, and signal adapter remained byte-for-byte equal to HEAD. The pre-existing dispatch-clock patch was retained; six nonoverlapping files matched their captured baseline hashes, and the worker request-observation hunk was preserved. No original visual or food-gift file was edited by this task.

The first loader test run was 8/9 because unsupported `/proc/self/task/<tid>/children` enumeration made the new test's prerequisite false. Its log is preserved as `focused.log`; the actual-close test was corrected as described above, without changing guardian acceptance. These are local targeted results on Node v24.22.1, not a full repository run, Node 22 CI result, browser test, or real-model validation. No commit or push was performed.

## Combined integration verification

On 2026-11-11 the final loader and dispatch-clock changes were validated together on Linux / Node v24.22.1. The first complete run of `node scripts/test.mjs --test-concurrency=2` covered 476 files and passed **6,207/6,207 tests**, with zero failures, cancellations or skips, in approximately 1,056.2 seconds. It included the formerly blocked three-epoch continuity chain and fourth-launch response crash, eight normal/resume launches, real compiler close, missing-ack external SIGKILL, and dispatch/response deadline boundaries. Earlier failures remain recorded; no assertions or acceptance gates were weakened.

`npm run build -- --configLoader native` passed type checking, server compilation and the Vite production build. The native configuration loader avoids generated cache writes to read-only dependencies without changing the build configuration. The existing bundle-size warning remains. Guardian, watchdog, supervisor, the signal adapter and the rehearsal timing validator are byte-identical to the integration's original HEAD.

This was a mixed worktree: `d6ef7e9` plus the 12-file combined patch and ten pre-existing visual-design/personal-food-gift files, not a clean candidate-only commit tree. All 1,392 non-environment source paths and hashes were unchanged across build/tests, and all ten protected files retained their original hashes. Only these two review documents were updated afterward to record the result; executable source and tests stayed unchanged.

The run used an empty environment, read-only source/dependencies, a network namespace with loopback only, and synthetic runtime. Real environment files, runtime data and `.git` were not mounted; writable artifacts stayed under repository `output/`. Logs, timing, isolation harness and hashes are local ignored evidence in `output/integration-dispatch-loader-20261111/`, not a self-contained committed reproduction package. The shared-worker changes are combined into one exact local commit, with no push. No Node 22 remote CI, browser or real-model acceptance is claimed.
