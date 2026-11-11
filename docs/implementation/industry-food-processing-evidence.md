# 行业食物加工转换证据

## 只记录真实完工

沿用默认关闭的 `stepWorldWithFoodEvidence` / `directEatingEvidence`，在现有 `foodFlows` 增加 `processed / industry_craft`。与普通 `processed / cook` 分开，**本切片不混入 employment，也不是完整食物账本**；受雇完工现由[独立转换切片](employment-food-processing-evidence.md)覆盖。完整 `foodProduction`、`foodConsumption` 保持 `null`。

实际调用链是正常编号菜单 → `parseChoice` → `submitPlan` → 原 `industryWorkError`。开工把居民原料转入 working craft 批次，只是预留/转移，不记录加工消费。分次劳动、等待、暂停、拒绝、权限失效、腐败取消、剩余原料退回或死亡转入遗产也不产生转换。

仅当原工时实际完成、同一原事务把批次标为 completed 并把成品加入居民库存时，附加一条事实。批次不再属于实物容器，原 `input` 可能继续保留为历史，不再盘点或再扣一次。观察器不改变配方、工时、权限、产出、状态机或任何原模拟行为。

每条事实含游戏时点、原事件/计划/居民 ID、批次 ID、工位 ID、投入容器 `craft:<batchId>`、产出容器 `person:<residentId>`、原配方定义，以及原批次配方的机器快照：`id`、`input`、`output`、`minutes`、`station`、`skill`、`minimum`。不保存配方名称、事件正文、意图、prompt、错误文本或整个世界。新启用配方不会替换已在制批次的旧快照。

`inputs` 是完成前原批次真实保有且随完成离开实物容器的全部数量，`outputs` 是该原配方真正交付的全部数量。包含配料水、燃料木材等非食品腿，营养明确为 0；损坏旧数据若存在多余真实预留，也不把多余扣减藏起来。输入不足仍按原引擎取消，不修改引擎来修补证据。两侧均是毛转换量，绝不把成品再次列为 `sourceAdded`，也不相减宣称净生产或饮食消费。

## 食品范围及原批次

以原配方任一正数量投入或产出的 `goods[item].life > 0` 判定是否涉及食品，不用 `food > 0` 误排不能直接吃的生猎肉。覆盖现有鲜鱼及各鱼种、猎肉餐、面包、奶酪、罐藏，以及消耗食品制饲料/药草的转换。纯工具、木板、布料、堆肥、树苗等不涉及易腐食品的 craft 不记入此切片。

投入批次仅查看当前真实 `craft` 容器该项已有 ledger，在原完工事务之前截取；不调用 `foodContainers` 或 `initializeFood`，不新增全世界盘点。保留原生产/到期时点、定义及原定义中可核实的营养，没有当前定义或商品默认营养回退。

原引擎仍可能初始化/修补旧 ledger，但同次捕获内已标记的修补批次不能证明原来源。缺失、损坏、未来生产时点或数量不能覆盖实际投入时，实际数量保留，`lots`/`nutrition` 为 `null`。原批次有效但营养定义缺失时，批次仍保留、营养未知。合法存档批次只证明完工前存在的记录，不追溯证明更早的生产历史；此证据没有新增存档字段。

输出批次仍只在原 `foodTransaction` 真正创建新鲜输出时附加。旧同品成品不混入。如果自定义配方同一种食品同时输入/输出，原事务可保留/转移原批次，只创建净新增批次；无法证实完整毛输出的“新批次”时，输出数量照实、批次和营养保持未知，不假装刷新保质期。

## 隔离、提交和版本

收集仍是单次 World 对象的 WeakMap 外部观察，默认关闭，不增加知识、菜单、世界或存档字段。预测/计划验证副本不能泄漏事实；异常清理 pending 输出与捕获状态。捕获器不负责回滚模拟，失败调用不返回成功结果；实际运行时继续由 durable commit 决定是否发布。

