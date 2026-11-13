> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Greenhouse and protected-custody harvest evidence review

## Result and reproducible checks

Review identified one strict-schema hardening gap: custody receipts initially accepted equal estate-owner, adult-provider and child-beneficiary identities even though valid custody histories require them to differ. The schema owner added a distinct-three-identities guard; the real-receipt regression now passes for all three pairs. A later task-owner pass also identified an instrumentation-only throw for malformed legacy crop output IDs. Optional goods lookup now skips evidence without introducing that throw; independent real-path tests verify observation neutrality for both sources. Neither resolved issue remains outstanding. This is a bounded source and offline regression review, not a claim of complete food accounting or live-model acceptance.

Final independent adversarial tests: `node --import tsx --test tests/food-flow-harvest-review.test.ts` passed **14/14**. Combined focused check: `node --import tsx --test tests/food-flow-harvest*.test.ts` passed **51/51** at review time. The combined run includes the implementation's physical-action, strict-schema, durable-commit, sealed-writer/readback and fixed-nine tests; the independent file is separate from those tests. Full-suite and build results belong to the task owner and are not asserted here.

Only synthetic in-memory worlds and SQLite fixtures were used. No real saves, credentials, browser, model calls, package installation, commits or pushes were used.

## Independent adversarial coverage

- A greenhouse owned by another resident still attributes production to the actual crop owner and places output in that actor's personal container. Building ownership is not silently used as production ownership.
- Thirty-seven existing turnips with missing ledger metadata are repaired separately. The receipt contains only the twelve new harvest units and their actual fresh output lots, not forty-nine units of combined inventory.
- A real harvest, new planting through the final numbered menu, synthetic maturation, and second real harvest on the same bed produce two separate receipts with distinct event/plan identities. The source ID remains the same. Mutation of receipt lot data cannot mutate the world.
- A prior custody watering action advances the mandate work serial without adding source production. The following harvest uses serial 1 and its exact physical `custody-stock:<mandate>:1` parcel, while keeping worker, estate owner and child beneficiary distinct.
- For both action types, disappearance of the crop after work starts prevents completion and emits no harvest receipt. A subsequent step does not replay evidence.
- A throwing runtime observer marks capture failed without poisoning subsequent capture or changing the harvested world. The failed session is not certified complete.
- Nonfood and zero-yield variants of both physical harvests produce no food-source receipt.
- For each source, a queued harvest with a malformed legacy output ID completes the existing twelve-unit physical output without producing food evidence. Evidence-on and evidence-off worlds remain deeply identical, including the actual personal inventory or custody parcel. This preserves existing behavior rather than claiming malformed data is a valid current item.

- An added strict-schema regression rejects each impossible equal-person pair in a genuine custody receipt. It initially failed because the validator checked the container but not identity relations; after the schema guard was added, all three contradictions are rejected.

## Source findings

`src/world/industry.ts` captures the bed's original crop definition and owner before clearing the crop. `src/world/protected-custody.ts` captures the original plot definition, the pre-increment work serial and the actual parcel returned by `output`. Neither implementation calls the ordinary field-harvest evidence path, and custody animal collection remains a routed transfer rather than a new harvest source.

The hooks require successful active completion and positive food output. Fresh lot attribution remains in the existing `foodTransaction` reconciliation hook; initialization does not supply output receipts. Engine completion closes pending evidence in `finally`. The instrumentation does not add persisted world state or change custody/greenhouse authority.

Strict snapshots require the exact variant fields, a single positive food output, matching personal owner/container for greenhouse harvest, the exact custody parcel/serial relation, and internally consistent fresh lot quantities, dates and nutrition. Unknown original lot/nutrition metadata remains unknown. Runtime audit and daily/fixed-nine readers reject duplicate custody mandate/work identities even if the event ID changes. Repeated greenhouse source IDs are deliberately allowed for later crop cycles.

The fixed-nine helper scopes custody output using the physical estate owner, not the acting provider or beneficiary. Contradictory endpoint ownership makes scope unknown. The prior coverage marker remains readable but cannot certify the newly expanded source totals.

## Limits

Synthetic crop maturation in the repeated-cycle test verifies distinct physical harvest cycles, not season-by-season agronomic growth. The exhausted-source tests simulate the intervening source change; the primary suite separately covers stale queued action competition. Runtime commit/rollback, reload, prediction isolation and strict-schema behavior were executed in the combined focused suite rather than independently reimplemented here. A syntactically valid receipt alone does not prove its source world history; this evidence relies on the existing durable runtime publication boundary. Other food sources, complete consumption, net production and a complete settlement balance remain out of scope.
