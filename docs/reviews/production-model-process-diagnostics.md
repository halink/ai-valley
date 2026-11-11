# Offline synthetic failure diagnostics: independent review

Scope: diagnostic-only changes to the fixed synthetic continuity worker, watchdog, guardian, validator, fixture capture, and CI artifact upload. No model call, credentials, real save, network bypass, sandbox retry, GitHub rerun, commit, or push was used for this review.

## Preserved authority

- An AST inspection against the checkout's HEAD confirmed all 12 ordered validator predicate expressions are unchanged. The existing `synthetic_continuity_evidence_invalid` message remains; the added `syntheticCheck` property is non-enumerable.
- Launch/session/model journals and state reopening do not import the diagnostic module or read diagnostic files. Guardian process completion still requires the original OS observation, durable state, hashes, counters, and rehearsal validation.
- Independent SQLite testing reserves one launch, blocks it, writes a forged diagnostic claiming success and zero reservation, then reopens the ledger. The reservation remains charged at 30,000 ms, pending launch 1 remains blocked, finished remains zero, and both finish and another reservation are rejected.
- Diagnostics contain explicit false/null execution and acceptance fields. These fields are informational, not evidence of successful execution.

## Privacy and artifacts

Independent tests inject a synthetic secret marker into arbitrary strings, error details, prompts, paths, worlds, status fields, and extra IPC keys. The sanitized projection contains none of that marker. It has a fixed field set, bounded numeric values, enumerated strings, and explicit false/null flags. Re-sanitization is idempotent.

The artifact helper writes only newly projected JSON into a fresh private case directory below the configured private CI root. Tests verify 0700 directory permissions, 0600 files, exclusive creation, rejection of duplicate invocation numbers, rejection of symlink roots and insecure roots, and exclusion of an unrelated synthetic database file. CI targets only `case-*/invocation-*.json` under its freshly created root; existing raw continuity output is not uploaded.

This is a controlled synthetic-fixture data boundary, not a sandbox against malicious same-user filesystem replacement. The raw local rehearsal reports and invocation captures remain outside the upload directory and must never be added to its upload pattern.

## Findings and verification

Initial independent deterministic run: five tests passed and one exposed execution of an array's overridden `slice` method in the sanitizer. This contradicts its getter-free handling guarantee. The test is retained to require a bounded data-descriptor implementation.

Additional review findings reported to the author: diagnostic status collection must not throw before worker cleanup, and a failure while constructing guardian diagnostics must not replace the existing blocked result and nonzero exit.

The independent test file is `tests/production-model-process-diagnostics-review.test.ts`. It runs without starting worker/watchdog/guardian processes. Process integration and sustained continuity verification are separate checks and are not implied by these unit results.

The author subsequently replaced input array methods with bounded own-data-property reads, moved worker status acquisition inside the diagnostic guard, and guarded guardian construction with an explicit nonzero exit and sanitized fallback. Independent rerun after those changes: **6/6 tests passed, zero skips**. The original 5/6 run above remains recorded as the defect-discovery result, not a pass. `npm run check` also completed successfully. Source review found no remaining blocking issue within the controlled plain-JSON IPC/synthetic report boundary. Proxies and arbitrary executable objects are not an IPC input format or a sandbox guarantee.

## Read-only verification of the author's frozen combined run

After source freeze, the author ran the ten-file targeted regression combination. Independent inspection of `output/continuity-diagnostics-check/targeted-regression.log` confirmed **133/133 passed, zero failures, cancellations, or skips**, in **342701.657961 ms**. This is the author's combined execution, independently inspected here; it is separate from this reviewer's six deterministic tests. No rerun was performed during artifact review.

All 12 entries in `frozen-code.sha256` matched current files. All five entries in `gifts-before.sha256` also matched, confirming the preexisting personal-food-gift candidates were preserved.

The fresh artifact root recorded in `artifact-root.txt` held 16 invocation JSON files. An independent parser verified exact outer and inner schema keys, finite numbers, only expected enum string values, 0700 directory permissions, 0600 file permissions, and false/null execution/acceptance fields throughout. No prompt, stack, error message, path, database payload, world data, or arbitrary string appeared in those JSON files.

Expected failures remained failures:

- `late_headers`: exit 1, one launch, zero finishes, 30,000 ms reserved. Worker diagnostic reports unsealed runtime failure, one session/model attempt, zero completions, and pending work. Guardian reports worker exit 1 with cleanup complete and absent group.
- Fourth `sustained_crash_response` launch: exit 1, worker exit 73, four launches and three finishes, 120,000 ms reserved. Guardian records unclean process despite completed cleanup. Its following resume also exits 1, creates no new reservation, and retains four launches, three finishes, and 120,000 ms reserved.

No final typecheck/server-build result is inferred from this artifact inspection; those checks were separately running under the author's control.
