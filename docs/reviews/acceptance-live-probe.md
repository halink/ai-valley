> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Independent live-probe wiring review

Current status, 2026-11-10: the former live launcher and direct live guardian/worker paths are retired and fail closed pending prior request/billing reconciliation and a separately reviewed integration. Only offline synthetic regressions remain executable. The review and attempted-run record below are historical, not current live authorization. See [current entrypoint status](../implementation/acceptance-live-probe.md).

Scope: the explicit nine-request SiliconFlow probe, private child pipe, launcher and guardian, live guard, worker, protocol, HTTP adapter, and opt-in unknown-bill policy. Reviewed the prior process-supervisor, HTTP-shape and stop-control documentation. This review does not authorize or perform live execution. No credential file/value, existing world, actual API, browser, npm, commit or push was used. The reviewer changes only this document and `tests/acceptance-live-probe-review.test.ts`.

## Findings reported during implementation

1. Successful HTTP completion could release a decision after an injected `clearTimer` callback synchronously stopped the transport. `complete` must recheck current request ownership after timer cleanup and before success. Independent regression initially failed.
2. A replayed earlier wall-timer callback could overwrite the newer timer handle, leaving one owned timer after stop. Timer generations/identity must reject stale callbacks. Independent regression initially failed. These first two findings concern the supported injected-clock boundary, not a claim that native Node timers replay callbacks or reenter clearTimeout.
3. Guardian initially tested the nonexistent `networkAttempts` field instead of `transportInvocations`; this was corrected during construction. Invocation alone still cannot prove model execution: DNS, TLS, access denial or HTTP failure may precede model completion. Report attempts separately and retain unknown execution unless a valid model completion is observed.

## Static safety observations

- The public launcher is opt-in, requires fictional-data approval and a recent price observation, requires an empty environment, and selects fixed child programs. The key reader is not called by importing the launcher. Its fixed project path uses no-follow, regular-file, size, owner, private-mode and link-count checks. This reviewer did not invoke that reader.
- Child environments are empty. The key travels through dedicated anonymous pipes, not argv, environment or output. The pipe has a five-second receive timeout and a bounded/validated body. Clearing JavaScript strings is not a cryptographic memory-erasure guarantee.
- Guardian and worker are separate detached groups. The supervisor owns the worker group and watches owner stdin EOF, with bounded TERM/KILL observation. The existing documented PGID reuse, guardian death, event-loop blockage and escaping-descendant limitations remain. This is not an OS security sandbox or proof of remote cancellation.
- The worker starts a new exclusive directory/database and stores transport evidence separately before body parsing; ordinary service and existing-world paths are not used. Strict endpoint/model/redirect gates and cumulative response byte bounds are present. Errors do not retry or select a paid fallback.
- The live guard explicitly describes trusted-code defense, not hostile-code isolation. Native fetch requires lower-level networking, and its gate does not itself prove a nine-request bound; reviewed transport and supervisor provide those bounds.
- Official-price observation is an operator assertion, not a fetched billing receipt or account-availability guarantee. Unknown actual bills remain null. The new runtime opt-in is restricted to the exact DeepSeek candidate; default behavior still stops on a missing bill, and opt-in increments unknown-cost count rather than marking zero cost or complete control.
- Probe wiring and transport are fixed to nine requests, 180 seconds locally, 45 seconds per request and 64,000 response bytes. The earlier longer-profile export was removed before final review. Price evidence expires within fifteen minutes.

## Independent tests and boundaries

The focused synthetic tests cover reentrant stop during cleanup, stale timer ownership, nine-call limit, missing Content-Length cumulative bounds, late response cancellation, unknown-bill opt-in/default behavior, exact-model policy restriction, and launcher arguments/environment. All HTTP responses are in-memory mocks under the strict offline guard; no global network adapter is enabled. Launcher test constructs a launch description only and creates no directory or child.

Initial focused result: 8 tests, 6 passed and 2 failed (findings 1–2). The first attempt used an unavailable `/usr/bin/node` path and did not execute tests; reruns use the installed node path. An expanded launcher test initially encountered Node's test-injected environment variable, correctly rejected by the launcher; the test now constructs its launch description in a separately spawned, offline-guarded Node process with an empty environment.

Final fix verification is recorded below when implementation is complete. No full suite, build or type-check was run by this reviewer; integrated validation belongs to the implementation task.

