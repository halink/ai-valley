# Independent review: limited fishing and hunting food-flow evidence

## Result

The focused regression run passed **23/23 tests**, including **7 independent review tests**. No unresolved defect was found in the reviewed fish/hunt emission path. This is a limited physical-flow review, not certification of a complete food ledger or a real-model long-run acceptance run.

## Findings and resolution

1. **Hunt amount validation gap, resolved.** The initial `checkedFoodFlow` accepted any positive raw-meat quantity for a valid prey species, including fractional or excessive amounts. Unlike fish's exact one-unit check, this allowed physically impossible kill yields through the evidence boundary. `src/server/acceptance-evidence-schema.ts:101-103` now validates against the shared `huntedMeatYield` map in `src/shared/frontier-hazards.ts:12`, also used by the actual kill mutation in `src/world/hunting.ts:35`. The independent test rejects deer yields of 0.5, 999, 5 and 1, and a six-unit hare receipt. Real engine kills of all six supported species pass schema validation and match inventory deltas.

2. **Legacy daily detail preservation, resolved by implementation owner.** Requiring the new coverage marker must not erase known older gather/harvest/cook receipts. `src/world/isolation-evidence.ts:95-107` now preserves receipt details separately from coverage accounting. The independent mixed legacy/marked test verifies the known receipt survives, one minute is observed, one minute remains unobserved, and totals remain null.

3. **Cross-sector source identity verified.** The standard fixture's shore and water share a sector, so it could not distinguish a mistaken shore-based ID. The independent fixture places the resident at (31,16) and the only adjacent water at (32,16). A final numbered-menu action completes with source/event identity `shoal:1,0`, not `shoal:0,0`, and reduces the actual water pool. The production hook computes that identity from adjacent water at `src/world/industry.ts:269-274`.

## Independent regression coverage

`tests/food-flow-wild-review.test.ts` adds:

- A true shore/water sector-edge catch through the final numbered decision menu and engine.
- A fresh catch alongside seven existing same-species units, proving old inventory/lots do not inflate the receipt.
- Capture cleanup after a throwing invocation, followed by a normal kill and an empty subsequent step.
- Retention of legacy daily facts without falsely claiming new coverage or totals.
- Rejection of hidden array fields, sparse outputs, species on legacy source actions, and malformed shoal IDs.
- Real completed kills for boar, wolf, deer, hare, fox and duck, checking identity, inventory, fixed yield and schema acceptance.
- Negative hunt yield boundary cases described above.

## Focused command and outcome

```sh
node --import tsx --test tests/food-flow-wild-review.test.ts tests/food-flow-wild.test.ts tests/food-flow-wild-runtime.test.ts tests/food-flow-wild-commit.test.ts
```

Result: 23 tests passed, 0 failed, 0 skipped. The three companion suites additionally cover wounds, escaped prey, depletion, broken tools, competing actors, ecological changes, predictive-copy isolation, enabled/disabled state equivalence, in-memory SQLite reload, missing nutrition, immutable/runtime schema boundaries, writer corruption, daily boundaries and durable-commit failure/retry behavior.

## Boundaries

Only the review test and this document were edited by the reviewer. No real saves, credentials, external services, browser, model, installation, commit or push were used. Full suite/build verification belongs to the implementation owner. A well-shaped evidence receipt does not independently prove historical truth without its trusted engine/commit provenance. Counts cover successful gather, harvest, fish, hunt and ordinary cook legs only; ecological population changes, transfers, trade, other processing and full consumption remain outside this claim.

## Final implementation-owner verification

After adding a real mixed fish/hunt daily aggregation regression, the final new wild-food group passed **24/24**, including the same **7** independent review tests. All food-flow suites passed **51/51**. The final complete offline test run passed **2,397/2,397**, with no failures, cancellations or skips. Type checking, server compilation, Vite build with environment-file loading disabled and `git diff --check` passed; the existing large-chunk warning remains.

The one-year isolated compatibility run passed with 113 consecutive daily rows and 161,280 observed game minutes. Its 264 berry receipts, 1,320 source units and 15,840 source nutrition matched daily totals and lot details; receipt IDs were unique and in-memory SQLite restart succeeded. That fixture contains no fishing or hunting, so it does not prove long-run occurrence of the two new paths. Those paths are covered by the actual-engine/menu tests above. Complete production and consumption fields remain unknown.
