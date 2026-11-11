# 钓鱼与狩猎的有限原料新增证据

## 本批次边界

沿用默认关闭的 `directEatingEvidence` 和隔离 `stepWorldWithFoodEvidence`，在原 `foodFlows` 增加两个清楚区分的来源路径：

- `source_added / fish`：仅 `industry.fish` 真正完成，所选种群实际减一且居民同种鱼库存加一。`sourceId` 为真实相邻水域的 `shoal:<水域列>,<水域行>`，不是岸边格所在区域，也不是临时可见对象；`species` 为实际捕获鱼种，输出物品必须相同，数量为一。`definition` 保留该水域实际使用的捕鱼规则定义。
- `source_added / hunt`：仅 `industry.hunt` 真正完成并击杀原个体、实际增加生猎肉时记录。`sourceId` 为死亡野兽原 ID，`species` 为原物种；输出 `gameMeat` 的实际数量，不把出手次数、伤害或尸体数量折算成产量。`definition` 是当次已经固定的工业过程定义。

有伤无猎获、猎物逃脱、工具损坏、鱼种耗尽、离岸过远、无有效时段、未走到现场以及同一猎物/鱼种被另一居民先取得，均不会生成成功新增。共享同种库存仍受原规则控制，观察器不会保留库存、改变机会或替居民选择。

自然鱼群繁殖、鱼群迁移、野鸭捕食、动物出生/自然死亡、种群初次登记、进入视野范围、初始化旧库存、贸易、转移、赠送、加工、腐败均不是本批次的新增来源。旧 `fish` 通用鲜鱼保持原库存和原批次，不补造品种，不重记历史产出。其他工业产出、牲畜产品与照护消费仍分别受各自既有边界约束。

这是有限动作证据，**不是完整食物生产账本**。`foodProduction` 与 `foodConsumption` 仍为 `null`，来源新增、普通烹饪投入、普通烹饪产出分列，不能相减称净产量。

## 真实批次与未知

新增记录由原物理成功点发出，并由原 `foodTransaction` 实际创建的新批次补足生产时点、到期时点、原定义与营养。观察器不盘点容器、不修补库存，不以当前定义重新解释老批次。

生猎肉不能直接进食（`food=0`），但有真实保存期限（`life=2`）。本批次按是否具有保存期限区分批次物料与普通水/木石输入，因此保留 `food/life/game-meat@1` 的原生肉批次。该原定义营养为零时记录零，不能用以后烹饪出的餐食营养替代；原营养缺失则为 `null`。无法证明批次数量完整覆盖操作时，`lots` 和对应 `nutrition` 保持 `null`。

## 版本覆盖与兼容

本批次历史标记为 `foodFlowCoverage: "gather_harvest_cook_fish_hunt_v1"`；后续[自然生成证据](natural-food-growth-evidence.md)已把当前标记扩展为 `gather_harvest_cook_fish_hunt_growth_v1`。旧标记仍可读取，但不足以证明扩展后的覆盖。仅 `foodFlows: []` 不足以证明这两个新增路径被观察，因为旧采集器也会产生空数组。

严格 writer 可读取缺少标记的旧 schema-1 记录，但运行时汇总和逐日报告不把它认作新范围的完整覆盖；对应 `foodFlows.totals` 为 `null`，已观察明细仍保留。漏采任意分钟、缺事件、重复事实、损坏哈希链、非法元数据或无有效关闭同样不能给出完整总量。每日新范围覆盖仍以 `(fromMinute,toMinute]` 计，午夜完成归刚结束的一天。下一天重新计覆盖，不能以随后正常观察掩盖先前缺口。

严格 schema 对鱼种、猎物物种、来源 ID、物品和数量的组合做专门校验。鱼群 ID 中逗号只在该窄格式获准，不放宽其他身份字符串。嵌套对象/数组仍拒绝额外字段、访问器、不合法定义名、非有限数、零和负数量；不会把事件正文、意图、模型输入或世界快照写入证据。

## 隔离、失败与恢复

证据仍仅在一次同步调用的 World 对象上暂存，预测/预演副本不能串入真实记录，开关不改变物理世界、菜单或存档。事务异常会解绑观察器，失败调用不返回成功观测；这不是模拟层事务回滚器。

服务运行时先完成原 durable commit 并安装新世界，再发布冻结的 `food_step_committed`。真实捕鱼/击杀在草稿内已经完成但持久提交失败时，不发布新增；世界与持久状态保持原版本，恢复后重试只产生一次真实新增。SQLite 中途恢复继续未完成行动；已经完成的记录不因重载重播，新会话也不回填旧历史。

## 离线重现

只使用合成世界、内存 SQLite 和阻止网络/模型的假回调。前端构建显式禁用环境文件加载：

```sh
node --import tsx --test tests/food-flow*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envDir:false});"
node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
```

定向覆盖包括真实最终编号菜单→解析→引擎的捕鱼与击杀、刺伤/逃脱/耗尽/坏工具、两居民争最后一尾鱼和同一动物、旧通用鱼与原生肉批次、自然恢复/非人捕食排除、预测副本/开关不变性、SQLite 中途与完成后重载、真实物理成功后的提交失败/重试、writer 重读/损坏、严格字段/元数据、旧覆盖未知与日界。

独立反例与最终验证记录见[独立审查](../reviews/wild-food-flow-evidence.md)。本批次未读取密钥或真实存档、未调用真实模型/浏览器/npm、未提交或推送；离线证明不等于真实九人长期生存验收。

## 最终离线结果（2026-11-07）

- 新增捕鱼/狩猎组 **24/24** 通过，其中独立审查 **7** 项；整个食物流组 **51/51** 通过。
- 最终全量 **2,397/2,397** 通过。首轮唯一失败是旧照护测试删除 `foodFlows` 后仍携带新覆盖标记；已同步修正旧记录夹具，未放宽生产 schema。
- 类型检查、服务端编译、禁用环境文件加载的 Vite 构建与 `git diff --check` 通过。Vite 仍有既有大分块警告。
- 一年隔离运行产生 **113** 条连续日报，共 **161,280** 游戏分钟，食物流全部分钟已观察、无重复事件，日明细数量/批次营养与汇总逐条一致。**264** 条采浆果事实合计 **1,320** 份、**15,840** 营养；原自主进食 **1,325** 次、**15,908** 营养；年度内存 SQLite 重载通过。

该长期夹具没有捕鱼或狩猎，因此这一年数据只证明长期兼容性和已有路径守恒，**不作为新增捕鱼/狩猎路径已经长期发生的证明**。两条新增路径由上述真实菜单、引擎、竞争、批次、重载与 durable-commit 专测直接覆盖。

## 后续覆盖扩展

[行业食物加工转换证据](industry-food-processing-evidence.md)当时将覆盖升级为 `gather_harvest_cook_fish_hunt_growth_craft_v1`。本页旧标记仍可读取并保留明细，但不足以证明新范围被观察，总量保持未知。后续[雇佣完工切片](employment-food-processing-evidence.md)已加入 `employment_processing`，该次标记为 `gather_harvest_cook_fish_hunt_growth_craft_employment_v1`；未完成预留与退料不计转换，完整账本仍未知。

[温室与受保护代管收获](greenhouse-custody-harvest-evidence.md)现将当前标记扩展为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1`。本页历史覆盖不能证明新来源；旧明细保留，当前范围总量未知。