## Synthetic child-process verification

All six independent child lifecycle cases passed: a successful nine-decision synthetic probe, HTTP 429 with one invocation and no retry, stalled headers, blocked initialization, blocked synchronous execution, and owner stdin EOF. Every case observed clean process-group termination; stalled/blocked cases retained failure rather than completed mechanics. The success case preserved unknown billed cost and `controlComplete:false`. Tests use the guardian's closed synthetic scenario allowlist, strict offline guard in both guardian and worker, a fake key passed only through a pipe, and a fresh temporary directory removed afterward. No live scenario was launched. Expanded initial result: 14/16 passed, with only the two already-reported injected-clock regressions failing.

## Final independent verification

The implementation was frozen for the final independent run. All **16/16** review tests passed in **17.41 seconds**, with zero failed, cancelled, skipped or todo tests, using the installed Node binary, empty environment and preloaded offline guard. The two originally failing regressions now pass: wall callbacks are generation-checked and completion rechecks ownership after timer cleanup. All six synthetic child-process lifecycle checks were rerun successfully. Whitespace checks passed.

Final static inspection also verified the pure configured-key parser extraction and allowlisted error codes do not emit arbitrary exception text, paths or key material. The key reader itself was not invoked. Mocked transport reports `executionKind:mocked-http` and zero network attempts; the guardian separates network attempts and valid responses. A live invocation without a valid model response retains `realModelExecuted:null`, rather than claiming execution. Billed cost, remote cancellation and acceptance remain unknown.

No remaining review blocker was found within the documented trusted-code, process-group and synthetic-test boundaries. These results establish offline probe mechanics, not actual provider access, live account eligibility, zero billing, a real-model run, or long-term nine-resident acceptance. The implementer's larger test/build results are separate and are not represented as independently executed here.

## Implementer final checks and first authorized live probe

2026-11-09: both complete TypeScript checks (`tsc --noEmit` and server compilation) passed under empty environment and the offline guard. The final combined acceptance/model/decision plus affected procurement regression run had **365/366 passing** in 166.32 seconds. Its only failure was `unchanged default nine-person world completes the public procurement chain through numbered menus` in `public-food-procurement.test.ts:121`; that independent game-feature worker was notified. The three earlier procurement/menu regressions passed. This is not an all-project or all-feature pass. Vite `build({envFile:false})` passed with 199 modules in 5.69 seconds; the existing >500kB chunk warning remains. The probe was restricted to connection/stop mechanics, not a game-feature acceptance or long run.

After explicit user approval of the provider, existing key and fictional game data, a single bounded live probe was attempted at **2026-11-09T03:39:05Z**. Fresh official exact-model price observation was 03:31:44.100Z. Evidence directory: `ai-valley-live-probe-20261109T033905Z` beside the repository. Source fingerprint: `9af58a8a934875e834aa85d66ad7a9e0fda9b1bd3959616b0a2e191b6adeb350` (before/after unchanged).

Observed results:

- One network invocation attempt; no HTTP response headers and no validated model completion were recorded.
- Zero accepted decisions, world minute remained480. No retry or fallback was attempted.
- Local stop reason `response_invalid`; guardian observed child exit1 in about1.23seconds and confirmed the owned process group absent. Cleanup completed with no supervisor issues.
- Evidence sealed and read back complete; the newly created SQLite reloaded to the same fingerprint. These shutdown properties do not make the connection probe successful.
- `probeMechanicsVerified=false`, `realModelExecuted=null`, actual billed costnull and remote cancellationunconfirmed. An attempted request is not proof it reached the provider or was billed.

A separate **unauthenticated HEAD diagnostic** using native Node HTTPS in the same empty environment then failed before any response with `TypeError`, cause code **EAI_AGAIN** (DNS resolution). It sent no API key, game data or completion request. This establishes a current native-network blocker; it does not retroactively prove the exact failure cause or remote outcome of the preceding attempt, and does not imply an invalid key or an unavailable free model. An earlier unauthenticated curl HEAD had returned404; that is not evidence the native Node route is usable.

The probe remains stopped. No proxy/browser alternate route, credential change, repeated model attempt, existing-save load, commit, push or fifteen-day run followed. The unresolved game-feature case and native-network blocker are reported separately. Future execution needs a permitted working network route, fresh price evidence and final source validation; do not re-label this attempt as a passed or completed real-model acceptance.
