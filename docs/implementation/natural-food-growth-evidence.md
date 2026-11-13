> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 果树与畜产品自然生成的有限食物流证据

## 实际发生点与范围

沿用默认关闭的 `directEatingEvidence` / `stepWorldWithFoodEvidence`。本次仅增加 `advanceIndustry` 内实际增加源库存的两类事实：

- `source_added / fruit_growth`：成熟果树满足既有季节、浇水、积累时间和容量条件后，真实生成的 `fruit`。`sourceId` 是原树 ID，`container` 是 `orchard-stock:<树 ID>`。
- `source_added / animal_product`：原鸡、家鸭、山羊、牛满足既有年龄、性别、饥渴、健康、容量及适用泌乳条件后，真实增加的 `egg`、`duckEgg` 或 `milk`。`sourceId` 是原个体 ID，`species` 区分原物种，`container` 是 `animal-stock:<个体 ID>`。山羊奶和牛奶即使都是 `milk` 也不合并来源身份。

自然生成不由一次居民行动完成。因此 `residentId`、`eventId`、`planId` 明确为 `null`；`ownerId` 仅表示源资产当时的所有者，不宣称该居民做了生产行动、取得食品或参与照护。不向世界事件、序号或居民知识添加伪事件。`definition` 保存原树或原动物绑定的过程版本。

`harvestFruit` 和 `collectAnimal` **仅转移已经存在的原批次，绝不再次计算产出**。原有 `industry.totals.fruit/animalProducts` 是收取计数，不被改作生成计数。进入视野、改变位置、初次登记、修补缺失批次、动物出生、贸易、运输、产权变化和腐败均不记作本次自然新增。

羊毛不是食品，不进入本次食物流。本批未覆盖温室收获、一般工业加工、雇佣加工、贸易等全量来源（后续增量见文末）；自然鱼群/野兽种群变化也不等于取得可用食物。仍是有限来源和加工操作证据，**不是完整食物生产、消费或净收支账本**；`foodProduction`、`foodConsumption` 保持 `null`。

## 原批次、容量与腐败

记录钩子只在原 `foodTransaction` 的真实库存增加处登记数量，由同一事务实际创建的新批次补足 `producedAt`、`expiresAt`、原食品定义和营养。既有同物品批次不混入新操作，随后采摘/收取保留这些原批次，不重新赋予采摘时间。

观察器本身不初始化或修补食品数据，不由库存端点差额或饥饿变化推算生产。原批次或营养无法证明时保持 `null`，不用当前默认营养替代。原食品定义可产生缺营养的真实批次；数量事实与未知营养分开保留。容量导致的实际小数增量如存在也原样记录，不向上取整。

引擎仍先执行原腐败，再执行自然生成。腐败释放容量后产生的新批次仅记录新量，不把腐败量算生产，也不吞掉已经满仓或尚未成熟时的未知历史。所有生长阈值、时间积累、取舍顺序和模拟状态保持原样。

## 覆盖、日界与恢复

新观察带 `foodFlowCoverage: "gather_harvest_cook_fish_hunt_growth_v1"`。旧 `gather_harvest_cook_fish_hunt_v1` 或无标记记录仍可读取、保留可信明细，但不能证明自然生成被观察，因此当前范围 `foodFlows.totals` 保持 `null`。空数组只有配合当前标记才证明本步已观察但没有发生所列操作。

运行时按连续提交区间审核。自然事实按操作、源实体、精确游戏时间排重；正常引擎每个时间片每个实体只推进一次。直接在测试中手动收取并再次调用 `advanceIndustry`，可能释放容量后消费原积累余量，属于另一次真实变动；若在同一时间人为组织两次此类调用，汇总会保守拒绝其歧义，而不是擅自改变模拟或压掉实际明细。这不是普通运行时路径。

日界沿用 `(fromMinute,toMinute]`：恰在午夜生成的事实归刚结束的一日，之后的小数时点归下一日。缺测日保留明细但总量未知，下一日重新累计，不能回填覆盖。隔离逐日报告只证明合成运行中的对应分钟，不能冒充真实模型验收。

## 隔离与 durable commit

采集只附着一次同步调用的 World 对象，以 WeakMap 保存，不进入世界、存档、决策输入或预测副本。每个自然生成事务单独结束批次钩子，避免后续动物同种物品串入前一来源。抛错调用不返回成功观测，finally 清理采集器；观察器不是模拟层回滚器。

服务运行时仍先 durable commit，再安装世界并发布冻结记录。草稿里自然生成完成但提交失败时，不发布、不中止原有回滚；整世界和 SQLite 保持原版本。重试可生成并发布一次，后续同刻推进或完成后重载不重播；新会话不回填历史。默认关闭与打开观测的模拟、菜单和持久结果一致。

## 离线验证

仅合成世界、内存 SQLite、假模型回调以及禁止网络的测试。无需 npm 或外部服务：

```sh
node --import tsx --test tests/food-flow-growth*.test.ts
node --import tsx --test tests/food-flow*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envDir:false});"
node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
```

专项覆盖真实日界→自然生成→正常编号菜单采摘/收取；五类食品源、原所有者/物种/过程定义；同刻重入；原库存和缺失批次登记；容量、干旱、年龄、性别、死亡和泌乳；腐败释放容量；旧定义营养；预测副本、开关等价；SQLite 生成前与完成后恢复；实际提交失败/回滚/重试；严格 schema、writer 重读、旧覆盖与日报。

独立反例与限制见[独立审查](../reviews/natural-food-growth-evidence.md)。一年生命周期夹具没有果树与牲畜，不能把该运行称为新增自然来源的长期实证；新增路径由上述真实引擎专项验证。

## 最终离线结果（2026-11-07）

- 新增自然生成组 **20/20** 通过，其中独立反例 **4** 项；全部食物流测试 **71/71** 通过。
- 最终全量 **2,417/2,417** 通过，无失败、跳过或取消。
- 最终类型检查、服务端编译、禁用环境文件加载的 Vite 构建和 `git diff --check` 通过；保留既有大分块警告。
- 一年隔离运行 **113** 条日报、**161,280** 游戏分钟，连续覆盖且逐日原批次数量/营养与来源汇总一致；**264** 次采浆果，**1,320** 份、**15,840** 营养，年度内存 SQLite 重载通过。
- 该年度夹具自然生成记录为零，因为没有果树或牲畜；以上年度结果只验证长期兼容性，新增来源由真实引擎、采摘/收取、writer 与提交失败专项证明。

未调用模型、浏览器或 npm，未使用真实存档，未提交或推送。离线结果不表示真实九人十五日验收已完成。

## 后续覆盖扩展

[行业食物加工转换证据](industry-food-processing-evidence.md)当时将覆盖升级为 `gather_harvest_cook_fish_hunt_growth_craft_v1`。本页旧标记仍可读取并保留明细，但不足以证明新范围被观察，总量保持未知。后续[雇佣完工切片](employment-food-processing-evidence.md)已加入 `employment_processing`，该次标记为 `gather_harvest_cook_fish_hunt_growth_craft_employment_v1`；未完成预留与退料不计转换，完整账本仍未知。

[温室与受保护代管收获](greenhouse-custody-harvest-evidence.md)现将当前标记扩展为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1`。本页历史覆盖不能证明新来源；旧明细保留，当前范围总量未知。
