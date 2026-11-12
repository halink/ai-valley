# Self-hosted model entry review

Scope: explicitly configured user-operated primary/backup entry, not supervised production acceptance. No actual credentials, saved user worlds or provider calls were used.

Independent review found and reproduced that an unknown result could be retried by calling `runtime.start()` again (synthetic call count 1 → 2). It also identified direct `runtime.stop()` clearing in-flight metrics before server close, which could remove the session guard, and missing directory fsync. Fixes: single-use self-hosted runtime, sticky interrupted state and wrapper dispatch check, file and directory fsync, explicit self-hosted health state. The reviewer reran 17 then-current focused tests successfully after fixes, then independently verified the final 19 focused tests, TypeScript check and diff check.

Additional validation includes actual SIGKILL of a synthetic child with a pending fake model, restart rejection with zero new calls, mocked HTTP encoding/parsing with a fake key through 429 and configured backup, unknown failure no retry, late response after close, clean restart and configuration failure cases. This is not real provider acceptance, nor a power-loss filesystem test.

Verification: seven-file regression 47/47 passed (runtime recovery, independent recovery, reviewed model runtime, model routing, formal startup and both self-hosted suites); TypeScript check passed. Subsequent error-message clarity change reran the seven self-hosted startup cases successfully. Local ignored evidence: `output/self-hosted-review/`.

Limitations: no account-wide cross-process ownership, provider billing guarantee, price verification, independent watchdog or per-request audit journal in the self-hosted entry. A session marker protects only the same save path and must not be silently removed after an uncertain request. Deployment and long-running real-model validation belong to the operator.

## Follow-up: durable 429 cooldown

A separate audit reproduced 429 → normal close → immediate restart issuing a second request before 30 seconds. The initial implementation incorrectly treated memory-only backoff as restart-safe. The correction persists per-model observed time, deadline and capped consecutive limit count atomically with failure metrics, restores them at startup, and rejects malformed or backward-clock state. Five additional synthetic tests cover repeated real close/reopen through the 15-minute cap, both configured providers, clock rollback, and separate processes exiting cleanly or killed after 429. Actual power loss has not been tested.

Independent follow-up audit: the original natural-clock reproducer changed from two requests to one across immediate restart; then-current focused regression 23/23, TypeScript and diff checks passed. An additional success-after-expiry cleanup test also passed (cooldown suite 5/5). Eight-file regression before that last added case passed 51/51.

## Explicit provider declarations

Primary and optional backup now require paired provider/model fields. Supported provider IDs are `siliconflow` and `dashscope`, each restricted to its existing fixed model/endpoint/key mapping. Missing declarations on old enabled configurations fail before save startup, with migration instructions rather than silently inferred routing. Paid opt-in remains separate and is not a zero-cost guarantee.

Independent review of configuration, startup and cooldown suites: 15/15 synthetic tests passed, including missing/wrong/unknown providers, incomplete backup pair, correct credential selection and retained paid-model guard. No actual `.env`, keys or provider calls were used. Shared type checking also passed.
