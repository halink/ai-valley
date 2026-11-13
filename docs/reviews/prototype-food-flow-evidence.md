> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Independent review: prototype food-flow evidence

## Verdict

No blocking findings in the reviewed prototype receipt path. This is a bounded offline review using synthetic worlds, not a live-model acceptance result or a claim of complete food conservation.

## Reviewed evidence and invariants

- `src/world/prototypes.ts`: starting a real trial snapshots original input lots before its `foodTransaction`, then records the actual fish debit. The trial's persisted identity links its later outcome. Historical `sourceLots` are audit history, not a separately tracked physical work-in-progress container.
- `src/world/engine.ts` and `src/world/food.ts`: engine initialization may repair lots before trial work. `markUnprovenFoodLossLot` and strict original-lot reads conservatively prevent same-capture repairs from proving original input nutrition. The actual completion runs inside `foodTransaction`; output provenance is attached only when that transaction creates fresh lots, then pending hooks are cleared.
- `src/world/food-consumption-evidence.ts`: the observer is optional and keyed by the exact world object. Predictive copies do not inherit the capture. Quantities, original-lot nutrition, and unknown metadata remain distinct.
- `src/server/acceptance-evidence-schema.ts`: strict prototype schema rejects malformed/accessor-bearing objects, invented legs, noninteger batches, unsupported trial definition versions, and inconsistent phase conditions. Lifecycle validation rejects changed persisted identity, repeated starts, repeated terminals, and backward phase ordering.
- `src/server/nine-resident-acceptance.ts`: independent tests reject cross-slice event reuse in both chronological orders and in one observation, plus duplicate terminal outcomes under distinct event IDs. Such conflicts invalidate totals rather than becoming apparently valid production.
- Terminal-only observation after SQLite reload is permitted. It emits no invented historical debit. Successful terminal output has new transaction-generated lots; failed/abandoned outcomes have neither a second debit nor output.
- The revised coverage token is required for complete totals. Older coverage remains unknown, even when an old observation happens to contain prototype receipts.

## Independent targeted tests

`tests/food-flow-prototype-review.test.ts` exercises:

1. Strict schema and zero getter execution, including unsupported trial definitions and fractional batch sizes.
2. Each persisted identity field, repeated starts/terminals, and valid terminal-only history.
3. Same-step, trial-first, and intake-first cross-slice collisions.
4. Duplicate terminal outcomes with fresh event IDs and legacy coverage incompleteness.
5. Same-capture missing-ledger repair with exact observed/unobserved world equality.
6. Predictive copy execution without parent receipts or world mutation.
7. SQLite reload of a working trial, preserved original identity, one successful terminal outcome, no second input debit, fresh output timestamps, and no duplicate `industry_craft` receipt.
8. Unknown original food-definition nutrition remaining unknown and detached from later definition mutation.

Runtime tests construct drawings, assemble prototypes, and select trials through final numbered menus using the shared synthetic fixture. They do not inject a fabricated accepted action. Initial travel/room exit is allowed to finish before asserting the first physical debit.

## Limits and interpretation

- No conserved physical work-in-progress stock is inferred from `sourceLots`. Expired historical trial inputs are not counted a second time as world spoilage.
- Missing original nutrition remains unknown. No fallback to current food nutrition is used to certify an unknown historical definition.
- Repair provenance is capture-local. A repair performed before observation or a reload is not retrospectively detectable from existing persisted fields; this change adds no hidden persisted provenance claim.
- Scope is this operation's input/output legs, not net food production, consumption, all-world loss, or generic craft coverage.

## Offline commands

- `node --import tsx --test tests/food-flow-prototype-review.test.ts`
- `node node_modules/typescript/bin/tsc --noEmit`

Only the independent test and this review document were edited by this reviewer. No external model, browser, package installation, real save, secret, commit, or push was used.

Final independent targeted run: **10/10 passed**, with no failures, skips or cancellations. TypeScript `--noEmit` also passed. Full repository and durable-commit matrix results are recorded in the implementation report, not substituted for this independent review.
