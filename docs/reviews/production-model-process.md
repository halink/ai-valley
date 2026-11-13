> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Independent synthetic process/budget review

Reviewed the six new process ledger, storage, state, guardian, watchdog and worker files. The reviewer changed only this document and `tests/production-model-process-review.test.ts`. No production entrypoint, bridge, HTTP/admission/source-price implementation, real save, credentials, environment file, network access, sandbox retry, commit or push was used.

## Findings

No blocking defect was found within the stated trusted, fixed, offline-worker boundary. The implementation addresses the initial design concerns:

- The guardian reserves the complete 30-second launch before spawning a watchdog. Failed launches retain their charge. Reopening an unfinished launch durably blocks it.
- Original session identity, source fingerprint, global deadline, world fingerprint, cumulative request counts, session/model audit tips and the prior completion report hash bind continuation. An earlier valid session snapshot and an altered report are both rejected before another spawn.
- The watchdog is the actual worker parent. It registers guardian EOF/disconnect handling before launching, owns an isolated worker group, and releases a private bootstrap gate before the worker imports the runtime. Deadline calculation subtracts launch setup from both wall and same-boot monotonic budgets.
- The guardian requires the watchdog's actual zero exit, actual worker zero exit, absent worker group, clean supervisor report, matching worker PID/start-time identity, matching persisted report and independent durable state inspection. A durable session seal alone does not satisfy this process requirement.
- The launch ledger retains its exclusive SQLite lock while the worker separately owns the world/session/model state. State audit tips are checked before constructors can append recovery/poll records.

## Independent validation

The first real-process suite passed **10/10** in 39.6 seconds. It covers normal completion plus resume; valid earlier-session rollback; completion-report tampering; crash after reservation; missing watchdog; crashes after session intent, model response, model acknowledgment and session seal; and guardian SIGKILL while the worker is synchronously blocked. Each completed worker-failure case with a reported identity had an absent process group. The owner-death case produced an independent watchdog report with parent-disconnect trigger, observed worker SIGKILL and confirmed cleanup, while the launch remained pending until reopen permanently blocked it.

The installed TypeScript no-emit check passed. Results are retained in `output/process-review/results.log`; individual private synthetic run directories are retained alongside it for inspection. Additional watchdog-death and hard-deadline seal-block checks are recorded below when complete.

## Limits and interpretation

This is defense in depth for fixed trusted synthetic code, not an operating-system sandbox. The network/file guard does not contain hostile code, mutable same-user source, escaping descendants or arbitrary native execution. The storage capability checks reject unsafe paths, file types, links and permissions, but do not promise security against malicious same-user replacement between checks and SQLite open. Hash chains are not signatures or external anti-rollback anchors; coordinated replacement of all synthetic artifacts is outside the claim.

The watchdog's own death cannot be repaired by its own logic. The guardian can attempt cleanup only after learning a worker identity. A crash before identity delivery, a leader disappearing while descendants survive, PID/group reuse, uninterruptible kernel I/O or a descheduled supervisor can leave uncertainty. Unknown cleanup must remain blocked rather than be called success. After watchdog SIGKILL, orphan zombies may require PID 1 to reap them; zombie state means not executing, not absent or clean completion.

The 30-second execution allowance is followed by separately bounded TERM/KILL cleanup windows; it is not a real-time disappearance guarantee. Session/model/world writes are independent transactions. FULL SQLite commits and directory/file fsync calls do not establish a tested power-loss guarantee. Local process death does not establish remote cancellation, provider cost, live model execution or acceptance. Reports correctly retain false/null values for those claims.

### Additional real-process fault checks

The additional two checks passed **2/2** (37.3 seconds), bringing independent coverage to **12 passed tests across two runs**, not a full-repository aggregate. Watchdog SIGKILL caused the guardian to block the launch and terminate the known synchronous worker; the test conservatively accepts only actual group absence or an observed nonexecuting zombie when its parent has died. It does not manufacture a clean process report.

The session-seal blocking case exercised the unmodified **30-second** launch allowance. Although the session's durable seal had completed, the worker remained synchronously blocked. The watchdog reported wall-limit, TERM then KILL, observed SIGKILL and absent-group cleanup. The guardian wrote no clean process completion and permitted no resume. This test took 32.9 seconds including startup and cleanup, rather than using a shortened test-only budget. Evidence is in `output/process-review/additional.log`.

The initialization block precedes runtime signal-handler installation, so default OS SIGTERM termination is valid for that scenario. Strict TERM-resistance/SIGKILL evidence above uses synchronous runtime and post-seal blocks after the handler is installed. This distinction does not change the launch deadline or require a production-source change.

Final installed TypeScript checks passed for both `tsconfig.json` and `tsconfig.server.json`; `git diff --check` passed. No implementation file was edited by this reviewer.
