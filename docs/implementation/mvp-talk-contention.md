# MVP 规则演示：室内交谈争用的明确失败分类

## 原始故障与范围

连续原策略全年基线在第 104291 tick、游戏 minute 104771 停止。两名居民向同一室内对象交谈，实际房间位置发生排他争用。引擎正确结束失败行动，但规则演示入口把该普通失败升级为全局故障，回滚该 tick 并暂停。原始证据保存在临时 `output/year-baseline/`，本修复不将该次基线重标为全年通过。

仅调整 `src/world/rooms.ts`、`src/world/engine.ts`、`src/server/godot-mvp.ts`。不修改工位排他、动作耗时、库存、农业参数、模型入口或存档版本。

## 契约

- `claim` 只有实际已占用且 group 不同的分支产生 `room_slot_contended`。其他权限/路径错误仍是普通错误，没有此码。
- `moveInRoom` 向真实执行层传递结构化码；引擎仍通过既有 failure 清除该 plan/activity，保留 lastFailure、决策到期与 revision。
- 仅交谈争用新增一条失败 action 事件，不生成成功 conversation，不重复旧取种/留种已经存在的失败事件。真实移动/耗时保留；未完成交谈不凭空扣产物或造收益。
- `stepWorld` 可向调用者提供本次 `StepActionFailure[]`，包括 actorId、planId、actionType、code。它不是持久字段或授权能力；试算内部的 processActivity 不接收真实调用的 collector。
- 规则演示每 tick 创建新的空 collector，只有与执行前捕获 actor/plan/talk 完全匹配的本次争用可正常提交失败，并于下一 tick 重新决策。不会解析中文 lastFailure 或从旧存档恢复码。
- 未知错误、版本/账本校验异常和 commit 异常保持失败关闭。commit 失败丢弃整个草稿与 collector，不发布失败事件、库存、房间、移动或农业变化；仅既有会话暂停/故障元数据可变化。

## 已执行的局部证据

`npm run check` 通过。临时脚本 `output/talk-contention/reproduce.mjs` 在修复前从实际失败终态取消会话暂停后，证明同一 tick 中引擎普通失败而 wrapper 全局回滚。此取消暂停仅作用于隔离副本，不修改原始证据文件。

修复后 `output/talk-contention/verify.mjs` 六组通过：

1. 同一真实双居民争用场景，排他保留，失败者结束活动，未伪造成功谈话。
2. wrapper 正常提交一次失败事件，失败者库存不变。
3. 下一 tick 新决策，连续推进 14 tick 并通过气候/农业校验。
4. 注入 commit 失败，居民、房间、事件、库存、全部农业水账及时间端点回滚；暂停元数据另计。
5. 只在存档伪造相同中文 lastFailure、没有本次 typed talk 失败，不能获得恢复许可。
6. 未知农业 schema 仍拒绝。

这些是局部回归，不替代独立审查、新增量 30 分钟规则运行或连续 112 日及次春首收证明。无模型调用。

## 冻结持续验收进行中

2026-11-18 16:18:56 UTC 启动本增量30分钟规则持久运行，预计16:48:56 UTC结束，本检查点尚无最终结果。初态来自首轮全年基线第72日故障世界的隔离副本，只将clock.paused设false、reason设null；原故障档保留，未改库存、居民、原动作、事件、时间或生长。新独立数据库不覆盖任何现有存档。

源码（src/Godot逐文件清单算法）冻结指纹 `dcdc19831abde409df5ccc4f47b801a04262e116f7b69bed1a80d569aacaff5d`。类型/构建、六组隔离回归、两路独立审查及实际SQLite失败事件提交后关库重开均通过。全季基线尚未完成，不能用本次局部修复宣称112日、冬储或模型已验收。
