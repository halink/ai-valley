> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 独立审查：本人留种的可选食物流证据

## 范围与口径

检查 `production.ts` 的真实完成入口、`food-consumption-evidence.ts` 的只读采集、严格 schema、隔离日账、runtime 验收及固定九人 food accounting/food-chain。另审读 `food-flow-seed.test.ts`、`food-flow-seed-schema.test.ts`、`food-flow-seed-commit.test.ts`。本次仅修改本报告与 `tests/food-flow-seed-review.test.ts`，保留此前未提交工作。

留种是 15 游戏分钟完成的 `turnip:1 → seed:2` 实物加工，不是新增食品或摄入。种子输出是非食品，营养严格为 0、lots 严格为空数组；输入营养取可确认的既存批次，不以饥饿缓解或当前定义反推。`plantCrop` 不在此切片中。

## 主动反例与初次结果

独立测试最初 7 项中 5 过、2 失败，已向实现者报告，未直接修改生产文件：

1. **同一完成事件可被 runtime 食物流审核同时当作加工与进食。** 构造合法 `saveSeed` 回执及相同 `eventId` 的直接进食回执，`auditRuntimeFoodEvidence` 的 `foodFlows.complete` 原本仍为 true，并给出加工 totals。`auditFoodFlows` 原本仅与 publicDuty/emergency 的事件交叉检查。真实引擎不会自然生成这种重复，但审核器不应把相互矛盾的回执认证为完整切片。
2. **隔离日账的跨分钟重复检查方向不对称。** 先收留种事件，下一分钟用相同事件作为直接进食，原本不抛错；先收其他事件再收同 ID 留种则会被挡。失败测试要求两种身份不能重用，并核验拒绝后可用合法空样本重试同一分钟。

这两项是证据审核完整性问题，不是实物重复扣减或 seed 生产漏洞。回归用例保留为正常断言，不用 skip/todo 隐藏失败。

## 独立已验证边界

- 以 0.25 分钟推进，开始后剩余 14.75 分钟，完成之前无回执，完成仅一条；再推进不重放。
- 预测副本完成不污染原世界；同世界嵌套采集被拒；异常退出后新采集仍正常；启用与关闭采集的全部世界对象相同。
- 在最后一分钟前删除原批次，同步修补后输入营养与 lots 保持 null，种子仍正常产出；原批次引用未知定义，经 SQLite 内存库重载后营养仍为 null。
- 回执与后续世界定义、库存变更脱离；不因后续补上营养定义而追填。
- 输出嵌套 getter、数组 getter、隐藏 Symbol、无限过期时间、无 lots 的已知营养及种子 null lots 均被拒，getter 调用计数为零。
- 相同计划的两个独立完成事件都保留；旧 coverage 不因有回执就升级为完整覆盖。已观测输入营养未知时仍为 null，种子输出营养为零，不把加工输出放进 sourceAdded。

## 代码检查及现有测试范围

`completeProduction` 在原扣减、原产出与真实事件之后，要求当前 action 对象与完成 activity 一致且 remaining ≤ 0 才记录；保留原 activity 的 planId/definition。采集使用 World 弱引用映射，不添加世界或居民存档字段。`foodFlowInputs` 不主动初始化批次。

原有测试另覆盖缺料、过期、竞争扣减、同计划两次动作、craft 与 employment 独立、durable SQLite 失败及 stale revision 拒绝、重试与重启、observer 抛错后的模拟中立。runtime 的采集位于提交草稿中，发布位于提交成功回调；失败不提前发布。固定九人 collector 在修改游标与 totals 前严格校验 saveSeed，跨切片使用公共 eventId 集合；food-chain 将 observed saveSeed 回执用于根菜守恒，conversions 条目只作交叉核对，不再次计账。

上述现有测试在本次审查中是代码审读，不冒充独立执行结果。

## 必须保留的证据限制

个人库存历史修补生成的 FoodLot **没有持久 provenance 标志**。本轮独立用例故意在采集之前调用既存 `initializeFood` 修补，再通过 SQLite 重载：后续留种回执会读取这些已有 metadata 并给出营养。这不能证明该批次最早真实生产来源，也不能声称“任意历史未知来源永远保持 null”。

准确承诺应是：当次采集发现修补、缺失或不能确认的原 metadata 保持未知；采集前已经存在且结构有效的 metadata 可被读取，无法区分其历史是否由修补产生。本轮不新增存档 provenance 字段，不改变模拟或存档语义来伪造该证明。全部切片仍非完整生产、消费、流转或可持续性总账。

## 执行

使用合成世界与内存 SQLite；未读取 `.env` 或真实 runtime 存档，未调用真实模型、浏览器或 npm，未提交或推送。

命令：`TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-seed-review.test.ts`。

实现者随后补上 runtime 的 saveSeed 跨切片事件检查，以及隔离日账跨分钟保留的 seed 事件集合。独立复核后的最终重跑：**10/10 通过，0 跳过、0 todo**。跨切片测试覆盖同一步及两个跨分钟方向，并明确要求 `duplicate_flow_receipt`，不能以不完整 session 假通过。多步合成 runtime fixtures 的 revision 按 1、2 递增，符合既有提交序约束；同计划、不同事件应当被接受。

本次独立组未执行完整仓库测试或真实模型验收；结论限于上述切片、反例和静态检查。
