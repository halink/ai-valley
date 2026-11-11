# Independent review: public duty and emergency care food accounting

## Scope and conclusion

Reviewed the test-side collector in `tests/helpers/nine-food-accounting.ts` against the existing `checkedPublicDutyMeal` and `checkedEmergencyCareMeal` contracts. Added independent, hand-built adversarial fixtures in `tests/nine-public-care-food-accounting-review.test.ts`. No helper, runtime, schema, engine, or database implementation was changed by this review worker.

No blocking defect was found in the reviewed integration. This is a bounded evidence collector, not a complete food ledger or a sustainability finding. Receipt quantities describe observed physical debits; founder intake is separately attributed to the fixed initial nine beneficiaries.

## Verified properties

- Both added receipt slices pass their existing strict validators. Unknown fields (including nonenumerable fields), symbols, getters, sparse arrays, array extra fields, custom prototypes, malformed nested lots, missing required fields, nonfinite effects, inconsistent nutrition, invalid source containers and expired lots are rejected.
- Getter rejection does not invoke getters. Top-level envelope extras, missing direct-receipt arrays and observation getters also reject.
- A rejected step leaves cursor, coverage, receipts and deduplication state unchanged. Correcting the same step can then succeed, including after a prior successful step.
- World identity, exact one-minute intervals, receipt timestamp bounds and fixed founder membership are enforced.
- Event IDs cannot repeat within a slice, across slices, or across minutes. Public shift/service and emergency agreement/meal counters cannot be replayed under newly invented event IDs.
- Emergency agreement beneficiary changes reject. A first observed counter of three is accepted. Skipping a counter is rejected after an explicitly observed empty interval, but allowed after missing emergency coverage; the missing coverage still makes aggregate totals unknown. Rescue meals have no agreement identity but still obey event deduplication.
- Public building custody counts inside the nine-plus-public boundary even when its provider is an outsider. Personal outsider custody can feed a founder without becoming a local debit. Public food consumed by an outsider remains a local debit without founder intake.
- The synthetic treasury aggregate is not counted as additional physical stock. Nine personal stores plus the public building total 95 meals, rather than 100 including the aggregate.
- Known original-lot nutrition remains separate from public service fixed hunger relief. Unknown nutrition stays null, and unknown custody does not erase known beneficiary units. Unknown nutrition received only by an outsider does not poison founder intake.
- Old omitted slices remain unknown independently of newer explicit empty arrays. An explicit empty array establishes a zero only for its own observed slice.
- Frozen caller inputs are accepted. Subsequent caller mutation and mutation of a returned report do not affect retained receipts or future reports.

## Validation

Executed locally without npm, browser or model calls:

- `node --import tsx --test tests/nine-public-care-food-accounting-review.test.ts`: **46 passed, 0 failed**.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed** on the final test file.

## Limits

These are synthetic schema/boundary tests, not a live simulation, persistence test, real-save audit or a complete repository test run. They do not prove physical stock reconciliation for every runtime route. Existing receipt validators and their engine-side evidence producers remain dependencies. The emergency 24-hour agreement limit was inspected in code but not exercised over a full 1,440-step interval here. No secrets, environment files or real runtime saves were read; no commits or publication were performed.

## Coordinating integration validation

After this independent review completed, the integrating task ran the final repository suite: **2914/2914 passed**, no failures, cancellations or skips, with test concurrency four. Type checking, server compilation and Vite build passed (existing large-chunk warning only). The unchanged nine-person CLI completed 6,242 minutes and 229 actions, and both new slices had 6,242 observed minutes with no missing minutes or receipts. The separate three-year offline lifecycle passed. Production TypeScript source hashes were unchanged. These full-suite and CLI results were run by the integrating task, not independently rerun by this review worker.
