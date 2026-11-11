# Industry food-processing evidence: independent review

## Scope and result

Reviewed the optional `industry_craft` receipt, completion hook, strict evidence schema, and runtime/daily coverage handling against the existing simulation. No blocking defect was found in this review. This is a review of a partial physical-processing evidence slice, not proof of a complete food ledger or a real-model acceptance run.

The existing working tree contains extensive earlier work. This review changes only `tests/food-flow-craft-review.test.ts` and this report. It does not change simulation source, saved state, resident knowledge, dependencies, or environment configuration.

## Source inspection

- `src/world/industry.ts:193–208`: records only the real completion branch. The reservation remains a separate physical transfer. The event, owner, accepted plan, batch, building, original recipe snapshot, actual batch input, and output are retained. Output provenance is attached through the existing physical food transaction.
- `src/world/food-consumption-evidence.ts:109–139`: original input lots are read without initialization or current-definition nutrition fallback. Perishability, rather than direct edibility, includes raw game meat and food-to-nonfood recipes. Missing or same-capture repaired provenance remains unknown.
- `src/world/food-consumption-evidence.ts:144–177`: fresh output lots attach only through the matching transaction. A same-item input/output can remain a transfer in the existing food ledger, so a gross output quantity with unknown output lots is valid and must not be called freshly produced food.
- `src/server/acceptance-evidence-schema.ts:109–181`: the strict craft snapshot validates bounded recipe economics, original input quantities at least as large as requirements, exact output economics, identity relationships, unique amount items, and consistent known lot quantities/nutrition. Actual surplus batch inputs remain legitimate evidence rather than being silently omitted.
- `src/server/nine-resident-acceptance.ts:168–177` and `src/world/isolation-evidence.ts:38`: duplicate batch completions are identified in audit; the coverage scope explicitly excludes employment processing and does not claim net food production. Legacy coverage remains insufficient for the new processing slice.

## Independent counterexamples

`tests/food-flow-craft-review.test.ts` adds six passing tests:

1. Quarter-minute work near the completion boundary emits no partial-work receipt and exactly one completed receipt; a later fractional step cannot replay it.
2. Same-world capture reentry is rejected without poisoning the original capture. A second world's concurrent nested capture remains independent.
3. A prediction copy can finish the same craft without producing evidence for the original world or changing its state.
4. Later mutation of the historical batch recipe, input inventory, and output lot cannot retroactively change the captured receipt.
5. Negative, nonfinite, and nonnumeric nutrition in an original definition stays unknown. It is never reconstructed from current food values.
6. A valid dynamic recipe with both a same-item raw-food output and a fresh meal output preserves gross input/output economics. It does not fabricate fresh lots for the transferred raw food, while the fresh meal receives actual output provenance. The strict schema accepts the authentic receipt.

All six tests exercise synthetic worlds and the actual engine/menu path. They also pass emitted receipts through the strict schema where relevant. Companion implementation tests separately cover writer persistence, durable commit failure, cancellation, historical snapshots, and coverage markers; those are not counted as independently executed by this review.

## Verification

Executed:

`TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-craft-review.test.ts`

Result: 6 passed, 0 failed. `node node_modules/typescript/bin/tsc --noEmit` also passed. No models, real saves, browser, installation, commit, or push were used.

## Limits

Repaired provenance is capture-local evidence, not a new persisted historical truth field. Unknown metadata remains an explicit limitation. The receipt counts gross processing legs, including nonfood ingredients or outputs of food-related recipes. Employment remains uncovered. Nothing here authorizes or proves a complete food balance, net production, complete nutrition consumption, or live acceptance success.

## Coordinator final validation

After this independent review, the coordinating implementation completed all 2,492 repository tests with zero failures, skips or cancellations. The final craft slice contains 27 tests, including this review's six and five runtime tests covering real SQLite-trigger rejection and optimistic revision conflict. These full-suite results are reported by the coordinator, not an independent full-suite run by this reviewer. Type checking, server compilation, environment-file-disabled Vite build, the offline nine-resident CLI and a one-year isolated daily-evidence check also passed. The one-year fixture does not execute craft; its empty processing legs are not craft coverage evidence. Employment and a complete food ledger remain outside this slice.
