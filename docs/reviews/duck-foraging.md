# 野鸭觅食单项离线复核

本文是鸭单项阶段的独立审查记录，保留该阶段指纹和失败结果。当前鹿补缺联合候选的最终审查另见[鹿浆果觅食复核](deer-berry-foraging.md)。

## 范围与结论

基线为 `ffeb848147ebd883e678258a9bbb204d25b8c092`。候选只改 `fishing.ts` 的真实鱼目标查询和 `frontier-wildlife.ts` 的鸭食源选择，共15行新增、6行删除；共享警戒结构、狼的追踪/攻击/迁移/参数及捕食者生态源码与基线相同。未携入此前未接受的狼追猎实验。

独立复跑111项定向回归、另10项独立合成反例，全部通过。TypeScript与差异检查通过，原样长测夹具的两日完整世界、两次SQLite句柄关闭重开冒烟也通过。局部范围没有发现阻塞的扣量、重复进食、只读查询或持久化问题。这不是整体生态平衡通过或合并批准。

## 独立核对

- 深度冻结世界上的鱼查询，以及各种失败条件，均不改变完整世界序列化结果。
- 四步连通水路可取鱼，五步或隔陆地不可取，活动洪水不扣库存。
- 居民与鸭竞争最后一条鱼，两种顺序都只扣一次；两鸭争最后一份种子也只有一只得到营养。
- 途中删除种子目标，或已有缓存路径的终点后来变为障碍，仍能退出旧目标并重新取食真实鱼，不扣无效种子。
- 新合成SQLite文件实际关闭、重新打开后保留已选种子路线；同分钟重入不再进食，后续状态与未重载分支相同。

路径阻断仍由原移动机制逐步处理，不能承诺任意远端阻断发生的同一时刻就立即换目标。没有新增持久化字段或数据库迁移。

## 长测与外推边界

独立审阅确认夹具会计式与当前资源逻辑相符，记录器不补食物、不降低饥饿或复活动物。但物种灭绝不会触发夹具失败，退出码0不能用作所有物种通过的标准；源码指纹也只覆盖明确列出的三份文件。

本轮鸭单项候选中，seed5402的鹿于92.045833日因饥饿清零，而同seed基线最终保留一只鹿。该结果不是历史鸭狼联合候选，也不是狼代码残留。必须与鸭存活改善一起披露，不能表述为“对其他物种没有退化”。最终三年结果见[实现与对照说明](../implementation/duck-foraging.md)。

全部实验只用新建合成世界、已安装依赖与项目内输出，无真实存档、密钥、联网、真实模型或浏览器验收。每日SQLite重开不是进程崩溃恢复；没有在独立复核中替代作者的完整测试和最终长期对照。

## 源码指纹

- `src/world/fishing.ts`：`32b26539bb49a964c9d83bbaf74c58e46a7b1eb02b557e0a7138bb70eafff784`
- `src/world/frontier-wildlife.ts`：`3fbd8ac211fde1d7f1a021001c92219ee3a86bfb105463e92055f6ffcbc70e0a`
- `tests/duck-foraging.test.ts`：`d3d9f669db80212b54173fa1898a2c3ed3d6bf55aa4452031c127e27f59757dc`
- `scripts/wildlife-longevity.mjs`：`499aa199edbef71021130a54a6d2b2902d68bc03fd922c7cfee6086bf64f0d5c`

## English review record

This is the historical **duck-only** review, not approval of the later combined candidate. The reviewer independently passed 111 focused tests and 10 additional synthetic cases, type checking, diff checks, and a two-day SQLite-reopen smoke test. No wolf-pursuit residue, duplicate meals, inventory fabrication, query mutation or local persistence blocker was found.

Independent boundaries included frozen-world fish queries, four-step versus five-step water reach, floods, resident/duck competition for the last fish, duck competition for the last seed, deleted or blocked targets, and SQLite continuation. There is no new save schema. The reviewer explicitly retained the seed 5402 deer extinction regression rather than treating the harness's successful exit as ecological acceptance.

The fingerprints above belong to the duck-only stage. See the separate deer review and implementation document for current source fingerprints, final validation and the remaining ecological limits. All observations used synthetic offline worlds, not real saves, model-driven residents or process-crash recovery.
