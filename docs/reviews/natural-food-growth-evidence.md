> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Natural food growth evidence: independent review

## Result

No release-blocking defect found in the requested opt-in observation scope. This review adds tests only and does not alter simulation rules, production code, stock, migration, counters, or runtime persistence behavior.

## Reviewed boundaries

- The hooks in `advanceIndustry` observe the actual fruit/product increments within each existing physical `foodTransaction`. Fruit collection and animal collection remain transfers, not new source additions. Sheep wool is excluded.
- Natural receipts distinguish owner from actor: `ownerId` identifies the asset owner; resident, event and plan IDs remain null. Original asset process definitions and actual source containers are preserved.
- Per-transaction finalization prevents another animal's same-item milk lot from attaching to a previous source. The independent test combines goat and cow production with a second goat owned by another resident and existing stock.
- Original fresh-lot metadata is copied, not inferred from old stock or current replacement definitions. Mutating returned receipts cannot mutate the world, and later world mutation cannot rewrite evidence. Runtime events receive a separately validated, frozen copy.
- The collector remains a WeakMap scoped to the exact world object. A failure after actual generation cleans up observation state; it does not promise a simulation rollback. The next capture cannot replay the failed scope's receipts or inherit pending lots.
- The runtime schema rejects unsupported species/items, actor spoofing, source/container mismatches and unknown coverage. Independent unknown-marker and accessor-marker tests fail closed without invoking the accessor. Legacy coverage preserves facts while leaving current-scope totals unknown.
- Runtime durability is still a distinct gate: the collector alone is not commit evidence. The existing growth commit tests exercise successful commit, rejected commit, reload and disabled instrumentation. No production/durability path was changed by this review.
- `foodProduction` and `foodConsumption` remain unknown. These receipts describe selected gross operations, not an all-world food balance.

## Explicit limitation

The natural deduplication identity is `(action, sourceId, at)`. The ordinary engine advances time and calls `advanceIndustry` once per step, so each source contributes at most once per timestamp. A caller can construct a nonstandard direct-helper sequence with accumulated production backlog, collect stock, and call `advanceIndustry` again at the same timestamp; two genuine helper operations would then share a deduplication identity. This is outside the current ordinary-runtime capture contract, and the audit fails closed with duplicate-receipt evidence rather than inventing a valid total. Do not change simulation cadence or progress semantics to address an evidence-only concern. If same-timestamp external helper calls become supported, add an observation-only operation identity and tests then.

The daily isolation collector consumes trusted engine observations, rather than serving as the strict external schema boundary. Runtime evidence validation/auditing remains the boundary for external or malformed receipts.

## Verification

- Added `tests/food-flow-growth-review.test.ts`: four independent adversarial tests passed.
- `node --import tsx --test tests/food-flow-growth*.test.ts`: 20 tests passed.
- `node node_modules/typescript/bin/tsc --noEmit`: passed with no diagnostics.
- Tests use synthetic worlds and in-memory or temporary test persistence. No network, model calls, browser, real save, dependency installation, commit or push was performed by this review.
- The preexisting dirty worktree was preserved. Only this review and its dedicated test file were created.

## Final implementation-owner verification

After the independent review file was added, the final complete offline suite passed **2,417/2,417**, with no failures, skips or cancellations. The natural-growth group passed **20/20** and all food-flow suites passed **71/71**. Type checking, server compilation, Vite build with environment-file loading disabled and `git diff --check` passed; the existing large-chunk warning remains.

The one-year isolation run passed with 113 consecutive daily rows, 161,280 observed game minutes and an in-memory SQLite restart. Its 264 berry receipts, 1,320 source units and 15,840 source nutrition reconciled with each day's receipt lots and totals. That lifecycle fixture has no fruit trees or livestock and emitted no natural-growth receipts, so it verifies compatibility rather than long-run occurrence of the new paths. The actual generation and collection paths are covered by the focused tests above.
