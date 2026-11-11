# Independent review: optional long-care visit meal evidence

## Scope and method

Reviewed the existing signed long-care rules, producer, WeakMap capture, strict schema, runtime publication, audit, and persisted recovery. Only synthetic worlds and temporary evidence directories were exercised. No credentials, real runtime saves, browser, model, package installation, or remote operation was used.

Independent regression file: `tests/long-care-meal-evidence-review.test.ts`. These cases use the real final numbered-menu offer and acceptance path, including child assent, rather than manufacturing an active agreement.

## Finding

The initial audit deduplicated event IDs but not the unique completed visit identity `(agreementId, slotKey)`. Duplicating an actual receipt with a different event ID caused the same slot to count twice, including twice its materials, nutrition, relief and health gain. The engine itself prohibits this second completion through `currentCareWindow`. The audit must reject duplicate tuples throughout the observed session, including across committed-step boundaries. Distinct agreements may legitimately reuse a slot key, and distinct slots may reuse an agreement ID. Independent regressions cover all four cases.

## Independently checked behavior

- A child-approved historical contract requiring two meals and two water remains bound to its signed definition after the active definition changes. Original meal lots contribute 55 nutrition; actual hunger relief and health gain clip independently. The real event, paid fee and recorded slot match the receipt.
- Observed and unobserved completion worlds are deeply identical. No evidence arrays appear in serialized world state.
- Current refusal or an expressive beneficiary's immediate cancellation before the last quarter minute prevents debit, payment, visit and receipt, even when the beneficiary cannot make other decisions.
- Lost provider supplies cannot be replaced with another resident's nearby inventory.
- Missing original food definition keeps nutrition unknown while the existing simulation fallback can still relieve hunger.
- Completing a speculative copy inside live capture produces no live receipt or world mutation.
- A legacy omitted slice makes aggregate long-care coverage unknown, even if a later visit was observed. Known later receipts remain individually inspectable.

## Runtime and writer review

The runtime observer remains opt-in. The world step captures locally and publishes only from the durable commit callback. The strict schema checks nested receipt, input and lot objects and arrays; arbitrary keys, getters, symbols, sparse arrays and nonfinite numbers are rejected. Missing legacy `longCareMeals` is not converted to an empty observation. Both the top-level and nested long-care totals are null when persisted evidence is corrupt or lacks its close seal.

Executed the accompanying runtime suite: 13 tests passed, including real signed visit writer roundtrip, failed durable commit and retry, frozen publication, cross-slice event identity checks, legacy/gap behavior, daily boundary handling, nested strictness, corrupt seal and journal sync failure. These verify the synthetic offline path, not a real-model run or complete food ledger.

## Limits

The standalone audit verifies receipt structure, identities, lot arithmetic, bounds and deltas. It does not reconstruct signed contracts or authenticate arbitrary self-consistent supplied receipts against a world database. The producer's signed-recipe and actual-event linkage is separately tested against real engine completion. Unknown original nutrition is not inferred from hunger relief. Daily observed receipts do not establish zero activity on unobserved days.

## Final verification

The implementation now rejects the duplicate agreement/slot tuple across the entire session. Both independent regressions pass, including valid distinct-agreement and distinct-slot controls. After the fix, `node node_modules/typescript/bin/tsc --noEmit` passed, and `node --import tsx --test tests/long-care-meal-evidence-review.test.ts tests/long-care-meal-runtime.test.ts` passed all 21 tests (8 independent review, 13 runtime/writer). No remaining blocker was identified within this review scope.
