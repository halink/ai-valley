> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Nine-resident food-chain independent review

> Historical review: the numeric results below are superseded by the family-stock/gift and full observation-slice extension reviewed in [nine-food-accounting.md](nine-food-accounting.md). The current run has four SQLite reopen checkpoints, 229 selected/completed actions with none pending or failed, and root reconciliation 45 + 12 − 1 − 48 = 8. Earlier three-reopen, 211-action and nine-root figures describe only the prior run.

## Verdict

Passed the focused offline review. This demonstrates a scripted, normal-menu food chain in the unmodified `createFrontierWorld(5401)` opening, not model autonomy or long-term population sustainability.

Reviewed `tests/helpers/nine-resident-food-chain.ts` and `scripts/acceptance-nine-food-chain.mjs`. Added independent coverage in `tests/nine-resident-food-chain-review.test.ts`. No production engine changes were made by this review.

## Findings and resolution

- Initial review found repeated `WorldStore.commit(world, null)` against the same file. The implementation now carries the last persisted revision, and all three checkpoint close/reopen cycles succeed with deep equality.
- The helper now refuses existing paths and `:memory:`. A synthetic sentinel test confirms rejection does not overwrite the existing file. The CLI accepts only the exact `--offline` argument and uses a fresh temporary directory, removed in `finally`.
- The inaccurate rain-day comment found during review has been corrected: rain is observed at the ordinary midnight boundary and is never assigned by the harness.

## Authenticity and evidence

- Initial inventories, resident IDs, birthdays and homes match a separately constructed formal frontier seed. All nine residents remain the original people; ownership is unchanged.
- Scripted choices and upkeep use `decisionChoices(decisionContext(...))`, `parseChoice`, `submitPlan`, then the direct-eating observation wrapper around `stepWorld`. There are no fixture writes to resources, positions, health, crop maturity or votes. Setting `clock.paused=false` starts ordinary simulation; minutes advance through engine steps rather than direct time assignment.
- Four midnight growth observations are 0→1→2→3→4. Three irrigations consume actual water; the third growth increment uses natural rain. Harvesting produces 12 roots at minute 5795, followed by seed saving and replanting at minute 5825.
- Public funding, proposal, four distinct adult yes votes, delivery, child pickup and child eating are separate menu plans. Their scripted nature is explicit, not represented as independent model reasoning.
- Harvest starts with no old roots in the farmer's inventory. The unique lot's production/expiry/definition metadata survive transfer to the reserve, SQLite reload, and the child's inventory. Pickup leaves physical stock unchanged; the subsequent direct-eating receipt identifies the child's exact plan and one consumed root.
- Root reconciliation is 45 initial + 12 harvested − 1 saved for seed − 47 eaten = 9 final; seed is 24 − 1 + 2 − 1 = 24; coins remain 1295. These are the specified containers and conversion path, not a universal nutrition ledger.
- An independent final reopen checks the SQLite file signature, one persisted world, nonempty receipt table, final minute, zero model requests, the remaining two-root reserve lot and the replanted crop. This is a real file, not an in-memory store.

## Boundaries and verification

`node --import tsx --test tests/nine-resident-food-chain-review.test.ts`: **3 passed, 0 failed** (about 15 seconds). The complete-chain test replaces `fetch` with a throwing stub and observes zero calls. Static inspection finds no runtime startup, credentials loading or model completion invocation in the exercised entry point. This is test-level verification, not an OS network sandbox claim.

Only newly created temporary synthetic files were opened by the review tests. No credentials or real saves were read. No browser, npm, model request, commit or push was used. The full repository suite is intentionally left to the coordinating task.

All nine residents are alive at the endpoint, but this short scripted run does not establish nine-person food sufficiency, seasonal resilience, autonomous decision quality or population-survival acceptance. The report correctly leaves those acceptance verdicts unset.

## Final incremental review

Inspected the subsequent additions without rerunning the full chain: direct child-receipt plan/quantity/nutrition assertions, supplier and child public-table room assertions, farmer-water reporting, explicit selected/completed/pending/failed action counts, and `scriptedRulesChainPassed:true`. These strengthen or clarify the same scoped result and do not introduce fixture mutations or model calls. The 211 selected plans include 210 completed and one pending upkeep plan; zero failures does not mean every selected action completed. The earlier independent review remains applicable. The coordinating implementation task reports its two regression cases and latest TypeScript check passed; those are not represented here as independently rerun checks.
