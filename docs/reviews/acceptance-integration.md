# Acceptance control / evidence integration: independent offline review

## Scope and conclusion

Reviewed the explicit `ValleyRuntime.acceptanceEvidence` integration with `AcceptanceStopControl`, `AcceptanceEvidenceWriter`, and the evidence schema. Added `tests/acceptance-integration-review.test.ts` without changing production code.

**One post-commit reentrancy defect was reproduced and then verified fixed; no blocking defect remains in the independently exercised boundaries.** This is an offline integration review, not a real-model run or the nine-resident acceptance verdict. Production entry points were not enabled. Existing unrelated work in the checkout was not reviewed or changed.

## Independently verified cases

The initial focused suite passed **13/13** tests. The additional post-commit regression below raises the current independent integration suite to **14/14**:

1. Shutdown storage failure cancels the outstanding fake request before attempting persistence; the raw terminal record includes `shutdown_failed`, and the journal stays unsealed. A late successful response changes neither world revision nor journal bytes.
2. Food-step journal fsync failure stops control and invalidates derived totals.
3. Evidence-close fsync failure cancels outstanding work; a late rejection does not append evidence.
4. Throwing endpoint observer retains the exact raw sample but cannot seal a successful run.
5. Asynchronous rejecting endpoint observer has the same failure semantics without an unhandled rejection.
6. A subscriber that reenters `stopAcceptance('signal')` during bookkeeping leaves one reserved, explicitly undispatched request; the fake model is never called and costs are not fabricated as dispatched work.
7. Starting exactly at the endpoint produces a legitimate zero-duration segment, no model call, and no remaining acceptance timer. Reuse is rejected.
8. A pre-aborted signal closes both evidence channels without admitting a request or arming the acceptance timer.
9. Reading an in-progress crash prefix leaves bytes unchanged and final interruption/cost counts unknown. The reader neither cancels work nor repairs the journal.
10. Truncating a sealed journal at the terminal control row invalidates derived completion, cost, and food totals; recovery is read-only.
11. Journal-close failure after writing the terminal control row leaves the raw endpoint available but `verified` and derived `controlComplete` false.
12. A world-step commit that fails once cannot acquire a clean seal merely because the later shutdown commit succeeds.
13. An endpoint commit followed by a throwing subscriber is distinguished from successful endpoint sampling; the raw endpoint is absent and shutdown failure remains explicit.

Synthetic exception markers are also checked not to leak into evidence in the tested storage and endpoint-failure paths.

## Semantic distinctions that callers must preserve

- The presence of `run-close.json` alone is not proof of a valid seal. A later sync/close failure can leave that file alongside a failure marker. Use the full read-back report.
- `complete` means the evidence segment was consistently sealed and verified. A complete manual/signal/limit stop is not successful endpoint control and is never an acceptance pass.
- `acceptanceControl.finalStatus` is a raw observed control record. In a close failure it may predate `evidence_persistence_failed`; callers must consult `verified` and the derived flags instead of treating a raw `controlComplete: true` as a trusted result.
- A reservation and waiting-channel request event are not proof of transport dispatch. `dispatchedRequests` and each unfinished request's `dispatched` flag carry that distinction.
- `gameScopeComplete` in raw control records means an exact sample was captured; it does not prove observer success, successful shutdown, durable evidence, or a complete acceptance run.
- Local abort signals do not establish remote cancellation. `remoteCancellationConfirmed` stays false. Injected zero prices do not establish a currently available free provider; `freeModelAvailabilityVerified` stays false.
- Unknown cost, missing final control, or an unsealed/truncated journal must not become zero-cost or zero-consumption claims. `acceptancePassed` and `realModelExecuted` remain null.

## Method and limits

