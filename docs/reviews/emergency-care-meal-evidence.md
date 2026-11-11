# Emergency child-care meal evidence: independent review

## Scope and method

Reviewed the actual `completeEmergencyCare` completion path, current permission and expiry checks, `foodValue`/food transaction reconciliation, capture ownership, strict schema, runtime publication, session audit, daily bucketing and persisted writer recovery. Compared guardian `tendChild` and signed `longCare` evidence rather than assuming their rules apply here. Added independent tests in `tests/emergency-care-meal-schema.test.ts` and `tests/emergency-care-meal-daily.test.ts` using only synthetic worlds and temporary evidence directories.

No model, browser, package-manager, real-save or credential access was used. Production code was not edited by this reviewer.

## Resolved finding: agreement lifetime was not bounded by the receipt audit

The initial audit enforced operation-specific fields, provider/child identity and sequential meal numbers but did not check elapsed time within an agreement. A complete synthetic session containing meal 1 at minute 481 and meal 2 at minute 1921 passed with two completed actions. Those receipts cannot come from one real agreement: the world fixes expiry at creation plus 1440 minutes, and rejects feeding at or beyond expiry.

The independent regression `one fixed 24-hour agreement cannot contain feed receipts a day apart` reproduced the accepted invalid total. A companion regression checks timestamps running backwards inside one step despite increasing meal numbers. The recommended narrow repair is to retain first and last observed meal times per agreement, reject a span of at least one day, and reject backward time. A session beginning with meal 2, 3 or 4 remains valid because earlier meals need not have been observed.

The implementer added first/last observed times and rejects backward time or a span of at least `DAY`; both independent counterexamples now pass. No unresolved blocking defect was found in this review.

This was an evidence-validation defect, not a demonstrated bypass of physical feeding permissions. The world already rechecks expiry and current authority before debit.

## Other conclusions

- Emergency feeding uses actual original-lot `foodValue`, not guardian tending's fixed 48 hunger relief. Known nutrition must match the capped physical hunger change. Unknown batch definitions legitimately retain `nutrition: null` while preserving the engine's independently measured fallback relief.
- Receipt capture occurs after permission checks and beside actual personal food/water debits, before agreement meal count increments. `feed` records the resulting 1–4 ordinal; `rescueMeal` records null agreement and ordinal and does not grant future authority. Offer, acceptance, review, inspection and withdrawal are not successful meals.
- Same-capture initialized or repaired lots are conservatively unproven. Evidence reads do not perform their own stock repair. The observer is world-object scoped and does not add receipt state to the save or decision context.
- The schema's descriptor-based copying rejects unexpected properties, symbols, accessors, sparse arrays and nonfinite values before serialization. Independent tests exercise the actual writer, not only the schema helper: malicious rows do not enter the journal and getters are never invoked.
- Legacy absence remains missing coverage rather than an observed zero. A valid empty slice reports zero. Missing session boundaries or writer close seal, and a journal sync failure, clear the new totals at both the outer report and nested direct-eating report.
- Exact-midnight receipts belong to the closing day. The next observed empty minute opens a zero bucket. A later valid observation cannot erase an earlier unobserved minute in that day. Other care slices and the unknown full-consumption figure remain separate.
- Cross-slice event IDs are rejected, including ordinary care, guardian child care, long care, direct eating and processing; agreement meal identity additionally prevents duplicate feed counting with fresh event IDs.

## Limits of the evidence

These receipts attest to observed successful engine actions, not independently reconstructed authority. They do not contain the agreement creation/expiry times, guardian state, reviewer relationship or child capacity; a standalone single receipt cannot prove those historical facts. The bounded lifetime check only rejects contradictions visible between observed receipts. Real permission coverage belongs to engine tests, not invented fields or inferred assent in the evidence.

A sealed evidence session is not a complete food ledger or evidence of real-model acceptance. This review does not validate deployment, live model access or production saves.

## Verification

Before the new lifetime counterexample, the 14 independent schema/daily/writer tests passed, and `node node_modules/typescript/bin/tsc --noEmit` completed successfully. After the repair, `node --import tsx --test tests/emergency-care-meal-*.test.ts tests/emergency-care.test.ts tests/child-care-meal-review.test.ts tests/long-care-meal-evidence-review.test.ts` passed all 95 tests, including all 16 independent tests from this review. This is a focused regression pass, not the complete repository suite.
