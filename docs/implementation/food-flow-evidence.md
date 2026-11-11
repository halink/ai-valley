# 有限物理食物流证据

## 范围

本批次在既有、默认关闭的自主 `eat` 证据旁增加 `foodFlows`。最初记录以下三个已实际完成的操作；后续[钓鱼与狩猎扩展](wild-food-flow-evidence.md)增加实际捕鱼及击杀所得原料，并以显式覆盖标记区分旧采集器：

- `source_added / gather_berry`：居民从浆果灌木真正取得的份数、资源 ID。
- `source_added / harvest`：居民田地实际收获的份数、田地 ID、原作物定义。使用真实土壤/作物产量，不从动作次数估计。
- `processed / cook`：普通厨房 `cook` 的原材料投入与餐食产出各自列出；使用当次实际固定配方与数量，不把成品当作来源新增，也不相减声称净产量。

后续[自然生成证据](natural-food-growth-evidence.md)覆盖果实/畜产品原地生成，[行业食物加工转换](industry-food-processing-evidence.md)覆盖完成的食物相关 `industry craft` 原批次投入/产出。[雇佣食物加工完工证据](employment-food-processing-evidence.md)另行覆盖受雇工人的已完成转换。[温室与受保护代管收获](greenhouse-custody-harvest-evidence.md)继续覆盖真实成熟作物新增与原址遗产包归属。[本人留种](seed-saving-food-flow-evidence.md)另记根菜投入与非食品种子产出，[晾鱼原型](prototype-food-flow-evidence.md)区分开工投入和成功/失败/放弃终态。各切片沿用同一可选入口，当前覆盖以文末包含原型的最新标记为准。

后续[真实腐败损失切片](food-spoilage-evidence.md)使用同一可选提交证据内的独立 `foodLosses`，不并入下列来源/加工总量。

后续[outsideAid.collect 转移切片](outside-aid-transfer-evidence.md)与[外贸转移](foreign-trade-transfer-evidence.md)在同一可选提交中独立列出 `foodTransfers`，分别记录真正领取的援助余量和已覆盖的外贸预留/领取/遗产保管实物，不并入来源、加工或进食；仍不是完整边界账。

这是局部操作记录，不是完整食物账本。`foodFlows` 不包含交易/赠送/搬运、初始化、播种、非人捕食、雇佣预留与退料或其他未列生产。已覆盖的照护、公厨、旅途与家庭迁居供餐分别进入独立 meal 切片，真实腐败进入 `foodLosses`，有限跨边界流转进入 `foodTransfers`，均不能重复算作来源或加工。完整 `foodProduction` / `foodConsumption` 保持 `null`。加工用水和留种产生的非食品种子按实际数量单列、营养为 0，不是新增粮食。

## 事实采集与批次

份数直接取真实库存变更处的操作数量。记录包含游戏时点、实际容器、动作/定义及来源或投入/产出；居民执行的操作另留居民、事件和计划身份，自然生成则将这三项保持为 null，并记录原实体和所有者。代管收获归原址遗产包、受雇产物归商铺，不把劳动者当作收货人。没有事件正文、意图、prompt、错误正文、密钥或整个世界。

烹饪投入在原 `consume` 之前，仅查看该容器该食品现有的原批次，按原先到期顺序截取。每个批次保留实际数量、生产/到期时点、定义，以及该份数量的营养总值。不会以当前食品定义覆盖原批次，也不会以库存端点、饥饿净变化或食物估算代替。

来源/加工产出的批次仅在原 `foodTransaction` 真正建立新鲜批次时附上。没有再做全容器盘点；观察代码不调用 `foodContainers`、`initializeFood` 或修补库存。原事务本来具有的初始化、转移与批次守恒照常执行。

若批次数量不能精确覆盖操作数量，或原定义没有可核实的营养值，`lots` / `nutrition` 相应为 `null`。例：修改配方使同一食品既作为投入又作为产出，原事务可能只建立净新增批次，此时仍保留真实加工投入/产出份数，但不假装有足够的成品新批次。未记录到的证据不补造。

## 隔离与提交

记录器通过 `WeakMap` 绑定当前 World 对象的一次同步 `stepWorldWithFoodEvidence` 调用，不加世界字段。原 `captureDirectEating` 继续提供 `receipts`，另附 `foodFlows`；老调用者可省略新字段。预测副本不能串入；异常通过 `finally` 解绑，失败调用不会返回成功观测。它不是模拟事务回滚器。

运行时继续使用显式 `directEatingEvidence` 选项，不增加默认服务入口。现有持久提交成功并安装新世界之后、订阅者之前才发布 `food_step_committed`。草稿执行成功但数据库提交失败不发布操作。独立 observer 失败时证据通道停止，不回滚已提交事实或替居民行动；显式启用验收集成时，控制器会停止运行并保留不完整段，不能与独立入口的失败行为混同。已发布数据递归复制并冻结。

