# Employment food-processing evidence: independent review

## Conclusion and scope

Reviewed the optional `processed / employment_processing` receipt against actual recruitment, the signed recipe and existing batch-conservation repair, physical ingredient reservation, completion, wages, ownership, runtime commit publication, strict schema and daily coverage. No blocking defect was found. This establishes only the specified partial physical-processing evidence slice, not a complete food ledger, net production, resident consumption or real-model acceptance.

The implementation preserves the existing employment state machine. Inputs remain shop-owned while reserved in `employment:<contractId>`; output is delivered to `business:<businessId>`. Worker and employer identities are separate. Paid work still depends on actual attendance, not completed food. The observer neither changes payroll nor adds persistence fields or world/model knowledge.

## Evidence boundary reviewed

- `src/world/employment.ts`: the hook follows real work validation, signed-recipe recovery, batch-intact checks, work progress and original payroll. Only the original completion branch creates a conversion; it captures the actual held input before the transaction removes the batch, returns the already-emitted completion event, and observes the actual output. Reservation, continuation, refund and cancellation do not emit processing receipts.
- `src/world/employment-recipes.ts` and `src/world/food.ts`: existing alias isolation and historical-definition recovery preserve signed requirements independently from physical stock. Spoilage still removes real stock, records its separate loss, and refunds remaining stock rather than completing the damaged batch. The new evidence does not restore or invent missing materials.
- `src/world/food-consumption-evidence.ts`: capture remains a per-World external WeakMap. Only original, usable lots can establish input metadata; same-capture repairs remain unknown. Invalid or unavailable original nutrition stays null. Output lot metadata attaches only at real fresh-lot creation, not from current stock or net deltas interpreted as gross fresh output.
- Employment has no persisted batch identifier. `contractId / day / batchNumber` uses the existing daily `produced` counter at real completion, while the original event distinguishes the actual occurrence. A partial batch resumed next day is numbered on its completion day; it is not falsely assigned a synthetic start identity.
- `src/server/runtime.ts` and `runtime-food-evidence.ts`: existing candidate-world commit boundary publishes only after durable success. New receipts follow that path without an independent publication route. Runtime copies and freezes validated observations; observer errors do not roll back committed simulation. Capture itself is not a rollback mechanism.
- `src/server/acceptance-evidence-schema.ts`: exact fields, identities, containers, day, ordinal, recipe amounts and food qualification are checked. Employment's input quantities must exactly match its promise, unlike the separate craft slice's handling of surplus historical input. Original lot economics and timing are checked without consulting today's active recipe.
- Audit duplication is checked by event and contract/day/ordinal. The new marker is `gather_harvest_cook_fish_hunt_growth_craft_employment_v1`; previous markers remain readable but cannot establish complete new-scope totals. Daily totals retain separate source additions, processing inputs and processing outputs. Unobserved time remains unknown, and full production/consumption remain unavailable.

## Independent counterexamples

`tests/food-flow-employment-review.test.ts` adds seven independently authored tests:

1. Four fractional final work increments yield exactly one receipt, only at actual completion, with no later replay.
2. A real partial batch persisted and resumed during the second legal shift retains original input lots and uses that day's ordinal; two completions in one plan remain distinct. The overnight jump is an explicit synthetic fixture, not evidence of overnight autonomous survival.
3. A valid synthetic signed recipe with the same food on both sides records gross inputs/outputs but leaves that transferred output's fresh-lot claim unknown. Newly produced meal metadata remains observable.
4. Rejected nested same-world capture cannot poison its outer capture or a different world's observation.
5. A throwing capture returns no result and clears observation hooks; the following completed batch emits only its own receipt. Direct capture intentionally does not undo physical world changes; runtime rollback is tested separately.
6. Later contract, attendance and physical-lot mutations cannot rewrite a previously captured receipt or snapshot.
7. Negative, nonfinite and nonnumeric original nutrition values remain unknown, with no fallback to current nutrition.

Command: `TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-employment-review.test.ts`.

Result: **7/7 passed**, no failures, cancellations or skips. The task's main implementation document records the final combined and full-suite results; this independent seven-test pass is not represented as full-repository validation.

No credentials or real saves were read. No model, browser or npm command was invoked. No commit or push was made. Remaining uncovered food flows and historical provenance gaps remain limitations rather than inferred zeroes.

## Final implementation validation

After the independent review, the implementation owner ran the final employment/conservation set (**51/51**) and full offline repository suite (**2,525/2,525**), with no failures, skips or cancellations. Typecheck, server compilation, Vite build with environment-file loading disabled, and diff checks passed. The existing large-client-chunk warning remains. The nine-resident scripted chain and one-year daily evidence fixture also passed, but neither contains employment processing, so they are not represented as long-run employment coverage.
