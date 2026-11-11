# Offline production-model runtime bridge review

## Scope and result

Independent review of `production-model-runtime.ts`, its synthetic journal checkpoint transition, and the optional post-durable-decision callback in `runtime.ts`. Ten independent tests passed. This is a disconnected, synthetic integration result, not production approval or real-model acceptance.

No credentials, real saves, live transport or network were used. The bridge is not connected to `main.ts`; the production HTTP admission rules, including fresh pricing evidence, remain separate and unchanged.

## Independent checks

`tests/production-model-runtime-review.test.ts` verifies:

1. A forged synthetic transport label is rejected before runtime world mutation.
2. An ordinary checkpoint preserves the exact pending response and completed count. A gated-live journal rejects this checkpoint API.
3. Close aborts an outstanding request. Late response headers cancel their body and cannot mutate the saved world or acknowledge the request.
4. A synthetic actor-revision race rejects the decision, leaves the response pending, stops control, and does not retry.
5. An unparseable decision similarly preserves the pending response and stops without retry.
6. Duplicate ownership of the same store object is rejected. Clean close is idempotent and retains the durable fingerprint.
7. An injected world-commit failure leaves zero accepted durable decisions and zero acknowledgements, with the response pending.
8. A subscriber exception after an accepted durable decision cannot undo or repeat its acknowledgement. The control reports `runtime_failed`, bridge status reports `runtime_control_failed`, and close persists that failure without another dispatch.
9. A child process exits immediately after the accepted world commit, before its checkpoint. Parent reopen confirms one durable decision, one response, zero acknowledgements, and rejects the journal with `production_world_mismatch`.
10. A child process exits immediately after checkpoint, before acknowledgement. Parent reopen retains the pending response with zero acknowledgements, records `unresolved_request_no_retry`, rejects bridge creation, and dispatches no new requests.

Executed from the repository with installed tooling:

```sh
mkdir -p output/test-tmp/review-tooling
TMPDIR="$PWD/output/test-tmp/review-tooling" node \
  --import ./scripts/acceptance-offline-guard.mjs --import tsx --test \
  tests/production-model-runtime-review.test.ts
```

Result: 10 passed, 0 failed, 0 skipped. The guard intercepts common Node networking and sensitive path operations as defense in depth for trusted code. It is not a hostile-code or operating-system sandbox.

## Persistence assessment and boundaries

The wrapper writes a world checkpoint only after the underlying world commit succeeds. Checkpoints never acknowledge pending requests. The exact result-object identity, actor, pending request ID/phase, durable revision and fingerprint are checked before acknowledgement. The callback runs before unrelated subscribers. Acceptance means adoption of the plan, not completion of its actions.

The world database and journal are separate transactions. A process interruption after the world commit but before checkpoint can produce a fingerprint mismatch. An interruption after checkpoint but before acknowledgement leaves an unresolved response. Both must remain fail-closed rather than dispatching a replacement request. The two actual child-process tests use immediate `process.exit(79)` / `process.exit(80)` injection at those exact boundaries, without bridge close or database cleanup. Children run under the offline guard with a cleared environment except their isolated HOME/TMP paths. These are process-termination crash-window tests, not SIGKILL, power-loss or hardware durability tests.

Fingerprints consistently use `loadForRuntime()`, including its working event window and indexed-receipt representation. They are not a cryptographic attestation of the entire historical archive. The bridge relies on trusted caller-owned isolated handles; it does not enforce filesystem path isolation or prevent arbitrary caller mutations through another handle.

The existing 60,002 journal-record ceiling is unchanged. Additional constructor, tick, request-metric and stop checkpoints consume records, so a run may hit this ceiling before its nominal request limit. This is a fail-closed capacity bound, not proof of support for 20,000 runtime decisions.

A subscriber exception after successful acknowledgement leaves the decision durable and the pending slot cleared. Review identified that the nested control could report `runtime_failed` while the top-level bridge failure remained null. The first correction made status derive `runtime_control_failed` and made close persist it in the journal. Those original assertions passed, but this did not make failure durable before close. The later independent review below reproduced that remaining recovery gap and verified its subsequent fix. Consumers should still inspect control status and issues; acknowledgement of a durable decision is not a successful run.

No exactly-once remote execution, remote cancellation, actual zero billing, long-duration availability, production readiness, or fifteen-day acceptance is established. Provider cost remains unknown, and the synthetic price assessment is not live admission evidence. Full-suite/build results must be reported separately by the integration owner.


