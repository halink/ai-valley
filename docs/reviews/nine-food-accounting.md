> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 离线九人粮食链：实物范围与事件证据独立审查

## 审查范围

仅审查 `tests/helpers/nine-food-accounting.ts` 及其在离线九人正常菜单链中的使用；不改变引擎、配方、初始世界或真实存档。独立回归位于 `tests/nine-food-accounting-review.test.ts`。所有反例均为内存中构造的合成状态，未调用模型、浏览器或外部服务。

## 实物口径

- 固定九个初始身份和公共实物库存为范围内；其他居民/外商及未领取的外贸、救济库存单列 external。该口径表示保管/所有权，不表示立即可取食。
- 对照 `src/world/food.ts` 的实物路径，覆盖全部 18 类容器：person、estate、estate-stock、business、public、public-reserve、listing、aid、offer、shipment、orchard-stock、animal-stock、employment、craft、culture-prep、culture-food、family-stock、family-gift。
- 遗产包裹按当前 `ownerId` 归属，不能从保留的历史 ID 推导；家庭库存与待交付礼物按 credit/segment 的 owner 归属；活动贡献按 donor 归属；就业批次按 employer 归属。
- 仅计 working craft 的真实 input、存在的 employment batch.inventory、ready gift 的 segments、open sale listing 的 quantity。已完成配方的 input、预期 batch.output、treasuryStock、food.lots、累计 totals、gift.costs、继承份额等均不是额外物理库存。
- 人员重复表示、同 ID 和共享 inventory 对象只计一次。跨 ID 与对象引用的桥接必须合并整个连通分量；所有权或数量矛盾保留 unknown。
- 不调用 `foodContainers`、`initializeFood`、遗产初始化、就业批次隔离等会修改状态的函数。缺少初始化字段的合成状态仍保持不变。

## 事件与缺测口径

- 保存全部实际 observation 的直接进食、普通照护、监护照护、长期照护、foodFlows 和 foodLosses。外商/范围外证据仍保留，范围内 totals 另算，不能先按 founder 过滤丢弃世界事件。
- 缺少数组或匹配 coverage 标识时，不把没有观察到事件当成零；已存在的旧 receipts 仍保存。receipt 中原营养值为 null 时保持 unknown，不以 hungerRelief、当前食物定义或物品默认营养替代。
- 库存 getter 和 scalar 数量 getter 不执行。显式负数、NaN、Infinity、缺失实际 bag、重复矛盾、求和溢出均不能报告为确定数量。
- `sourceAdded` 与加工 `inputs`/`outputs` 独立统计，不能把一次收获和一次烹饪的毛输出混成新增生产；独立反例同时验证 12 份收获、2 份加工投入和 1 份成品各归其项。
- `foodFlows` 不是完整食物账。industry craft、employment 加工、saveSeed/plantCrop、温室收获、外贸生产、边界交接、急救和部分旅行消耗等仍有覆盖缺口。果实/动物产品领取是转移，不是新生产；foodLosses 只覆盖 advanceFood 腐败。

## 审查发现及修复验证

初次审查发现三处问题，已交由实现者修改，并由独立反例验证：

1. ID 与对象引用同时连接两个既有记录时，原实现只合并其中一个，可能重复计量。
2. 普通 inventory getter 已防护，但单值库存数量曾在封装前直接读取，触发 getter。
3. 各项有限但相加溢出的数量曾变为 Infinity。

对应独立回归现已通过。审查过程中未修改主 helper。

## 本次验证

- `node --import tsx --test tests/nine-food-accounting-review.test.ts`：12/12 通过。
- `./node_modules/.bin/tsc --noEmit`：通过。
- 独立重跑新增两条实际引擎回归通过：家庭/遗产/craft 共 14 根实际腐败只记录一次，与库存减少一致；保存重开后不重复扣除，带证据/普通引擎运行状态一致。
- 独立重跑正常编号菜单 craft：真实原料进入 working batch，SQLite 重开保持批次；完成后原料减少、meal 增加，foodFlows 仍为空且明确标记该加工未覆盖。
- `node --import tsx --test tests/nine-food-accounting.test.ts tests/nine-food-accounting-review.test.ts tests/nine-resident-food-chain-review.test.ts`：独立重跑 17/17 通过，约 27 秒，包含扩展九人整链、真实 SQLite 重开和 CLI 参数边界。
- 仓库全量测试由协调任务运行，本页不把局部测试通过等同于全量通过。

## 结论边界

此工作提高离线脚本验收的实物范围和事件可追溯性，不是完整净营养/损失账，不证明真实模型自主决策通过，也不证明九人或跨季节可持续生存。

## 扩展集成复核

静态复核确认每个实际一分钟引擎步骤都保存完整 observation，再按容器范围分开统计。家庭储物、双方同意、礼物预留、儿童领取和进食均通过普通菜单，ready gift 在 SQLite 重新打开前保留 harvest lot，领取不等于进食。审计证据不写入 world/save，初始九人世界未为主链注入资源或改写成熟度。

实现者报告的最新离线 CLI 结果为：初始分钟 480，结束 6722，共 6242 分钟；229 个动作全部完成，无待处理或失败。萝卜为 45 + 12 − 1 − 48 = 8，种子 24，硬币 1295。家庭储物 6702、礼物预留重开 6712、领取 6717、进食 6722，合计四次 SQLite 重开。捕获直接进食 112 条、foodFlows 22 条、腐败 9 条；三类照护各零条，但六类切片均观察 6242 分钟，零条并非缺测。这些精确 CLI 数值来自实现者实跑，不冒充本审查另行运行的 CLI。

当前未发现新的阻塞问题。完整食物账、产业加工、边界变化和长期生存能力仍不能由本验收推出。

## 最后增量审查

只读复核了 collector 的全切片预验证和主链范围断言：重复 receipt、重复时间步在计数、保存 receipts 和更新游标之前被拒绝。腐败断言改为范围内 foodLosses，不再用世界累计 spoiled 计数推断九人损失；其他已覆盖加工/照护切片的根菜投入也明确为零。`accountingScope.foodProduction` 与 `foodConsumption` 明确为 null，避免局部切片被读成完整生产/消费总量。

独立运行 `node --import tsx --test tests/nine-food-accounting.test.ts tests/nine-food-accounting-review.test.ts`：**15/15 通过**，约 4 秒，包含新增重复 receipt/step 拒绝后 collector 不变的回归。本次小增量没有重跑长链。协调实现者报告此前全仓库 2464/2464 通过，最终全量重跑仍由协调任务负责；这不是本审查独立运行的全量结果。未发现该增量的新阻塞问题。

## 后续行业食物加工证据

以上“industry craft 未覆盖”的结果保留为本页初次审查时的历史结论。后续[加工转换证据](../implementation/industry-food-processing-evidence.md)只在食物相关 craft 真正完工时记录两侧，九人 helper 已接收该事实；正常菜单 gameMeal 回归现断言唯一的转换及原批次，不再断言 foodFlows 为空。employment 和完整粮食账仍未覆盖，新增独立审查另见[审查记录](industry-food-processing-evidence.md)。

## 后续雇佣完工扩展

以上 employment 未覆盖为当时历史结论。后续[雇佣加工完工证据](../implementation/employment-food-processing-evidence.md)已将真实受雇加工单列为 `employment_processing`；预留、退料、腐败取消不计转换。九人 helper 接收该事实，但这不改变完整粮食账缺失的结论。
