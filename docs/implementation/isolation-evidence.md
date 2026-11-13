> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 隔离长期验收的逐日事实输出

`scripts/acceptance-long-run.mjs` 仍运行原有的确定性、多年生命周期夹具，使用真实世界引擎和内存数据库；它不调用模型，不读取真实存档，不代表真实模型能长期生存。真实模型连续十五日验收仍待用户批准。

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node scripts/acceptance-long-run.mjs 1 --daily-json
```

省略 `--daily-json` 时保留原有年度输出；年数仍为 1 至 8，默认 3。启用后在标准输出追加 `type: "daily-evidence"` 的 JSON 行，年度记录不变。重定向输出可保留审计结果，无需更改世界存档结构。

## 采样与边界

`createIsolationEvidence` 是隔离控制器持有的只读累加器，每个引擎游戏分钟后采样一次。重复分钟不重复计数；跳分钟或倒退会报错。区间为 `(fromMinute, toMinute]`，午夜这一分钟的完成记录和计数差额归入刚结束的一天。第一天和最后一天可以是不完整日；`sampledMinutes` 明确记录实际覆盖。每天只在端点计算粮食覆盖，不把昂贵的可达路径计算放到每分钟。

输出调用现有 `settlementFoodCoverage`，而非复制营养公式。`uniqueReachableStockNutrition` 与 `collectiveStockDays` 是可达批次去重后的集体存量当量，并非所有世界库存，未按个人到期消费窗口折减，也不是共同所有或人人可吃到的保证。`personal.usableDays` 是每人的保守可用天数，含照护需求、医疗护送阻断与保质期未知标记，并输出日需求、随身/可达/可用营养、来源标签与领取时间，方便核对。两者不可互换。每日端点还记录活人、本地居民、访客、境外活人和已故人数；人数差额不被称为出生、迁入或死亡事件总数。

## 已知事实与明确不可用项

- `completedActions`：每人 `recentActions` 中实际完成动作的类型计数，按人、完成分钟和类型去重。引擎每人每分钟至多完成一个动作；不解析叙事文本。`eat` 次数不等于吃下的食品份数或营养；`gather` 次数不等于产出数量。
- `spoiledUnits`：世界 `food.spoiled` 的逐品种增量，包括不可食用的易腐物品。不是库存减少量，也不是消费。计数回退会报错。
- `observedSamples`：分钟末的居民观察次数，不是精确持续时长。`chosenWait` 是有主动 wait 活动；`idleDecisionDue` 是无计划/活动且可决定、可表达并已到决定时间；`activeProtection` 是仍未结束且未到期的保护记录。三者含义不同，保护可能与待决定重合，不应相加。它们覆盖世界中所有活人，包括境外人员。
- `protectionRecorded`：仅累加保护记录中的 `prevented` 与 `losses` 字段增量，使用当前记录及新结构化保护事件，避免同一记录重复计数。它不是全天所有伤害。采样前已有的累计量作为基线，不归入当天。
- `grossHealthDamage`、`foodProduction`、`foodConsumption` 为 `value: null` 并注明缺少完整数量账本。健康净变化不能还原毛伤害；库存增长不能叫生产；库存消失不能叫吃掉。
- `directEating`：仅记录真实引擎成功完成的 `eat`，是有覆盖声明的部分消费证据，不能替代 `foodConsumption`。字段和边界见下节。
- `foodFlows`：来源新增覆盖采浆果、田地/温室/受保护代管收获、捕鱼、狩猎和果实/畜产品自然生成；加工覆盖普通 `cook`、本人 `industry_craft`、受雇 `employment_processing` 完工、本人 `saveSeed` 及 `prototype_trial` 开始与终态。来源、加工投入/产出分别汇总，不把成品当净生产；原型开始扣鱼不在终态重复记账，种子为非食品零营养输出。覆盖版本、原批次、缺测和提交边界详见[有限物理食物流证据](food-flow-evidence.md)。
- `foodLosses` / `foodTransfers`：分别保留真实腐败扣减和有限外援/外贸跨范围转移，不冒充进食或生产。[损失](food-spoilage-evidence.md) · [外援](outside-aid-transfer-evidence.md) · [外贸](foreign-trade-transfer-evidence.md)。
- `foodOwnershipChanges`：成功继承对已有食品实物的归属改写，数量取实际改权瞬间；独立于物理转移、生产与摄入，批次营养保守未知。旧覆盖不补零。[范围与验证](inherited-food-ownership-evidence.md)。
- `careMeals`、`childCareMeals`、`emergencyCareMeals`、`longCareMeals`、`publicDutyMeals` 与 `journeyMeals`：分别记录已覆盖的普通照护、监护儿童供餐、儿童紧急供餐、长期照护、公厨/公共照护以及本人旅途进食，实际提供者扣减、受益者及原批次各自保留；不扩大自主 `eat` 的范围，也不构成完整消费账。
- `familyJourneyMeals`：独立记录家庭迁居真实出发、符合间隔的复行和途中供餐，按提供者原批次份序逐成员记录meal与水扣减、营养及即时饥饿变化；`completedActions`在此切片统计受益份数，不是全组动作数。旧观测缺字段时未知，后续零次不补缺测，详见[家庭迁居供餐证据](family-journey-meal-evidence.md)。
- `technicalOrModelWaitMinutes` 为不可用。此脚本没有真实模型队列或运行时技术等待，不能从无活动状态推断模型等待时间。未来 runtime 验收可使用独立的[逐人决策等待证据](decision-wait-evidence.md)，但该可选入口没有接入本隔离脚本，不会补齐本字段。

累加器保留当前日及各已覆盖切片明细、去重与跨回执一致性状态、居民保护基线和最后事件游标；原型阶段、家庭事务等跨日校验所需身份继续保留，不能声称全部状态都只限当前日。输出行由调用者保存。世界不得在观察期间被另一个控制器回滚或重写。没有新增持久化字段、生产运行接入或自动救助。

## 实际自主进食的部分证据

`stepWorldWithFoodEvidence(world, minutes, options)` 调用同一个 `stepWorld`，返回本次调用的 `worldId`、`fromMinute`、`toMinute` 与 `receipts`。记录器只在同步调用期间绑定当前 World 对象，执行结束或抛错即解绑。预测用的世界副本不共享记录器；原 `stepWorld`、居民知识、模型提示、世界事件结构和存档格式均不改变。调用失败不返回成功观测，不承诺回滚引擎已经发生的修改。

每日脚本仅在 `--daily-json` 时接入该包装器，并将返回观测随每分钟采样传入。日输出的 `directEating` 包含：

- `scope`：仅覆盖已成功完成的引擎 `eat` 动作。不含幼儿喂养、医疗和长期照护供餐、境外旅途消耗、烹饪或加工投入，也不证明完整食物收支。
- `observedMinutes` / `unobservedMinutes`：已接入和未接入进食记录器的分钟数。只有本日实际采样分钟全部接入时，`totals` 才有数值；任一缺口使其为 `null`。这不是整日未采样区间的覆盖保证，仍须看外层的区间和 `sampledMinutes`。
- `totals.units`：逐食品实际吃下的份数；`nutrition`：执行扣除前同一次 `foodValue` 计算得到的营养，沿用原批次版本，并保留引擎现有的缺失批次营养回退规则；`hungerRelief`：吃下当刻实际减少的饥饿值，和食品营养分开，因为饥饿最低为零；`completedActions`：成功 `eat` 的次数。空 `units` 只在完整观测的该采样区间内代表没有自主进食，未观测时总量不写成零。
- `receipts`：每次成功进食的 `at`、`residentId`、`eventId`、`planId`、`container`、`item`、`quantity`、`nutrition`、`hungerRelief`。事件 ID 可与原本的进食事件核对，无需解析叙事文本。实际营养不是当日健康收益，也不是所有食物用途的合计。

食物仍按原引擎在完成动作前变质检查；失败、尚未完成、交易转移、库存减少均不会伪造进食。午夜完成的进食属于刚结束一天，下一日清空本日明细。调用者保留记录器并重载世界时，下一次包装调用绑定新对象，既有动作不回放。重新创建日累加器只从新起点取证，无法从旧存档补回未曾记录的消费，也不会声称那些历史消费为零。输出明细是外部审计资料，不会补写居民记忆或保存到 World。

包装器支持引擎的小数分钟，但隔离日累加器仍只接受连续的一分钟，不能把小数或跳步观测塞进分钟覆盖。`ValleyRuntime` 已有默认关闭的已提交食物证据和决策等待入口，并有[writer 与停止控制的显式离线集成](acceptance-integration.md)；它不直接使用本逐分钟累加器，默认服务和真实 runner 未接线。未来真实模型验收仍需获批并连接独立输出与监督，不能把组件存在或局部切片完整误称所有消费和产出已覆盖。现有多年脚本仍是三位初始人物的确定性夹具，不是正式九人真实模型验收。

## 回归

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/food-consumption-evidence.test.ts tests/isolation-evidence.test.ts tests/food-coverage.test.ts tests/decision-protection.test.ts
```

