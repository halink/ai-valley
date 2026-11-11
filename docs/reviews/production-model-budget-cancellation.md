# Pre-model cancellation budget review

## Scope and conclusion

Independent review of the `ModelBudget.prepareUnsentCancellation` and runtime cancellation-receipt changes, plus independent synthetic regression tests. No blocking implementation issue found in the reviewed synchronous runtime path. This is not live-model, production, or multi-hour acceptance evidence.

The defect is a persisted conservative budget estimate for a local request start that is subsequently proven cancelled before the model function is invoked. The fix removes only that reservation, rather than clearing a usage window, changing token limits, or relaxing admission checks.

## Safety reasoning

- Runtime prepares cancellation only after a persisted request number, a live request token, explicit admission drain, and a cancellation observer are present. The `modelInvoked` flag is set immediately before calling the model function. Ordinary stop, stale generation, thrown admission, and invoked-model failure do not qualify.
- The budget checks the exact original charge object and requires it to be unfinished. Saved copies, equal-valued other reservations, completed charges, and repeated committed cancellation are rejected.
- Preparation returns a detached filtered snapshot without changing the in-memory charge list. That snapshot is saved in the same world-store transaction as the cancellation receipt. If storage fails, the current in-memory and persisted reservation remain charged.
- In-memory removal runs in the existing commit's after-commit hook, before subscribers. Subscribers therefore see the durable receipt and matching budget state together.
- This ordering relies on the existing synchronous store transaction and on no asynchronous gap between preparation and after-commit. The staged helper is not a general-purpose asynchronous reservation transaction. Future callers must preserve that constraint.
- Charges for other in-flight, finished, restored or unknown requests are not forgiven. Existing usage-accounting and failure behavior remains conservative.

## Independent tests

Added `tests/production-model-budget-cancellation-review.test.ts`. Six cases passed:

1. Reentrant drain during acceptance price dispatch cancels before the model invocation, releases the budget, and exposes matching durable and in-memory state to subscribers.
2. Two equal-valued concurrent reservations: only the unsent one is removed; the already dispatched one survives cancellation and later stop. This test explicitly substitutes small synthetic reservations to admit overlapping slots, rather than claiming normal contexts fit concurrently.
3. Ordinary stop after local start does not produce a cancellation receipt or refund.
4. Throwing admission fails without a refund.
5. An invoked model error retains its charge and stops with unknown cost.
6. A late model rejection after stop/generation revocation cannot refund unknown usage.

The tests use synthetic frontier worlds in in-memory SQLite, fixed time, disabled timers, and a fake model function. They make no network calls and read no real save or key files. The run used `env -i`, the existing offline guard, and HOME/TMP/TEMP/TMPDIR under repository `output/test-tmp/budget-review-tools`.

Result: **6 passed, 0 failed, 0 skipped**. Local output: `output/no-request-epoch-diagnosis/regression-review.tap`.

The first authoring run had one incorrect assertion expecting `runtime_failed` for invoked-model failure. Existing acceptance accounting correctly reports `cost_unknown`; the assertion was corrected. This was not an implementation regression.

The implementation owner's separate tests cover abandoned staged writes, forged/reused charge handles, durable receipt failure and multi-segment reopening. This independent review did not rerun the complete repository suite or the existing process-level continuity suite and does not claim those passed. No real-wall reproduction, production model execution, key access, or formal-save access was performed.
