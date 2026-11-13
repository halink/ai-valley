> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Water history: independent review

## Scope

Reviewed the completion-time observation feature in `src/shared/water-history.ts`, `src/world/water-history.ts`, and `src/client/water-history.ts`; its integration in `src/world/water-supply.ts`, `src/shared/types.ts`, `src/shared/history.ts`, `src/server/history-query.ts`, `src/server/store.ts`, `src/client/history.ts`, and `src/client/main.ts`; the water-history CSS rule; `tests/water-history.test.ts`; and `docs/implementation/water-history.md`. Existing event emission, water-support completion, and archive tests were consulted for context. Unrelated existing working-tree changes were not reviewed or modified.

## Findings

No remaining actionable defect found within this scope. An initial presentation issue, where empty-bucket crafting shared the generic proposal/authorization wording, was corrected before final review.

- Snapshots copy primitive vessel/source/inventory fields before and after successful completion, without retaining references to mutable vessels. Rendering reads the saved event, not the current world inventory.
- Rejected actions and existing receipt retries do not emit another completion fact. Legacy events and receipts are not backfilled.
- Actual drinking recipients remain distinct from gift counterparties and water transfers. Refill records contain both vessels; boiling changes quality and fuel without increasing water.
- The water filter selects versioned metadata rather than prose. Query parsing, client serialization, notification matching, and cursor binding agree for generated version-1 events. Unfiltered cursor keys retain their previous shape.
- Event snapshot fields are not added to resident memory text or decision inputs. Remote withdrawal snapshots are observer records, not notifications to distant counterparties.
- Dynamic identifiers and amounts in water detail markup are escaped. The filter explanation distinguishes historical text-only events from new snapshots.
- The follow-up expansion-preservation helper captures open event identities before panel replacement and restores only those events before scroll restoration. It respects explicit closure and does not open unrelated or newly added events. Event identities in HTML attributes are escaped.

## Independent validation

Executed using installed tools only:

```sh
node --import tsx --test tests/water-history.test.ts tests/water-supply.test.ts tests/water-support.test.ts tests/history-pages.test.ts tests/history-reader.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Final result after the expansion-preservation follow-up: **67 tests passed, zero failures; TypeScript check passed again.** The eleven new water-history tests exercise all 19 operation variants collectively, an ordinary decision-menu-to-engine path, before/after conservation, gift and drinking distinctions, failed/replayed actions, legacy receipts, filtered pagination, escaping, new-record notifications, and retention of expansion choices across panel replacement. The expansion test uses a minimal DOM-shaped fixture, not a real browser.

After the persistence test was strengthened, independently reran `node --import tsx --test tests/water-history.test.ts`: **10 tests passed, zero failures.** This revision uses a synthetic SQLite database in its own temporary directory, closes the original store, opens a new store from that file, restores runtime state, and checks the original archived snapshot despite subsequent vessel changes and eviction from the recent-event window. Cleanup is confined to the test-created directory.

## Limits

- Persistence coverage includes synthetic temporary-file database close/reopen and runtime restoration in the same test process. It does not launch a separate operating-system process or test crash recovery.
- No browser visual or interaction QA was performed. Markup tests and the typecheck are not browser acceptance.
- This review does not establish full four-season continuous supply, complete source provenance, or a universal water ledger. It does not authorize thirst, dehydration, or health effects.
- No full repository suite or independent production build was run in this review. No secrets, real saves, model calls, package installation, npm commands, commits, or pushes were used.