专门测试涵盖只读性、存量与个人口粮区分、动作去重与序列化、库存变化不冒充供需、等待和保护区别、日界及部分日、跳步拒绝、保护损失与未知毛伤害、变质增量和计数回退。

新增真实引擎回归还覆盖混合旧批次营养、饥饿归零截断、实际吃下与尚未完成/到期失败、正式九人完整世界状态及居民模型上下文不变、预测副本隔离、SQLite 内存存储中途重载与重复记账防护、午夜归属、缺失观测为未知、错误世界或区间拒绝、结果副本隔离、小数步长、停表与异常解绑。

独立复核及补充检查见[实际自主进食证据复核](../reviews/food-consumption-evidence.md)。

2026-11-07 离线执行一年 `--daily-json`，输出 113 条日记录，覆盖 161,280 个游戏分钟（112 天，含两端部分日），记录 1,325 次自主进食和 15,908 营养值。逐日核对覆盖分钟、明细与总量一致、与已完成 `eat` 计数一致，且总消费/产量仍为 `null`；年度存储重载通过。这些数字仅属于脚本的确定性隔离夹具，不是正式九人聚落的生存数据，也不代表完整食物消费。


## 历史留种阶段覆盖

[本人留种加工证据](seed-saving-food-flow-evidence.md)新增真实 `production.saveSeed` 的 `processed/saveSeed` 回执：根菜1份投入、非食品种子2份输出（零营养、无食品批次）。该阶段覆盖为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1`，此前标记可读但不能证明留种已观察；当前已升级为下述包含原型的版本。日报与九人主链只计加工两侧，不算新增粮食或摄入；原批次未知保持null，plantCrop及未列路径仍在范围外，完整生产/消费账仍未知。


## 当前食物流覆盖（含原型）

当前 `FOOD_FLOW_COVERAGE` 为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_prototype_v1`，与[记录器](../../src/world/food-consumption-evidence.ts)、严格 schema、日报、运行时审核及九人只读核对一致。[鲜鱼晾晒原型](prototype-food-flow-evidence.md)在真实开始时记录一次鱼投入，成功时另记鱼干产出；失败/放弃只保留终态，不再次扣鱼、伪造腐败或算作摄入。原型与留种都属于加工，不是来源新增。

旧 `...seed_v1` 及更早标记仍可读取，但不能证明原型已观察，当前范围的总量保持 `null`；明细和历史验证不被改写。原批次未知、漏采与未列路径继续保持未知，`foodProduction` / `foodConsumption` 不因局部覆盖增加而成为完整账本。
