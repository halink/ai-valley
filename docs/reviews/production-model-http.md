> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Independent gated HTTP candidate review

Review scope: offline source inspection and branded in-memory transport tests only. No live transport was successfully constructed, no provider/browser/network request was made, and no credentials, environment files, runtime saves, or prior real-run artifacts were read. This review does not establish live readiness, reconciliation, or billing.

## Findings

1. **Dispatch boundary must be checked after credential callback (high priority).** In the reviewed implementation, `createGatedSiliconFlowHttp` invoked the credential callback after the candidate's final journal/admission check. It subsequently checked only the abort signal before calling fetch. A callback could close the database, block the journal, downgrade SQLite ownership, or consume the remaining request/admission lifetime without aborting that signal. The fetch could still occur. Require a synchronous internal pre-dispatch check after credential resolution and immediately before fetch. Verify journal ownership, durable pending request identity, deadlines, and admission freshness there. No live construction was used to reproduce this finding.

2. **Scope comparison depends on JSON property insertion order (reproduced).** Reordering otherwise identical scope fields yields `admission_scope_mismatch`. Compare canonical field values with exact schema validation, rather than raw object serialization order. The independent regression test intentionally failed against the initially reviewed code.

3. **Trust and cost boundaries remain external.** Evidence hashes bind supplied records but cannot authenticate user authorization, provider pricing, prior execution outcome, or billing. Existing authorization need not be requested again. The previously reported official free-price observation dated 2026-11-09T03:31:44Z needs a fresh check before live execution, and the prior unknown real request remains to be reconciled. Neither a free listing nor token usage proves a zero final bill. Provider hard-zero-budget enforcement is not a prerequisite in this review, and no such enforcement is claimed.

## Offline regression coverage

`tests/production-model-http-review.test.ts` initially ran eight cases: seven passed, one failed for finding 2. Passing cases cover delayed headers after timeout cancelling their body, delayed rejection without retry/unhandled rejection, stalled stream abort, valid UTF-8 split at every byte, stream rejection retaining durable intent, oversized declared body cancellation, and owner loss between intent and dispatch preventing transport invocation.

The tests use isolated disposable synthetic SQLite files and memory-only response streams. A successful synthetic response is not real execution evidence. Main must remain no-model, and pending intent/response after failure or crash must continue to block automatic replay.

## Additional error-boundary observation

The original `safeReason` accepted arbitrary lowercase/digit/underscore error messages up to 96 characters. A credential callback or external transport rejection could throw sensitive text matching that pattern, and the candidate would persist it as a blocked reason. A format check is not redaction. Catch credential and transport exceptions at their boundaries and replace them with fixed public codes; reserve detailed internal reasons for a controlled whitelist or typed internal errors. This observation is source-based, without reading or supplying any actual secret.

## Final independent re-review

All three reported findings are addressed in the current source:

- `beforeDispatch()` now runs synchronously after credential resolution and immediately before fetch. It rechecks journal ownership, admission freshness, deadline/request timeout, active request identity, pending intent phase/id, and request-body hash. This live-path ordering was verified statically only; no successful live transport was constructed.
- Scope comparison canonicalizes its six permitted fields and rejects an incorrect field count. The reordered-scope regression now passes. Admission hashes still bind the serialized record supplied by the trusted launcher; callers must retain that exact record when constructing the gated contract.
- Credential and fetch exceptions are mapped to fixed error codes. Candidate error propagation and stop reasons now use an explicit allowlist rather than accepting arbitrary formatted strings.

Independent rerun: `node --import tsx --test tests/production-model-http-review.test.ts` passed **8/8**, with zero failures. No additional serious defect was identified in this pass. This is an offline candidate review, not approval or evidence of live execution. The credential-stage check remains a static-review result until a shared pure preparation helper permits a direct no-network regression. The prior request outcome/billing and fresh official pricing remain external unresolved prerequisites; main remains no-model.

## Final shared-helper coverage update

Reviewed the final shared `preparePinnedSiliconFlowDispatch` path. Both dormant live transport preparation and its pure unit test now use the same credential → synchronous `beforeDispatch` guard → pinned HTTP options sequence. The no-network test verifies ordering, rejection when the guard fails, fixed credential-exception redaction, invalid credentials, cancellation during credential access, and the fixed endpoint/POST/redirect/credential/cache/referrer options. The helper does not call fetch, and its tests use visibly synthetic values rather than actual credentials.

Live admission now uses the system clock directly, live candidate construction rejects injected clocks, and admission explicitly enforces the resumable request/wall-time ceilings. No additional serious issue was identified in this final review. Production guard internals remain source-reviewed; the shared helper test directly covers ordering without constructing a successful live transport.

Final independent command: `node --import tsx --test tests/production-model-http.test.ts tests/production-model-http-review.test.ts` passed **40/40**, zero failures. The parent additionally reported **66/66** across four new/existing suites; that broader count was not independently rerun in this final pass. This update supersedes the earlier static-only helper-coverage limitation, without changing any live authorization, readiness, reconciliation, or billing conclusion.
