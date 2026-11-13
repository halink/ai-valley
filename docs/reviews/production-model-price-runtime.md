> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Synthetic price runtime bridge review

## Scope and conclusion

Reviewed `production-model-price-runtime.ts`, the opt-in admission/drain additions in `runtime.ts`, and shared ownership wiring in `production-model-runtime-ownership.ts` / `production-model-runtime.ts`. Read the existing price-session, model journal, HTTP candidate, and acceptance-stop implementations to check ordering. No implementation files were changed by this review.

One reentrancy defect was found in the generic opt-in runtime drain API and has been corrected. The previously failing independent counterexample now passes. No unresolved safety-blocking defect was found in the final reviewed revision. The price bridge uses a fixed assessment callback and did not itself trigger that counterexample. This is a bounded static review and synthetic test exercise, not production authorization or proof of power-loss safety.

## Ordering checked

- A branded synthetic HTTP transport is required. The public `kind` field alone does not pass the existing candidate's WeakMap validation. No new credential, endpoint, network callback, or live enable input was introduced.
- Both contracts retain the same global identity, deadline, request limit and timeout; attempts and completed counts are compared before opening another segment. A pending/unsealed session cannot be resumed through this constructor.
- Session intent precedes candidate invocation; the candidate persists journal intent before its memory transport. Journal response and session response precede business decision parsing. Result identity, actor, revision, pending IDs, hashes and both checkpoint fingerprints are checked before acknowledgement.
- The ordinary world checkpoint never clears pending state. An accepted durable decision is acknowledged in both journals before a clean drain can finish.
- Drain rejects new admission without rejecting existing responses. The final request's `finally` removes in-flight state before actual stop. The runtime stop lifecycle records journal stop intent before fallible shutdown work. Journal stop completion precedes the session seal; failure of either leaves the bridge failed and session unsealed.
- The session seal is the last fallible operation in the stopped observer. Existing acceptance control incorporates shutdown/timer issues before that observer; its later return bookkeeping does not add an independent persistence step.
- Shared store ownership prevents simultaneous use by the previous offline runtime bridge and this bridge. Ownership remains held after sealing until explicit close.

## Focused independent tests

`tests/production-model-price-runtime-review.test.ts`: 8 passed, 0 failed on the corrected implementation.

1. A synchronous subscriber drains after runtime reservation but before dispatch: no transport invocation, both journal attempts stay zero, actual stop and seal succeed.
2. Session seal fails after journal stop completion: no successful seal or continuation; both ledgers are blocked.
3. Journal stop completion fails: session remains unsealed and blocked.
4. Exact commit-grace boundary: no acknowledgement and no seal.
5. Clock rollback while draining: late response cannot acknowledge or seal.
6. Both failure-marker methods throw: the bridge still remains failed/stopped in memory and cannot restart.

7. **Corrected defect, regression test now passing:** `AcceptanceStopControl.dispatch()` invokes the injected price assessment after the runtime's last drain/admission check. If that assessment synchronously calls `drainAcceptance()`, the request is already in `inFlight`, so stop is deferred; acceptance control remains running and dispatch succeeds. The runtime immediately invokes its model despite draining. Reproduction observed one model invocation where zero is required. The implementation now rechecks liveness/admission after `dispatch()` and before the model call. No live HTTP code change was needed.

8. One timer cleanup throws: all originally armed timers still receive cleanup attempts, actual runtime stop occurs, the active request is aborted, and a late response cannot acknowledge.

Historical pre-fix failure evidence: `output/price-runtime-review/reentrant-price.log`.

Current eight-test output: `output/price-runtime-review/targeted-tests.log`.

## Interpretation and remaining evidence limits

- Runtime request reservations / `metrics.requests` can exceed ledger attempts when admission closes after reservation but before actual model dispatch. These counters are not interchangeable. The reviewed test demonstrates one reservation with zero dispatched requests and zero attempts in both journals.
- The internal synthetic clock seam was also reviewed: candidate construction does not invoke the clock, and candidate status does not recurse into it. The segment attempt baseline and single-use transport invocation count distinguish pre-dispatch cutoff checks from permissible post-cutoff responses.
- The original deadline is not a drain trigger: admission cutoff is. Reaching the hard deadline or commit-grace boundary fails closed rather than producing a clean seal.
- Failure to persist a block is not durable recovery. The final bridge explicitly exposes `journal_block_failed` / `session_block_failed` in `persistenceIssues`. The bridge's failure field remains authoritative in the current process; future recovery depends on existing unresolved-intent / unsealed-segment / fingerprint checks.
- Trusted callers still own their isolated handles, source/fixture identity assertions, and lifecycle discipline. This review does not establish authenticated live price evidence, provider billing, real cancellation, or an external watchdog.
- Tests used a cleared environment, the repository acceptance offline guard, branded in-memory HTTP, and generated SQLite fixtures under this review's output directory. No network, keys, environment files, real runtime saves, or bills were accessed. No full test suite or sandbox retry was attempted.
- These eight tests do not simulate process termination, SIGKILL, power loss, filesystem durability faults, or hostile code. The offline guard is defense in depth for trusted offline code, not an OS sandbox.
