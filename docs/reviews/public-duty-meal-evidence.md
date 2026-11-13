> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Public-duty meal evidence: independent review

## Result

No blocking implementation defect found in the reviewed public-duty slice. Added `tests/public-duty-meal-review.test.ts`; all seven independent tests pass. This review adds tests and documentation only, not simulation or authorization changes.

## Verified boundaries

- Successful beneficiary-requested kitchen service consumes two turnips and one water; care consumes one meal and one water. Unsorted, mixed-definition original lots follow expiry order. Nutrition is calculated from those lots, not the fixed 42/20 hunger reduction.
- Near-saturation care still consumes the full physical ingredients; actual hunger and health changes are separately capped and recorded.
- Unfunded source is the provider's personal container. Funded source is the named public building's physical store. The treasury stock reduction is its aggregate mirror, not a second consumed quantity. Funded kitchen and care tests confirm personal inventory is unchanged and wages remain separate from nutrition and immediate effects.
- Missing, under-counted and over-counted original ledgers repaired during the completion capture produce unknown original lots/nutrition. This is invocation-local provenance: a repair performed in an earlier observation is not durably marked in a later capture or saved world. This feature is not a durable provenance ledger.
- Forecast copies have independent observation identity. Consuming on a copy does not publish a receipt into the original world's capture or increment its service counter. Receipt arrays are absent from serialized world state.
- Runtime publication detaches and recursively freezes input lots and receipts. A top-level evidence accessor is rejected without execution.
- Repeated service identities, a forged treasury physical container and missing legacy coverage suppress trusted totals. An explicitly observed empty list remains distinct from missing coverage.

## Code-path review

`completeDutyAtomic` records only after the existing receive operation succeeds, stock and payment changes apply, the service counter increments, and an event is emitted. Claiming, attendance, withdrawal, failed payment and failed eligibility paths do not reach that hook. The original authorization and resource mutation paths remain in place.

`Runtime.tick` obtains evidence from the mutating draft and publishes through `commit`'s `afterCommit` callback. `WorldStore.commit` must return successfully before that callback; a thrown durable commit does not publish draft consumption. This boundary was inspected in code; commit-failure executable coverage belongs to the companion runtime tests, not this seven-test suite.

The optional field is propagated through the existing runtime evidence channel rather than added to saved world state, resident knowledge, public-duty permissions or decision menus. Schema checks enforce exact role-specific inputs, physical-source identity, effect arithmetic and funded wage deltas.

## Checks and limits

Executed locally using the already-installed Node/tsx test runner with synthetic worlds. No model calls, browser, dependency installation, real saves, credentials, network operations, commit or push were used. Focused tests are not a full-repository regression pass. Existing unrelated working-tree edits were left intact.

## Final implementation-owner verification

The implementation owner subsequently completed the full serial offline repository suite: **2746/2746 passed**, with no failures, skips or cancellations, including all **57** new public-duty tests and the two final writer fault regressions. Final source typechecking, server compilation, Vite build with environment-file loading disabled, and diff whitespace checks passed. The pre-existing large-bundle warning remains.

The unchanged one-year fixture produced 113 daily rows covering 161280 game minutes. Removing only the new `publicDutyMeals` field made all daily fields exactly equal to the pre-change baseline; annual summaries differed only in real elapsed seconds. The fixture produced zero public-duty servings, so this establishes parity and observed zero activity, not annual positive public-service coverage. Positive authority/service paths are exercised by the targeted real-menu synthetic tests. The fixed nine-person offline rules chain and preparation command also passed without executing real models.