## Second independent review after the final freeze (2026-11-10)

The original ten checks above are retained as historical evidence. A new reviewer independently reproduced two remaining issues in that version:

- After one accepted, acknowledged decision, a subscriber exception stopped the runtime with `runtime_failed`. Bridge status reported `runtime_control_failed`, but the journal still had `failure=null`. A child process exited before `close()`. Reopen accepted the matching checkpoint with no pending request, reset the visible failure to null, and dispatched another memory HTTP request. The observed cumulative counts became `attempts=2`, `completed=1`. This was a recovery flaw, not merely a missing status label.
- With no request in flight, `runtime.tick(NaN)` stopped control with `game_time_invalid`, while bridge close still reported `failure=null`. The failure classifier omitted abnormal stop reasons outside its original three-reason list.

The implementation owner fixed these without enabling live execution. A synchronous stopping hook now durably records `runtime_stop_started` before cancellation, the stop world commit, and subscribers. A synchronous final hook records `runtime_stop_finished` after shutdown and evidence issues are collected. Abnormal terminal states persist failure immediately, without requiring callers to inspect status or invoke close. Reopening an unfinished stop records `runtime_stop_unresolved` and cannot dispatch. The explicitly normal stop-reason set is `game_endpoint`, `wall_limit`, `request_limit`, `manual_stop`, and `signal`; other terminal reasons are failures. A nominally normal reason with shutdown issues is also a failure.

### Final independent results

All seven independent tests passed after the implementation owner froze the four backend source files. There were zero failures and zero skips. SHA-256 checks before and after the run confirmed identical `production-model-runtime.ts`, `production-model-journal.ts`, `runtime.ts`, and `acceptance-stop-control.ts` contents.

1. Immediate process exit after acknowledgement but before request cleanup preserves exactly one completed decision. Reopen cleans local in-flight metadata without a duplicate dispatch or fabricated failure count.
2. Process exit after `runtime_control_failed` but before close leaves a durable journal failure. Reopening the bridge is rejected.
3. `game_time_invalid` is surfaced as a bridge failure rather than a clean close.
4. Exactly exhausting a one-request budget stops normally with `request_limit`, preserves one acknowledgement, and cannot create fresh budget by reopening.
5. A subscriber exception during `manual_stop` persists `shutdown_failed` as a failure without requiring bridge close.
6. Process exit immediately before the underlying stop world commit leaves an unresolved durable stop marker, which rejects recovery without redispatch.
7. Process exit after the stop checkpoint but before its final journal record likewise rejects recovery with `runtime_stop_unresolved`, preserving the already acknowledged decision.

The process exits use actual child processes and immediate `process.exit`, not SIGKILL or power loss. All seven use isolated synthetic worlds and the offline guard. No credentials, real saves, live transport, or network requests were used. No remaining blocker was found in the reviewed offline bridge; this is not production or real-model acceptance.

Evidence paths, relative to the repository root:

- Independent temporary test: `output/test-tmp/bridge-final-review/review-extra.test.ts`
- Final seven-test output: `output/test-tmp/bridge-final-review/final-independent.log`
- Frozen source hashes: `output/test-tmp/bridge-final-review/final-source.sha256`
- Original failure and renewed-dispatch reproduction: `output/test-tmp/bridge-final-review/extra.log`
- Original abnormal-reason failure: `output/test-tmp/bridge-final-review/control-invalid.log`
- Expanded independent notes: `output/test-tmp/bridge-final-review/independent-review.md`

Final command from the repository root:

```sh
NODE=$(command -v node)
env -i PATH="$(dirname "$NODE"):/usr/bin:/bin" \
  HOME="$PWD/output/test-tmp/bridge-final-review" \
  TMPDIR="$PWD/output/test-tmp/bridge-final-review" \
  "$NODE" --import ./scripts/acceptance-offline-guard.mjs --import tsx --test \
  output/test-tmp/bridge-final-review/review-extra.test.ts
```

The reviewer also reran the earlier two bridge test files: 21/21 passed before the stop-lifecycle repair. The existing HTTP/journal regression files passed 66/66 with their own network-prohibiting mocks in a cleared environment. Their initial run under the non-configurable offline guard encountered `Cannot redefine property: fetch` mock conflicts, so that run is not reported as a business regression pass. These historical counts are separate from the seven final frozen-source checks and from the implementation owner's later aggregate run.
