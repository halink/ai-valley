# Production model candidate safety review

Reviewed on 2026-11-10. Scope: `production-model-policy.ts`, `production-model-journal.ts`, `production-model-candidate.ts`, and focused safety tests. This is an offline candidate review, not production acceptance or permission for a real model request.

## Findings and resolution

1. **Ownership race, reproduced before repair.** A second SQLite connection could recover and persist a blocked state after the first owner's intent commit but before its dispatch. The first owner checked stale memory and still dispatched one synthetic request. Lifetime SQLite EXCLUSIVE locking in DELETE mode now prevents the second owner from opening the journal. A WeakSet additionally rejects a second journal over the same database handle. Independent subprocess tests verify ownership remains exclusive after both creation and intent commits.
2. **Closed-handle dispatch, reproduced before repair.** Closing the caller-owned SQLite handle between intent commit and dispatch released ownership, while the old guard still dispatched. Runtime checks now verify the handle, journal sequence/hash, and DELETE/FULL/EXCLUSIVE settings; failures mark persistence unusable and prevent dispatch. The closed-handle regression and a lock-mode downgrade regression pass.
3. **Recovered status.** A recovered failed journal now makes its candidate immediately report blocked, before any completion attempt.

## Final independent checks

All seven tests in `tests/production-model-safety-review.test.ts` passed on the final implementation:

- Competing-owner interleaving between intent commit and transport invocation.
- Response persistence failure discards the reply and locks restart.
- Actual subprocess ownership contention across commits, followed by close and recovery.
- Same-handle duplicate ownership rejection.
- Actual SIGKILL after durable intent; restart retains the attempt and never dispatches automatically.
- SQLite handle closure before dispatch.
- Exclusive-lock mode downgrade before dispatch.

The original ownership and closed-handle regressions were observed failing before their respective fixes and passing afterward. The main safety suite was also independently exercised earlier; the final independent rerun here is the seven-test review suite. No new blocker remains within this bounded offline review.

Command, from the repository root:

```sh
env -i PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin \
  HOME="$PWD/output/test-tmp/review-home" \
  TMPDIR="$PWD/output/test-tmp/review-tmp" \
  node --import tsx --test tests/production-model-safety-review.test.ts
```

## Boundaries

Only synthetic SQLite files under repository `output/test-tmp` and the branded in-memory transport were used. No network, browser, real model call, credentials, real archive, or real probe budget was used. Model identity is not current free-price evidence. Actual provider cost remains `null`; remote cancellation and previous remote billing remain unverified. The candidate has no real HTTP adapter. World commit acknowledgment relies on the caller having durably committed the corresponding world transaction; this review does not establish cross-database atomicity. Lifetime locking assumes the local filesystem correctly implements SQLite locking and durability. These results do not authorize live enablement, retries, or paid fallback.
