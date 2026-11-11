# Legacy live entrypoint retirement

## Finding and current boundary

2026-11-10 source review confirmed that the old `run-nine-siliconflow-live.mjs` checked CLI flags, a recent price timestamp, an empty environment and the source tree, then read the configured key and launched the guardian. The guardian allocated a fresh directory with its own nine-request budget. Neither path required the previous request's remote-outcome and billing reconciliation checked by `production-model-admission.ts`. A new directory therefore could not establish admission or resolve the previously unknown request.

This was a static finding. No real probe, provider/browser request, credential read or real archive inspection was performed to reproduce it. Historical documentation is not billing evidence.

The old live path is now retired rather than given a second admission implementation:

- The launcher has no filesystem credential reader or child-launch capability. Valid old arguments still fail with `legacy_live_probe_disabled_pending_reconciliation`; malformed/stale/future/environment diagnostics remain explicit and other exceptions remain sanitized.
- The compatibility `readConfiguredSiliconFlowKey` export also rejects unconditionally. The pure string parser remains available for synthetic fixtures.
- The guardian rejects default or explicit `live` before runtime imports, directory creation, credential-pipe access or child spawn. The worker rejects `live` before runtime imports or inherited directory/pipe access.
- Both internal programs retain only the original five synthetic scenarios. The guardian always selects the strict offline guard, and the worker always supplies an in-memory fetch. Mock results cannot claim real execution, verified billing or acceptance. The synthetic manifest no longer labels a fixture as actual user-data approval.

No flag, environment variable, new directory or alternate internal invocation re-enables this retired path. Future real execution requires prior-request reconciliation, current official exact-model free-price evidence and the existing authorization scope, followed by a separately reviewed integration with the production admission/journal. Meeting those prerequisites does not automatically restore this launcher.

## Implementation validation

- New retirement tests: **9/9 passed**. Each isolated child installs throwing counters before importing the target. Valid old CLI, different fresh output names, direct key-reader use, and direct default/live guardian or live worker all report **credentials = 0, pipe reads = 0, child launches = 0, network calls = 0, output writes = 0**. Direct internal tests supply synthetic versions of the old bootstrap markers/IPC capability, so missing bootstrap alone is not the reason for rejection. Malformed/stale/future/extra/environment arguments, unexpected-error sanitization and the synthetic scenario allowlist are also covered.
- Existing probe and transport tests: **45/45 passed**, including all six child lifecycle cases. The successful mock run retains nine accepted decisions. HTTP failure remains one invocation without retry; stalled headers, blocked initialization, synchronous blocking and parent EOF retain bounded cleanup and honest failure state. No real provider request occurs.
- The above **54 applicable tests passed** under the repository's strict offline guard. After strengthening the direct-bootstrap assertions, the new nine tests were rerun and passed again.
- Production HTTP/admission tests: **40/40 passed** in a separate offline run. A first combined run reported 64/94 passing and 30 setup failures because the strict guard makes global fetch nonconfigurable while these existing tests call `t.mock.method(fetch)`. The separate run used a temporary copy of the offline preloader with only its throwing fetch stub made configurable; credential guards and all network denials remained active. The test replacements also throw on fetch. No production guard, candidate implementation or existing production test was changed to hide the setup conflict.
- `tsc --noEmit`, `node --check` for all four changed/new scripts, and `git diff --check` passed.

The focused probe command is `node --import ./scripts/acceptance-offline-guard.mjs --import ./node_modules/tsx/dist/loader.mjs --test tests/acceptance-legacy-live-disabled.test.ts tests/acceptance-live-probe.test.ts tests/acceptance-live-probe-review.test.ts tests/acceptance-siliconflow-live.test.ts`, with an empty launch environment. Production coverage uses `tests/production-model-http.test.ts` and `tests/production-model-http-review.test.ts` with the temporary test-only preloader described above.

These are focused offline checks, not a full repository regression, build, browser check, live execution, fifteen-day acceptance or proof of zero billing. The actual old request outcome, cost and cancellation remain unverified. No commit or push was performed during this focused implementation and validation.

## Independent follow-up review

The independent reviewer found no remaining blocker within the retired-entrypoint scope. Source inspection confirmed that the launcher and compatibility key reader cannot obtain credentials, guardian default/live rejection precedes dynamic runtime and pipe imports, worker live rejection precedes all dynamic imports, and retained synthetic execution has only the offline guard and fixed mock fetch.

The reviewer separately ran the new retirement suite with an empty environment, the repository offline guard and Node's native type stripping: `node --import ./scripts/acceptance-offline-guard.mjs --experimental-strip-types --test tests/acceptance-legacy-live-disabled.test.ts`. Result: **9/9 passed**, zero failures, cancellations or skips, in 1.317 seconds. No credential, real archive or network access occurred. The larger 54/40 counts above remain implementation results, not an independent rerun.

The sentinels are trusted-code regression checks, not an OS sandbox or protection against arbitrary malicious modules. This review does not establish live readiness, a zero bill, or completion of the overall release acceptance.
