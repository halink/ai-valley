> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Live probe leader-exit / process-group cleanup review

Date: 2026-11-10. Base: `c60c8b1`. Synthetic/offline only. No model request, credential or existing-save read, browser, commit or push was performed.

## Finding

The first integrated baseline passed **5101/5102** tests. The successful-probe case in `tests/acceptance-live-probe-review.test.ts` rejected `signals.term: sent` although every recorded lifecycle fact was successful:

- OS leader exit observed, code 0, no exit signal; trigger `child_exit`.
- No deadline or parent signal; elapsed 2937.942122 ms within the unchanged 30000 ms synthetic budget.
- TERM sent, KILL not attempted; final group absent, cleanup complete, no issues.
- Guardian exit 0, verified probe mechanics and no worker/recovery failure.

The unchanged entire review file then passed **17/17**. That rerun does not erase the initial failure or establish stability.

`AcceptanceProcessSupervisor.observe(exit)` deliberately probes the owned process group after observing leader exit. If the group is still present, it sends TERM and continues bounded observation. A successful leader exit does not mean every descendant has exited. The failed assertion incorrectly required both events to occur together. Suppressing cleanup signals, ignoring remaining group members, adding a sleep or increasing the deadline would be incorrect fixes.

There is a real source of short-lived descendants here: `tsx` uses `esbuild`, whose `ensureServiceIsRunning` in `node_modules/esbuild/lib/main.js` spawns a service in the same process group and unrefs the child and its pipes. Cold transforms create this helper; cache-hit runs may not. Worker exit, helper exit and reaping are separate OS events. The original failed run did not record group-member identities, so it cannot prove which process remained in that particular execution. The controlled reproduction below establishes the actual tooling path that produces the same facts, rather than claiming to reconstruct an unrecorded historical process list.

## Real-process diagnosis and controlled reproduction

All diagnostic files and fresh source copies are under `output/supervisor-flakiness-20261110/`. Only process IDs, parent IDs, group IDs, names and states were inspected, not other processes' command lines, environment or files.

1. Sixteen synthetic probes, four at a time, passed naturally. Cold-run traces show the real worker plus its same-group `esbuild` helper. Subsequent warm-cache runs show only the worker. The original natural failure was not observed again in these sixteen runs.
2. A fresh repository-local source copy forced cold transforms without deleting caches or altering production sources. After the actual worker's readiness message, a diagnostic preload paused only its observed `esbuild` helper. When the supervisor sent TERM after leader exit, the preload resumed the helper. There were no sleeps or budget changes, no invented exit/group-absence observations and no worker pause.
3. All **4/4** runs reproduced the old assertion failure: leader exit 0, `child_exit`, no deadline, TERM sent, no KILL, eventual group absent, cleanup complete, issues empty, guardian exit 0 and verified synthetic mechanics.

Representative `cold-held-0.trace.jsonl` sequence:

- Worker PID 141 and helper PID 201 share group 141; helper's parent is the worker.
- Worker exits 0; helper remains stopped in group 141 and is reparented to PID 1.
- Real `kill(-141, 0)` succeeds; real `kill(-141, SIGTERM)` succeeds.
- Helper is resumed and then observed as a zombie. A sent signal or zombie is not treated as group absence.
- The next real group probe returns ESRCH, after which cleanup completes.

This deliberately controlled ordering demonstrates the lifecycle race, not a claim that the same timing naturally recurred. The untouched supervisor produced all the recorded facts. A later cold-start run may take a different ordering; tests must validate either ordering without fabricating success.

Evidence retained locally:

- `output/integration-c60c8b1-20261110/logs/full-suite.log`: original 5101/5102 failure; SHA-256 `79496fc075708c076ff35e0024589dc1ac0b3f757f9ffa1432cf4bd7452aa575`.
- `output/integration-c60c8b1-20261110/logs/live-probe-review-rerun.log`: unchanged 17/17 rerun; SHA-256 `f719f97bf7f3cffa6e6133095b40caa959e2d64fe21fca02b17315eb50172812`.
- `output/supervisor-flakiness-20261110/reproduction-traced.log`, `trace-*.trace.jsonl`: sixteen natural runs and observed membership.
- `output/supervisor-flakiness-20261110/reproduction-cold-held-helper.log`, `cold-held-*.trace.jsonl`, per-run `live-result.json`: four controlled real-process reproductions.
- `output/supervisor-flakiness-20261110/controlled-comparison.log`: all four recorded reports fail the old signal-only assertion but satisfy strict lifecycle/evidence checks, with exactly nine synthetic decisions and zero network attempts.
- `reproduce-cold-held-helper.mjs` and `hold-helper-hook.mjs` in that diagnostic directory preserve the experiment. Run only with a new output namespace and a new cold source copy; existing run directories are intentionally refused.
- The initial diagnostic harness had an invalid doubled separator in its output path and did not launch workers. Its failed setup output remains in `reproduction.log`; it is not counted as a lifecycle reproduction.

## Minimal correction and permanent regressions

No production or launcher/worker code changes. No synthetic or real time/request budget changes.

The live success test now explicitly requires the actual observed OS exit to be code 0 with no signal, outcome `exited_zero`, trigger `child_exit`, no deadline, no parent signal, final group absence, complete cleanup, no issues and no recovery/worker failure. KILL must still be unattempted. TERM may be unattempted (group already absent), sent (descendant cleanup), or not found (the group disappears between its probe and signal). Unknown signal results remain failures.

Three deterministic tests in `acceptance-process-supervisor-review.test.ts` preserve these distinct branches using the existing injected clock:

- Group already absent at leader exit: no signal, immediate settlement.
- Descendant still present: TERM at time 100, cleanup remains false until actual injected absence is probed at the existing next poll at time 110. No KILL, timeout or exit-signal invention.
- Group disappears between probe and TERM: `not_found` is retained; a subsequent absent probe permits settlement.

Each branch verifies the exact exit, trigger, signal result, settlement time, no issues, one dispose, no surviving timer and immutable settled facts. Existing present/unknown-group, KILL, timeout and delayed-callback negative tests remain. These regressions fail if cleanup is skipped or if leader exit or successful signaling alone is used to infer group disappearance.

## Verification

The updated process-supervisor review first passed **16/16** under the installed Node, empty inherited environment and preloaded offline guard. The installed TypeScript `tsc --noEmit` check and scoped `git diff --check` also passed. SHA-256 comparisons confirm the supervisor, live guardian and live worker remain byte-for-byte equal to HEAD.

A separate reviewer inspected the changes, original logs, reproduction traces and negative-test coverage and found no blocking issue or inappropriate widening. The reviewer independently verified both original-log hashes and ran the complete live review plus supervisor review: **33/33 passed** (17 + 16), zero failures/cancellations/skips, exit 0, **99.94 seconds**. Evidence: `output/supervisor-flakiness-20261110/independent-review-N3M0su/targeted.log`. Source edits by the parallel HTTP-adapter task were paused for the remaining run; the successful synthetic case also explicitly verified its before/after source fingerprint. The reviewer changed no files.

The original 5101/5102 failure and unchanged 17/17 rerun remain preserved and are not relabeled as a pass. These targeted results do not replace the next coordinated full-suite run, and none of these checks constitutes real-model or long-duration acceptance.
