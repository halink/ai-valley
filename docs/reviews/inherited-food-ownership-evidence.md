# Independent review: inherited existing-food ownership evidence

## Result and scope

No unresolved defect was found in this review of the limited `production_inherit_existing_food_v1` slice. The independent tests use their own synthetic fixture and assertions, rather than the implementation test fixture. The review changed only `tests/food-ownership-review.test.ts` and this document.

The slice records a successful `production.inherit` event and the actual owner changes made by that event to physical estate parcels, standing orchard fruit, and chicken eggs, duck eggs, goat milk, or cow milk. It is not physical transport, harvest, food production, or intake. A successful inheritance with no actual food-owner changes has one receipt with an empty stock list. Failed claims and repeated claims produce no receipt.

Every amount retains `lots: null` and `nutrition: null`. This is deliberate even when a food ledger exists. In particular, `prepareShares` can create parcel inventory before the enclosing food transaction has routed its original lots. Reading or initializing the ledger at that point would manufacture apparent provenance or change the transaction. The new observer reads physical stock at the owner assignment and does neither.

## Independently exercised boundaries

The 14 cases in `tests/food-ownership-review.test.ts` establish:

1. A first split retains the exact total quantity and original lot dates/definition after the outer transaction finishes. Observation leaves the whole completed world identical to the disabled control, including resident knowledge, permissions and saved-world fields.
2. An already-split parcel whose actual owner differs from the estate ancestor reports the actual previous owner. The observer does not infer provenance from the decedent, share summary or container name. The parcel's location, inventory and original ledger remain unchanged by acceptance.
3. An already-owned parcel produces no redundant stock change. The successful event is still represented once, and replay produces none.
4. Distinct parcels sharing one ID collapse into one ambiguous holding. Conflicting previous owners become unknown and quantities are not added together.
5. A parcel inventory object also used by a resident remains ambiguous even when both visible quantities agree. Observation preserves that object identity and the whole world.
6. A duplicate orchard identity remains ambiguous even when the colliding tree is cut and empty. Repeating the same object does not duplicate a proved physical quantity.
7. NaN, infinity, negative, string and missing quantities become unknown. A positive fractional quantity remains exact. Proven zero and non-food wood do not create food amounts.
8. An inventory getter is never executed by the stock sampler. Missing food history is not repaired, and capture is disabled outside the explicit observation wrapper.
9. Actual industry owner assignments classify fruit, egg, duck egg and milk correctly. Sheep can inherit normally without wool becoming food evidence.
10. An underage unauthorized claim and a claim with insufficient estate cash produce no ownership receipts.
11. Successor redistribution itself produces no receipt. The later successful acceptance records the successor share once without rewriting the accepted earlier share.
12. The legal action appears in the final numbered model menu, parses through the normal choice parser, and completes through the real engine. Preview generation is read-only, and enabled and disabled engine results are identical.
13. A prediction copy deliberately sharing the original world ID completes real inheritance and emits its own internal receipt while the original world's active observation remains empty. The original world stays exactly unchanged.
14. An exception after an action releases the observation capture. A later capture cannot inherit the failed slice's receipt. Capture is not a rollback mechanism; durable runtime commit controls publication.

## Integration cross-check

The focused regression command also executes the implementation, schema, runtime, durable-commit, daily/nine accounting and preexisting successor suites. These additionally exercise:

- Newly split and already routed parcels, two heirs completing in the same sweep, successor reload, old missing `goodsClaims`, and ordinary later collection without another ownership receipt.
- Actual minute ordering: spoilage happens before inheritance, while natural industry growth happens afterward. The ownership amount is sampled between them. Endpoint ownership is not used to reclassify another slice when its interval crosses the owner change.
- Strict receipt fields, food kinds, container forms, quantity rules, owner consistency, unknowns, duplicate events/shares, accessors, sparse arrays, coverage gaps, legacy omission and overflow.
- Detached frozen publication, throwing or asynchronous observers, actual SQLite failure and optimistic-revision rejection, retry/restart, and exact world/save equality against disabled capture.
- An actual inheritance receipt survives a sealed evidence-writer round trip. Tampering invalidates the top-level and nested ownership totals rather than retaining apparently complete quantities.
- Separate ownership totals and per-stock fixed-nine-plus-commons boundary directions. Death and residency do not change the fixed owner set. Actual receipt owners determine direction; ownership crossings never inflate physical transfers, production or intake.
- Atomic daily/nine rejection before aggregate or identity changes, including cross-day event/share replay and collisions with other food slices.

## Validation

All validation is offline and synthetic. The repository was already dirty; unrelated changes were preserved. No package command, dependency installation, browser, real model, key lookup, real save, commit or push was used. Runtime tests use in-memory SQLite and dummy model credentials with network/model invocation asserted absent.

Executed:

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/food-ownership-review.test.ts
node --import tsx --test tests/food-ownership*.test.ts tests/inheritance-successors.test.ts
```

The independent suite passes 14/14. The final focused regression passes 118/118, including the writer round-trip test, fractional repaired-ledger reload, and the preexisting successor suite. The final typecheck passes. A temporary typecheck failure while the writer summary fields were still being integrated was resolved and rechecked; it is not a remaining finding. This review does not claim a full repository test pass, real-model acceptance, a complete food/ownership ledger, or proof about repairing arbitrary malformed saved worlds. Synthetic malformed values here test conservative observation, not new recovery behavior.
