# Family journey meal evidence: independent review

Reviewed 2026-11-07 against the staged working tree. No production files changed by this reviewer. Existing unrelated changes were preserved.

## Result

No blocking counterexample found in the reviewed optional slice. This is an offline synthetic review, not real-model acceptance and not proof of a complete food ledger.

The physical family ration loop still debits one meal and one water per member from that member's signed provider. Its existing cumulative `foodValue` difference determines actual hunger relief. Observation snapshots original lot intervals before `foodTransaction` may initialize or repair lots. Provider offsets are local to each ration and advance in member order, including when another provider intervenes. Missing or unproven lot provenance stays unknown; water has zero food nutrition. The saved relocation ID, ration number and member index identify the observed serving without an invented event or plan ID.

The new optional array is separate from legacy visitor journey meals. Collection is scoped by the world-keyed WeakMap, and runtime publication follows the existing durable commit callback. The schema rejects extra fields, accessors, malformed arrays, invalid portion metadata and contradictory known-nutrition hunger claims. The family audit rejects duplicate beneficiaries, missing members, bad order and interval/session gaps. Writer failure suppresses both top-level and nested totals.

## Independent adversarial tests

`tests/family-journey-meal-review.test.ts` adds seven passing cases:

- Unsorted three-batch stock split at 0.375 and 1.5 meals, with providers in A/B/A order. The two A servings have independently checked nutrition of 13 and 24, not reused first-serving values or group-index offsets.
- Published receipts are deep immutable copies, independent of later source receipt mutations.
- A top-level family array getter is rejected without executing it or publishing the step.
- Repeated beneficiaries, incomplete groups and an incorrect repeated-provider offset invalidate totals.
- Real departure populates only the new family slice, with no evidence field in serialized world state.
- Unknown original definitions retain their lot identity and unknown nutrition despite actual fallback hunger relief.
- A changed source fingerprint at writer close leaves both nested and top-level family totals unknown, including read-only recovery.

## Verification

- `node --import tsx --test tests/family-journey-meal-review.test.ts`: 7/7 passed.
- `node --import tsx --test tests/family-journey-meal*.test.ts`: final rerun passed 86/86, including all seven independent cases and the final periodic-ration-before-obstruction and mixed-provider provenance regressions.

The implementation and linkage documentation were also checked for consistency with the separate optional slice and its limits. A small clarification was suggested: a pause creates no meal itself, but a real ration consumed earlier in the same tick remains evidenced if movement subsequently meets an obstacle.

The broader focused run covers depart, eligible/early resume, periodic travel, reload, whole-group shortages, death, expiry, repaired lots, forecasts, commit rollback, revision conflicts, observer failure, daily boundaries, missing legacy coverage, strict schemas, corruption and missing writer seals.

## Scope limits

The audit checks the observed optional evidence slice. It does not reconstruct omitted transactions from a world save, authenticate an independently fabricated receipt against a source world, or turn prior legacy observations into coverage. `completedActions` in this slice counts beneficiary servings, not selected plans. No live service, browser, real saves, environment secrets, model/network call, installation, commit or push was used. Only synthetic worlds, in-memory SQLite from the focused tests and new temporary writer directories were exercised.

## Final implementation-owner validation

After the two final primary edge cases and documentation clarification, the implementation owner reran the complete offline repository suite: **2,689/2,689 passed**, with zero failures, skips or cancellations. Final focused coverage is **86/86**. Typecheck, server compilation, Vite build with environment-file loading disabled and diff checks passed; the existing large-chunk warning remains. The unchanged one-year fixture's 113 daily rows and annual summary matched the pre-change baseline after removing only the new family field and real elapsed time. That fixture had zero family meal positives, so it is parity evidence rather than long-run family behavior evidence. The fixed nine-resident offline chain and preparation command also passed.
