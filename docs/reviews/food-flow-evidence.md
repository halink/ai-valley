# Limited physical food-flow evidence: independent review

## Scope

Reviewed `CONTRIBUTING.md`, `src/world/food-consumption-evidence.ts`, the gather/harvest/cook completion and capture hooks in `engine.ts`, the fresh-lot hook and reconciliation in `food.ts`, `isolation-evidence.ts`, `src/server/runtime-food-evidence.ts`, `acceptance-evidence-schema.ts`, `nine-resident-acceptance.ts`, `acceptance-evidence-writer.ts`, the runtime durable-commit callback, and `tests/food-flow*.test.ts`. Added only `tests/food-flow-review.test.ts` and this review; did not change production code or revert the existing dirty tree.

## Findings and verification

- Source additions remain separate from gross cooking inputs and outputs. The evidence does not claim net production, a full consumption ledger, or that cooking is eating.
- Actual same-item cooking with two meal inputs and yields of one, two, and three preserves gross quantities. Because underlying physical lot reconciliation nets same-item inventory changes, no full fresh output batch is fabricated: output batch metadata and nutrition remain unknown. This observation feature does not change that existing simulation behavior.
- Original input lots are read in expiry order without sorting or repairing the world's arrays. Missing coverage and malformed numeric metadata stay unknown.
- Independent adversarial cases cover nested symbol properties, nonstandard prototypes, sparse arrays, unknown items, contradictory nutrition, empty food batches, future and expired output timestamps, and future-dated original input lots.
- Initial server audit accepted contradictory amount/lot nutrition and empty food batches as known totals. The implementation worker hardened audit validation; the independent counterexamples now reject these aggregates.
- Review also found that the world capture helper accepted future-dated original lots as known nutrition. The helper now rejects future production timestamps without mutation, and the independent regression passes.
- Existing focused tests exercise exact midnight assignment, fractional runtime day grouping, loss of totals after missing observation, failed gathering/harvest/cooking, forecast and copied-world isolation, unchanged serialized state, in-memory reload, and writer corruption recovery.
- The actual-completion runtime failure test intercepts durable commit only after berry stock was removed in the draft. No draft flow is emitted or persisted; retry emits exactly one committed flow. This is stronger than a failure test with no completed action.

## Commands and results

Executed locally without npm, network, browser, model calls, real saves, credentials, commits, or pushes. Tests use synthetic worlds, in-memory SQLite, mocked providers, and temporary evidence directories.

- `node --import tsx --test tests/food-flow-review.test.ts`: initial six cases passed after correcting the review fixture's dependency pin. Adding the future-input case exposed one production failure (six passed, one failed).
- `node --import tsx --test tests/food-flow*.test.ts`: initial combined pass, 26/26, before adding the future-input regression.

- Final `node --import tsx --test tests/food-flow*.test.ts`: **27 passed, 0 failed**, including all seven independent review cases after the future-input fix.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed**, exit 0.

No unresolved blocker was found in this limited evidence scope after these fixes.

## Limits

This is a focused offline review of the named evidence path, not a whole-repository audit or real-model acceptance. No real service, account, production database, long-run behavior, billing, or remote cancellation was exercised. Output metadata is intentionally unknown when gross output cannot be matched to actual newly created lots. Schema whitelists reject unexpected fields and accessor properties; allowed identity strings are trusted runtime identities, not a general-purpose secret detector or authentication mechanism.

## Implementer final verification (separate from the independent review)

After the future-input fix, the implementer reran all offline tests: **2,263 passed, 0 failed**. The combined flow/eating/runtime/writer focused group passed **75/75**. Typecheck, server compilation, Vite build and whitespace checks passed; the pre-existing large-client-chunk warning remains.

The final server build also passed one isolated year with daily JSON: 113 rows, 161,280 consecutive observed minutes, 264 berry-source receipts totaling 1,320 berry units and 15,840 nutrition. Receipt IDs, daily totals, original lot metadata and year-end in-memory SQLite reload reconciled. Existing eating totals remained 1,325 receipts and 15,908 nutrition. This lifecycle scenario does not perform ordinary cook or field harvest; those paths are verified by focused synthetic engine fixtures. Complete production and consumption remain unknown.
