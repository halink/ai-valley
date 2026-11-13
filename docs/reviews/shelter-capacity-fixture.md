> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Shelter capacity fixture correction

The original capacity case was red at `tests/disaster-supply-chain.test.ts:122`: no normal shelter choice. Seed 73 rain generates a simultaneous windstorm; the residents start outside it, while the original hall door `(17,19)` is inside it. A usable dry roof does not imply a permitted route. The existing danger-edge restriction correctly prevents entering that storm.

Only the capacity case moves the 5×6 hall from `(13,13)` to `(15,13)` and its south-edge door to `(19,19)`. Capacity remains one. The case now explicitly verifies a nonempty allowed route for both applicants, every step outside the storm, and a flood-free destination. All original stale competing arrival, occupancy, no beds/supplies, retreat and no automatic eviction assertions remain.

The separate review tests preserve the original geometry: ordinary navigation can reach the roof, but danger-aware navigation cannot and the normal menu omits shelter. A reply selected through the normal safe menu is then made stale by restoring the original geometry; execution fails specifically for no reachable route, without motion, entry, occupancy, beds, supplies or a shelter event.

Validation: the original capacity case was reproduced red before edits (0/1); the corrected four supply-chain cases plus two review cases pass (6/6). Logs are in `output/test-tmp/shelter-capacity-review/{red,green}.log`. Tests use the existing offline guard before tsx, an empty inherited environment, and repository-owned HOME/TMP directories. No runtime implementation, real save, model, browser or network was used. This is targeted synthetic verification, not a full-suite or live acceptance result.