All scenarios use synthetic frontier worlds in `WorldStore(':memory:')`, a deferred fake model, an injected monotonic clock, a mocked wall clock, mocked intervals, and fresh temporary evidence directories. Network fetch is replaced with a throwing stub. Faults are injected at filesystem sync/close or store commit boundaries. The independent review cases simulate crash behavior by reading an open journal and truncating synthetic evidence. The subsequent combined test run also exercises SIGTERM and SIGKILL against dedicated synthetic child processes, as described below. No genuine archive was accessed.

Executed:

- `node --import tsx --test tests/acceptance-integration-review.test.ts` — 13 passed, 0 failed.
- `node node_modules/typescript/bin/tsc --noEmit` — passed (exit 0), after replacing a test-only `findLastIndex` call with an ES2022-compatible loop. The integrating worker owns rechecking after any subsequent changes.

No browser, npm command, real credentials, real model, real service entry point, commit, or push was used. Physical power-loss durability, real filesystem device failure, provider billing, and remote cancellation are outside this review.

## Final follow-up review

Read-only reinspection of the subsequent production hardening found no issue requiring a fix:

- `acceptanceReady()` checks that the injected writer is still open, so externally aborted/failed capture cannot admit further work merely because neither channel has emitted its next event.
- `start()` rejects a control stopped before its first start, before resetting runtime state or restarting evidence channels.
- The reader may expose the already observed stopped-control reason when no `close_status` exists. This preserves diagnosis, not trust: completeness, verification, and derived summaries remain fail-closed.

Also reviewed and reran the implementing worker's new synthetic subprocess and final-seal fault cases:

- Actual SIGTERM delivered to a dedicated fake-model child produces a graceful interrupted segment; actual SIGKILL produces an unsealed prefix with final interruption/cost counts unknown. Recovery leaves the old directory unchanged, rejects reuse, and can link a separately created segment through `previousRunId`.
- Seal fsync and close failures after `run-close.json` bytes exist leave `writer_failure` on full readback and keep verified/completion flags false.

`node --import tsx --test tests/acceptance-integration*.test.ts` passed **30/30** after these changes. The integrating worker owns the final full-suite rerun; the previously reported full-suite run predates this hardening and is not represented here as a final aggregate pass. No production code or test code was changed during this follow-up; only this report was updated.

## Additional post-commit reentrancy finding

A subsequently requested independent counterexample reproduced a defect: when a subscriber calls `stopAcceptance('signal')` from the notification for the committed game step at minute 481, the terminal control still records `throughMinute: 480`. The two evidence channels have already reached minute 481. The newly added review regression requires the actual committed minute, no endpoint sample, and a verified interrupted segment without successful endpoint control.

The focused regression failed before a production fix (`480 !== 481`). The integrating worker fixed this boundary by calling `recordCommittedMinute()` immediately after successful persistence and `world = draft`, before food-evidence and subscriber callbacks. The reviewer did not change production code.

After the fix, all **14/14** independent integration tests passed. A combined rerun of integration, stop-control, and evidence-writer independent review suites passed **39/39**. The regression now confirms minute 481 in terminal control, reason `signal`, no fabricated endpoint, a verified complete interrupted segment, and `controlComplete: false`.

Callback-order reinspection found no new unsafe behavior: the normal finite committed-minute update does not read the wall clock or invoke external observers, and stopped-phase commits cannot reenter this update. Failed game commits still never reach this publication point. The final aggregate test run remains owned by the integrating worker.

## Implementer final aggregate verification

After the post-commit minute fix and the independently authored regression were in place, the implementer reran the final repository suite on 2026-11-07 (Node v24.22.1): **2031/2031 passed**, zero failed/skipped/cancelled. The implementation plus independent integration suites contain 31 tests, and the combined integration/control/writer focused group passed 87/87. Typecheck, server compilation, Vite build, offline preparation, and `git diff --check` passed. Vite retained its existing >500 kB chunk warning. These aggregate results are distinct from the reviewer's 14 independent integration cases and 39-test independent-review rerun. They do not establish a real-model acceptance result, provider availability, or remote cancellation.
