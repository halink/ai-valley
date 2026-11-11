# Food spoilage evidence: independent review

## Scope and evidence boundary

This review covers the actual physical stock deductions in `advanceFood`, not generic food disappearance. Receipts must remain separate from successful eating, ordinary care, child care, long care, processing inputs, natural growth, transfers, animal death, and damaged crops. No receipt implies coverage of every possible food sink. Legacy observations without the exact coverage marker remain unknown.

Review uses only synthetic seeded worlds and in-memory or JSON-cloned state. It does not read real saves, secrets, network services, model endpoints, or browser state. Existing unrelated working-tree changes are preserved.

## Specific risks inspected

- `foodContainers` has initialization side effects: estate location/parcels and employment batch alias repair. Evidence collection must not enumerate it again or change initialization order.
- `stepWorld` calls `initializeFood` before its minute loop, before `advanceFood` can inspect the ledger. An initial read only inside `advanceFood` is insufficient to prove provenance when the engine has just repaired missing lots. The concrete counterexample is an existing physical meal with a missing ledger and an active lifetime definition of zero days: pre-loop initialization fabricates a lot, then the first minute expires it. Physical loss is known; historical lot and nutrition must remain null.
- Aggregate `economy.treasuryStock` is not a physical container. Real public store and reserve deductions count once each even though the aggregate account is also reduced.
- Estate parcel IDs need not have a recognized prefix. Container category must come from the enumerated physical source, while preserving the complete ID. A syntactically valid anonymous parcel ID is classified as `estate-stock`; this does not relax writer identifier validation for arbitrary text.
- A road contact owns a canonical physical person inventory before entering the town registry. It is covered without inventing a resident actor or counting a later transfer as another loss.
- An expired lot is an admissible spoilage source, unlike an eating input. Historical nutrition comes from the lot's definition, never current goods or the active replacement definition.
- Initialization can trim an overfull ledger. Report the actual inventory deduction, not the untrimmed original ledger total.
- Same-tick old product spoilage and fresh growth are distinct gross facts. Net inventory change cannot establish either fact.
- Capture ownership is the exact World object. Forecast clones, exceptions, repeated calls, and reloaded state must not retain pending evidence.

## Executable independent checks

`tests/food-spoilage-review.test.ts` exercises behavior rather than source-text patterns:

1. Fractional mixed historical lots; the exact expiry boundary; repeat and JSON reload.
2. Missing historical nutrition stays null while the observed lot identity survives.
3. Direct initialization repair cannot fabricate original lot evidence.
4. Invalid original production timestamp preserves actual loss with unknown provenance.
5. Anonymous estate parcel IDs and estate initialization side effects.
6. Public store plus reserve losses without a second treasury loss.
7. Canonical outside-contact inventory before arrival.
8. Transfer preserves age, emits no loss, and later destination spoilage emits once.
9. Forecast clone isolation and cleanup after a failed capture.
10. Real engine equality with and without capture, with no evidence stored on World.
11. Actual same-tick old orchard fruit loss and independent new fruit generation.
12. Expiry before a scheduled eat can consume the food.
13. Engine pre-loop repair under a zero-day rule retains unknown provenance.
14. An overfull ledger cannot overstate physical loss.
15. A real crated-animal death inside `advanceFood` is not a spoilage receipt.
16. Multiple real same-tick deductions have distinct occurrences and detached lot metadata.
17. Extra original lot fields (`secretText`, nested world data, and an enumerable getter) never enter capture or daily receipts. The getter is never evaluated; only the five explicit lot evidence fields survive.

## Validation status

The engine pre-loop provenance counterexample is addressed by capture-local marks at initialization repair points. Marks survive same-capture metadata-preserving transfers/merges; unknown provenance stays null. The independent engine regression passes.

Validated against the integrated working tree on 2026-11-07:

- `node --import tsx --test tests/food-spoilage-review.test.ts tests/food.test.ts tests/outside-food-expiry.test.ts tests/food-flow-growth-review.test.ts`: **34/34 passed**, including all **16** new independent tests.
- Final projection-hardening rerun: `node --import tsx --test tests/food-spoilage-review.test.ts`: **17/17 passed**, including the new non-whitelisted metadata test. Broader final reruns are owned by the implementation coordinator.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed** before the final test addition. An earlier run during concurrent implementation reported a transient self-referential test variable; the final rerun passed.

No unresolved defect was found within this review's tested boundary. Coverage and schema/runtime publication are also reviewed separately by the implementation workers; this report does not substitute for those checks. The chosen policy is conservative: malformed metadata or initialization-repaired/colliding lot metadata can produce a known physical quantity with null historical lots/nutrition, rather than a fabricated precise total.

This review does not claim a full test-suite pass, production save migration, model quality, or long-run simulation acceptance. No live model call was made; the outside-expiry runtime regression uses its existing synthetic callback.

## Final integration verification

After the independent tests were included, the final integrated offline suite passed **2,450/2,450**, with no failures, skips or cancellations. The new spoilage group passed **33/33**, including **17** independent review tests; all spoilage and existing food-flow suites together passed **104/104**. Type checking, server compilation, environment-file-disabled Vite build and `git diff --check` passed. Vite's existing large-chunk warning remains.

The implementation's one-year synthetic daily run produced 113 rows covering 161,280 observed minutes and 103 actual spoilage receipts: 41 meal, 77 berry and 984 turnip units, totaling 22,326 original-lot nutrition. All loss rows and quantities reconciled; in-memory annual reload passed. These figures describe the synthetic fixture only, not an all-loss ledger or real-model acceptance.