证据 writer 对新字段及每层数组/对象严格白名单检查，拒绝额外字段、访问器、非有限数和不合法定义名。旧 schema-1 没有 `foodFlows` 的记录仍可读取，但不能证明本批次覆盖。钓鱼/狩猎扩展后，即使有旧 `foodFlows` 数组，没有新覆盖标记也不能证明扩展范围已采集；仍保留明细，总量为未知。读取器保留已观察明细，缺口、重复、损坏或失效关闭使相应总量为 `null`，而不是零。无推进的旧/新会话不能单凭会话边界证明采集器版本，因此食物流总量也保持未知。

## 逐日与重载

隔离 `--daily-json` 仍只包裹原引擎；新增 `foodFlows` 明细、已观察/漏观察分钟和三组独立总量：`sourceAdded`、`processingInputs`、`processingOutputs`。每组数量按物品分开，营养缺失会传播为 `null`。某日漏接任何分钟会清空该日总量，恢复接入不掩盖缺口；已观察明细保留。

日界处完成的动作属于刚关闭的一天 `(fromMinute,toMinute]`。新日重新计覆盖。运行时分数步跨午夜按事实自身时点分组，不伪造整分钟快照。SQLite 重载后继续当前真实活动，不重播已完成动作；新观测会话不回填历史。

## 离线验证

```sh
node --import tsx --test tests/food-flow-evidence.test.ts tests/food-flow-runtime.test.ts tests/food-flow-review.test.ts tests/food-consumption-evidence.test.ts tests/nine-resident-acceptance.test.ts tests/acceptance-evidence-writer*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
```

测试使用合成世界、离线假模型或内存 SQLite，覆盖原批次营养、实际采集/收获/烹饪、失败与腐败、转移排除、预测/开关不变性、日界/漏采、重载/不重播、提交失败、嵌套白名单及损坏证据。独立复核见[审查记录](../reviews/food-flow-evidence.md)。具体最终通过数量由该审查/交付结果记录。

未访问密钥或真实存档，未调用真实模型、浏览器或 npm，未提交/推送；不等于真实九人长期生存验收。

### 初始采集/收获/烹饪批次一年隔离复验（历史结果）

2026-11-07 使用最终修正后服务端构建运行一年：113 条日记录连续覆盖 161,280 游戏分钟；全部采集分钟已观察，264 条浆果来源事实合计 1,320 份、15,840 营养。逐日明细、各批次数量/营养与来源总量完全一致，事件不重复，年度内存 SQLite 重载通过。

原 `eat` 结果仍为 1,325 次、15,908 营养，完整产量/消费仍为 `null`。该既有长期夹具使用温室而非田地 `harvest`，也没有普通 `cook`，因此不能把这次年度验证说成覆盖了所有新增动作；两者由定向真实引擎夹具覆盖。

最终修正后的全套离线测试 **2,263/2,263** 通过；食物流、原进食、运行时与 writer 定向组 **75/75** 通过，其中本批次新食物流测试 **27** 项（含独立审查 **7** 项）。类型检查、服务端编译、Vite 构建和 `git diff --check` 均通过。Vite 仍提示既有大分块警告，该警告未在本批次解决。


## 历史留种阶段覆盖

[本人留种加工证据](seed-saving-food-flow-evidence.md)新增真实 `production.saveSeed` 的 `processed/saveSeed` 回执：根菜1份投入、非食品种子2份输出（零营养、无食品批次）。该阶段覆盖为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1`，此前标记可读但不能证明留种已观察；当前已升级为下述包含原型的版本。日报与九人主链只计加工两侧，不算新增粮食或摄入；原批次未知保持null，plantCrop及未列路径仍在范围外，完整生产/消费账仍未知。


## 当前食物流覆盖（含原型）

当前 `FOOD_FLOW_COVERAGE` 为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_prototype_v1`，与[记录器](../../src/world/food-consumption-evidence.ts)、严格 schema、日报、运行时审核及九人只读核对一致。[鲜鱼晾晒原型](prototype-food-flow-evidence.md)在真实开始时记录一次鱼投入，成功时另记鱼干产出；失败/放弃只保留终态，不再次扣鱼、伪造腐败或算作摄入。原型与留种都属于加工，不是来源新增。

旧 `...seed_v1` 及更早标记仍可读取，但不能证明原型已观察，当前范围的总量保持 `null`；明细和历史验证不被改写。原批次未知、漏采与未列路径继续保持未知，`foodProduction` / `foodConsumption` 不因局部覆盖增加而成为完整账本。
