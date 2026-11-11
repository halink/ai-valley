# Independent foreign food transfer evidence review

## Scope and constraints

Reviewed the foreign trade capture wrappers, original-lot snapshot helpers, strict transfer union and semantic identity, runtime publication, audit and daily aggregation, and fixed-nine boundary accounting. Read source, documentation, and synthetic tests only. No network, real model calls, real saves, secrets, package installation, commits, or pushes were used. Implementation was not edited by this reviewer.

## Findings

### Resolved medium finding: repaired personal lots could be reported as original nutrition

The initial `foreignPersonalTransferAmount` implementation in `src/world/food-consumption-evidence.ts` rejected personal lots produced at or after the current operation minute, but a repair immediately before that minute passed. The per-capture `unprovenLossLots` set does not establish provenance across an earlier `initializeFood` call or across persisted reloads. The newly added primary-suite prior-repair tests reproduce this for both resident export proposal and acceptance: after deleting and repairing the personal source ledger one minute before completion, the receipt asserts nutrition 80 rather than unknown.

The implementation owner resolved this by keeping all personal export reservation nutrition and lots unknown, including apparently matching ledgers. Physical quantity remains observed. This avoids claiming historical provenance that the existing save format cannot establish, without adding persistent state or changing inventory semantics.

### Test defect reported and corrected by the test owner

The foreign runtime commit tests initially selected `action === 'outsideAid'`, excluding all foreign receipts. The helper now selects foreign trade, and all four commit/publication and observer isolation tests passed in the combined review run.

## Independent regressions added

`tests/food-transfer-foreign-review.test.ts` adds 12 passing cases:

- Actual estate parcel owners are observed for both offer and arrived-shipment death custody. Original resident and commons ownership count as boundary IN; an external actual owner does not. The deceased resident ID is not substituted for the actual parcel owner.
- Estate receipts are never personal collection or intake, and repeated advancement does not replay custody.
- Collection continues after its historical offer is absent, using shipment identity without reconstructing the offer.
- Missing, under-counted, over-counted, same-minute, and apparently matching personal source metadata retain actual export quantity but do not assert historical original nutrition.

## Checks

- `node --import tsx --test tests/food-transfer-foreign-review.test.ts`: 12 passed, 0 failed.
- `node --import tsx --test tests/food-transfer-foreign*.test.ts`: 71 passed, 0 failed after the provenance correction and primary-suite updates. An earlier run reproduced both prior-repair failures before correction.

The tested paths preserve the distinctions between export reservation and settlement, arrival and actual collection, and transfer and production/intake. Fractional spoilage remainders, failed completion, competition, replay, SQLite round trips, commit rejection, and observer failures have dedicated passing tests. The semantic identity correction rejects changed recipients, changed reservers, and collection-versus-estate duplicate release. Coverage is explicitly narrow; this review does not establish a complete food or boundary ledger.