数据库提交失败时，草稿转换不发布，原世界与存档不变；成功重试只发布一次。运行时复制并递归冻结 receipt 和 snapshot，重载完成批次不重播；观察器抛错不能改变模拟结果。

本批交付时覆盖标记为 `gather_harvest_cook_fish_hunt_growth_craft_v1`；后续雇佣与[温室/代管收获](greenhouse-custody-harvest-evidence.md)已将当前标记升级为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1`，原 craft 标记亦视为旧覆盖。旧 `gather_harvest_cook_fish_hunt_growth_v1`、更早的 `gather_harvest_cook_fish_hunt_v1` 及无标记的记录仍可读取并保留可信明细，但不能证明本次扩展被观察，`foodFlows.totals` 保持未知。只有当前标记与空数组一起才证明所列范围本步无操作。无推进会话、缺步、序号/时间异常、重复事件或重复 craft 批次不能给出完整切片总量。

严格 writer 白名单检查快照、对象、数组与数据属性；拒绝额外字段、访问器、非有限数、非法身份、错配投入/产出容器、非食品快照、重复物品、少于原配方的投入、不符快照的产出、过期/未来批次和矛盾营养。完整配方不通过世界的当前版本反查，以免改写历史。

隔离日报仍分 `sourceAdded`、`processingInputs`、`processingOutputs`。任一分钟缺测或旧覆盖会使该日总量未知，明细保留；新日重新累计。运行时按 receipt 实际时点分日，午夜属于刚结束的 `(from,to]`，不会把跨日分数步伪装为逐分钟快照。九人测试 helper 同步接收新增转换，仍明确 `completeFoodLedger:false`，未完工 employment 与其他未列路径保持缺口。

## 离线验证

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-craft*.test.ts
TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow*.test.ts tests/food-spoilage*.test.ts tests/nine-food-accounting*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
TSX_DISABLE_CACHE=1 node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
```

回归使用明确合成输入、真实菜单与引擎、内存 SQLite 和不调用网络的本地假模型。覆盖分次预留/等待/完工、食品分类、旧配方与原营养、腐败退料、物料/权限竞争、旧批次未知、提交失败和重试、重载不重播、预测与开关不变、严格 writer、日界与旧版本。独立反例与复核结论见[独立审查](../reviews/industry-food-processing-evidence.md)。最终通过数量单列在交付结果，不把局部测试等同全库通过。

未读密钥或真实存档，未调用真实模型、浏览器或 npm，未提交/推送。该证据不证明模型自主选择加工，不证明九人长期生存，也不构成完整生产、消费或净营养账。

### 最终验证（2026-11-07）

- 新增 craft 回归 **27/27**，其中真实引擎/菜单 9 项、严格 schema/writer 7 项、运行时提交 5 项、独立审查 6 项。与 employment 守恒联跑 **35/35**；实际 employment 预留及完工均确认未伪装成 cook 或 industry_craft。
- 最终完整离线测试 **2,492/2,492** 通过，失败、跳过和取消均为 0。类型检查、服务端编译、禁用环境文件读取的 Vite 构建与 `git diff --check` 通过；保留既有大分块警告。
- 提交回归除假故障外，还在内存 SQLite 使用真实 trigger 中止和真实版本竞争，核对全部八张持久化表、运行时世界、证据状态与发布数量。SQLite 成功重试、版本竞争后重新载入获胜版本均只发布一次完工。
- 九人离线 CLI 再次完成 229/229 个脚本动作、四次 SQLite 重开，6242 分钟；根菜 `45 + 12 − 1 − 48 = 8`、种子 24、货币 1295。此主链没有 craft，加工转换由单列合成菜单回归覆盖，不能混称自然开局模型行为。
- 一年合成隔离日报连续 161,280 分钟、113 行，全新覆盖标记无缺测；264 条浆果采集事实为 1320 份、15,840 营养，逐日原批次/总量和年度重载核对一致。这个长期夹具没有 craft，`processingInputs`/`processingOutputs` 为空，不扩大为长期加工或完整生产/消费验收。
