> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Independent spring visibility review

Reviewed the spring-specific changes against saved pre-change file snapshots, including decision context, final choices and prompts, direct action validation, gather travel/completion, spring discovery, bucket filling, flood cleanup, and extraction of the existing crop sight helper.

## Result

No remaining actionable implementation defect found in the reviewed scope. Spring stock and flood state require actual outdoor sight; address knowledge remains usable for travel. A stale gather can travel to its known address without remote stock-dependent preflight errors, but cannot transfer water without legal contact. Non-spring resource visibility remains unchanged.

Follow-up adversarial review found and reproduced a reachable-source routing regression: gather, filling, and cleanup could be offered beside a closed pasture edge, then fail at completion despite a reachable gate. The generic adjacent route stopped on the wrong side. The corrected spring-only routing now retains legal adjacent routes or uses the exact source route through the real gate, stopping one step short. All three final-menu → parsed-choice → engine regressions changed from failing to passing. Completion continues to reject a gate that closes during work, without spending resources or recording supply receipts.

The extracted crop sight corridor and outdoor guard match their prior implementation. Visibility and reachability remain distinct: transparent water can leave stock visible while blocking travel, and a closed pasture edge can leave stock visible while preventing direct transfer.

## Independent checks

Added `tests/spring-visibility-review.test.ts` with thirteen tests covering:

- Manhattan 12/13 boundaries, diagonal corner occlusion, and unchanged non-spring Euclidean visibility.
- Full context and prepared final menu/prompt invariance under hidden stock and flood-state changes behind trees, rocks, and a reserved structure.
- Direct stale bucket and cleanup completion rejection without spending or recording.
- All three transfer paths rejecting visible but nonwalkable source contact, plus a visible spring across an impassable water barrier.
- Crop ownership, eight-step range, and shared occlusion compatibility.
- Two residents viewing the same spring from different positions: only the unobstructed resident’s final menu and prompt change with stock.
- Closed fence contact rejection and successful contact through the real gate, preserving finite stock and cleanup costs.
- Actual final menu and engine execution routing through a reachable gate for gather, bucket filling, and cleanup (three regressions).
- A gate closing during each of those three actions prevents completion without consuming water, wood, stone, or receipt capacity (three regressions).

Final independent execution: `node --import tsx --test tests/spring-visibility-review.test.ts tests/crop-observation*.test.ts`: **34 passed, 0 failed** (13 independent spring checks plus 21 existing crop checks). The parent owns final typechecking and repository-wide verification; this focused review does not claim a full repository pass.

This review used only source and synthetic worlds. No real saves, runtime evidence, secrets, models, browser, npm commands, commits, or pushes were used. It is not live-model acceptance.
