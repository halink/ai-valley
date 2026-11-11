# Independent review: visitor journey meal evidence

## Result and scope

Follow-up review reproduced a schema gap: known original nutrition 20 and hunger 80→79 (relief 1) were accepted even though both physical routines deterministically subtract foodValue with zero saturation. A regression test now requires this inconsistency to be rejected while preserving unknown nutrition and saturated relief. The schema now enforces hungerAfter = max(0, hungerBefore − known nutrition) within numeric tolerance. The independent regression passed after the fix, including both routines, saturation, and unknown nutrition. No unresolved blocking defect remains in this reviewed slice. This is evidence for two actual self-carried meal completions, not a complete consumption ledger: `visitorJourney.eat` and `visitorAid.eatMail`. Family-relocation rations remain outside coverage even though they consume real food. Other transfers, reservations, care meals and ordinary eating remain separate.

Reviewed the completion hooks, original-lot collector, runtime commit boundary, strict schema and journey audit, writer exposure, and daily isolation integration. No production files were changed by this review.

## Physical and publication boundaries

- Both hooks read original inputs immediately before the existing one-unit personal inventory debit, retain provider = beneficiary, and record only after the existing completion event. They do not create a synthetic plan or definition identity. Immediate hunger before/after excludes subsequent same-step metabolism.
- Lot attribution follows physical earliest-expiry/production ordering. The helper checks the whole original ledger against inventory; initialization repair cannot retrospectively establish original batches. Unknown source definitions or unverifiable lots keep nutrition unknown rather than substituting current nutrition or hunger relief.
- Capture is a synchronous world-keyed WeakMap with finally cleanup. No evidence field is placed on the world, resident, serialized save, or simulation copy. The default runtime still uses the ordinary engine path.
- Runtime evidence publication occurs in the callback after successful durable commit. Failed commits publish no draft completion; optimistic-version conflict is treated the same way. Reload and forecast tests exercise the existing identity boundary. Observer failure cannot undo committed simulation state.
- Missing legacy `journeyMeals` is unobserved, not zero. Explicit empty arrays represent observed zero in this limited slice. Missing boundaries, session/world identity mismatch, time gaps, duplicate event IDs and incomplete seals invalidate totals.

## Independent counterexamples

`tests/journey-meal-review.test.ts` uses independent synthetic receipts rather than trusting producer output to validate itself. It covers:

1. Extra fields, symbols, getters and sparse arrays at event, receipt, input and lot boundaries, including proof that getters never execute.
2. Forged action/operation combinations, foreign beneficiaries/containers, water, excess quantities, invalid hunger deltas, expired/future lots and inconsistent quantities/nutrition.
3. Old absent coverage versus explicit empty arrays; missing boundaries, identity/sequence substitution and time gaps.
4. Duplicate completion IDs both within/across steps and against ordinary eating.
5. Exact-midnight attribution and no invented daily rows for absent meals.
6. A real accepted family-relocation departure consuming two meals and two waters with actual child hunger relief while producing no journey receipts. Proposal and physical inter-person transfer also produce no journey receipts.
7. Injected journal fsync failure after a journey-meal append invalidates both nested and outer recovered totals and does not serialize private exception text.
8. Known original nutrition must constrain the physical hunger delta for both routines. Saturation is tested at hunger 0, 1, 19, 20, 21 and 100 against nutrition 20. Null nutrition, with either known lot dates or no lots, remains unknown and is not inferred from relief.

Schemas establish structural and cross-field consistency, not cryptographic proof that a semantically plausible fabricated record occurred. Authenticity depends on the trusted engine hooks and committed writer boundary; the receipts do not claim a complete historical world ledger.

## Validation

- Follow-up regression reproduced the gap before the fix: 7/8 passed, known-nutrition physical consistency failed as expected. After the schema fix, independent review tests passed 8/8.
- Before adding the final independent fsync case, combined `node --import tsx --test tests/journey-meal-*.test.ts`: 70/70 passed, including physical ordering, saturation, changed eligibility, forecast equality, in-memory SQLite reload, failed durable/version commits, observers, schema, writer and daily evidence tests.
- `node node_modules/typescript/bin/tsc --noEmit`: passed with all eight independent tests present.
- Full repository test suite and browser/model acceptance were not run by this reviewer. All work was offline and used synthetic worlds/in-memory databases. No secrets, real saves, models, package installs, commits or pushes were used.
