> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 九人正式开局的离线粮食链贯通

这项验收从未经改造的 `createFrontierWorld(5401)` 开始，保留九人的原身份、年龄、家庭、房地、库存及地图。它证明一个有明确脚本选择的真实规则链能够贯通，不证明真实模型会自主选择该链，也不是九人长期生存、15 日真实模型运行或跨季供应验收。

## 可复验入口

```sh
node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
node --import tsx --test tests/nine-resident-food-chain.test.ts tests/nine-resident-food-chain-review.test.ts
node --import tsx --test tests/nine-food-accounting.test.ts tests/nine-food-accounting-review.test.ts
node_modules/.bin/tsc --noEmit
```

CLI 只接受 `--offline`，在操作系统临时目录新建独立 SQLite 文件，结束后删除该目录。它不接受存档路径、模型配置或真实运行参数。测试 helper 也拒绝已有文件与 `:memory:`，不会打开或覆盖真实存档。无需密钥，不读取环境配置，不调用模型、网络、浏览器或 npm。独立测试将 `fetch` 替换为抛错函数。

成功时 JSON 中 `executionKind` 为 `offline-scripted-normal-menu`，`scriptedRulesChainPassed` 为 `true`；`realModelExecuted` 为 `false`，模型自主与全人口生存两个验收结论均为 `null`。主链或守恒断言失败时直接中止，不能把半条链标为通过；维护采集的真实竞争另按下文保留失败记录。

## 执行方式

脚本仅替每个居民选当前正常菜单中的选项：`decisionContext → decisionChoices → parseChoice → submitPlan`。编号、可填数量、等待和睡眠时长都经过原解析器。菜单暂未显示所需选项时，居民实际选择等待，时间照常流逝。移动、室内桌台路径、工作、库存扣除、投票、取粮与进食均由原引擎执行。

启动时仅将 `clock.paused` 设为 `false`。之后逐分钟调用原引擎，不写入时间、位置、健康、饥饿、作物成熟度、食物、资金或票数。生产模块由第一分钟真实引擎推进初始化。其余居民的吃饭、睡觉、采果和查看已知果丛也只是脚本菜单选择，列入完整 trace；这些行为不是居民的模型自主决策。果实来自原有自然资源，耗时、再生与实际库存仍由原规则控制。

天气灾害扩展开关始终保持默认 `false`。基础晴雨并未关闭或改写，仍按 seed 和日界自然轮替，它与洪水/风暴灾害开关是两回事。

## 历史固定种子的实际过程

时刻均为游戏绝对分钟，开局是第 0 日 08:00，即 minute 480：

- 779：成年居民 `founder-1-1` 到自有田 `field-1-3`，投入 1 种子播下 `crop/turnip@2`。
- 787、1448、4353：分别在第 0、1、3 日实际浇水，每次消耗本人 1 水。第 2 日自然降雨，不补水、不改天气。
- 1440、2880、4320、5760：四个实际午夜分别增长到 1、2、3、4。第三次增长来自前一日降雨，保存的浇水日仍为 1。这里是四次日界生长，不能改称播后已满 96 小时。
- 5795：成熟后实际收获 12 根菜。收获前该居民原有根菜已经通过进食耗尽，因此新收获是唯一根菜批次。
- 5810：消耗 1 根菜整理出 2 种子。5825：同一田重新投入 1 种子，第二茬从 growth 0 开始。只验证重新播种，不声称第二茬已经成熟。
- 居民在共屋公告板捐出 6 钱、提出限量 3 根菜、单价 2 钱、每人 24 小时 40 营养、有效 2 日的储备议案。原名册有 6 名成年选民，4 名不同居民分别选择赞成后才批准并预留 6 钱；没有自动投票。
- 6558：原种植者实际走到共屋室内桌台，交付 3 根菜，预留款实际支付 6 钱。储备保持原收获批次。
- 6584：原开局儿童 `founder-1-3` 亲自到同一室内桌台领取 1 根菜。领取后饥饿仍自然增加，不能记作已经进食。
- 6589：儿童另行选择吃这份自有根菜。库存减少 1，饥饿下降，产生关联确切 planId 的真实 `eat` 回执，quantity 为 1、nutrition 为 20。
- 随后三位家庭成员各自走回原住处。两位成人分别接受各出 1 钱的家庭共用安排；6702 种植者实际存入自己收获的 2 根菜。提出本人承担 100% 的两根赠与后，另一位成人另行同意，6712 两根实物进入 `family-gift` 预留，并真实关闭/重开 SQLite。6717 儿童独立领取两根，此时尚未吃，6712→6717 总实物不变；6722 儿童另行吃一根，剩一根随身库存，产生第二条确切 planId 的儿童进食回执。双方批准不是模型自主决策。

扩展后终点为 minute 6722，elapsedGameMinutes 为 6242。该脚本共选出 229 项计划，全部完成、0 项在途、0 项失败。报告仍显式区分 selected/completed/pending/failed。家庭赠与阶段暂不为这三人另选 upkeep，其余人仍按原脚本照料；这只是选择控制，不改位置、库存或世界时间。

### 2026-11-07 浆果视野修复后的复验

[实际浆果视野和围栏接触](food-source-boundaries.md)修复后，脚本仍只选择原正常菜单，没有改写位置、补粮、协调采集或改变生产规则；合法观察改变了部分 upkeep 路线。本轮终点为 minute 6734，elapsedGameMinutes 为6254，228项选择均已结束，0项在途，其中**1项采集如实失败**，其余227项成功。

minute 6135，`founder-2-2` 与 `founder-2-3` 同时选择 `bush-427-232` 的最后1份；6144前者实际取得1份，后者因库存耗尽失败。回归严格核对这两条原编号选择的来源、数量、开始/结束时刻、唯一成功计划的1份食物流回执，以及失败计划没有回执；不接受任意额外失败，也不把失败计作交付。原来“所有维护动作零失败”的断言不能用来要求引擎复制最后一份浆果。播种、留种、储备表决/交付、儿童领取/进食和家庭赠与的原守恒断言继续保留。

上方时点和229项零失败是历史阶段记录，不是当前视野规则下的输出；当前完整时点以本次脚本 trace 为准。此次最初完整串行回归4599/4600通过，唯一失败是旧零失败断言，独立轨迹复现确认了上述真实竞争后才更新测试。

## 守恒与持久化证据（历史阶段时点）

- 根菜范围按下述固定九人与公共实物边界：初始 45 + 收成 12 − 留种 1 − 真实进食 48 − 该范围根菜变质 0 = 终点 8。家庭存入、预留、领取及公共储备交付/领取都是范围内转移，各自不创造或消耗根菜。
- 种子：初始 24 − 首次播种 1 + 留种 2 − 再播 1 = 24。种子库存本身无独立批次账，因此这里证明数量和先后顺序，不声称能区分再播用的是哪一粒种子。
- 种植者清水：初始 4 − 三次实际浇水 3 = 1。
- `totalCoins` 全局账户总和初始与终点均为 1295；捐赠、预留与交付付款没有创造货币。这个总和含原本就有的贸易账户，不是九人随身钱款之和。
- 新收获、储备、儿童库存的 `producedAt / expiresAt / definition` 完全一致，转移只改变数量。这里的“同一批次”指原食物批次元数据，系统未提供额外 lot UUID。
- minute 2880 生长中、6558 入库后、6712 家庭赠与预留后、6722 吃完后，四次真实 SQLite commit、关闭连接、重新打开并 `load`，整个世界深度相等；每次使用正确的已持久化 revision。儿童的公共领取与家庭领取都在相应重载后继续执行。
- 独立 review 另以只读 SQL 核查文件头、world 状态、已完成计划收据，以及再次重开后的储备余粮批次。九人的身份顺序和房屋权属保持不变。

## 只读实物边界与未知值

`tests/helpers/nine-food-accounting.ts` 只读现有数据，不调用 `foodContainers`、`initializeFood`、遗产初始化或就业批次隔离修补器。原 `foodContainers` 会初始化遗产位置并修补就业对象，不能作为验收的只读查询。快照只复制数量，不制造或修复食物批次，也不声称食物可达、可吃或营养已知。

九人由开局实际九个 ID 固定，不按 `founder-` 字符串猜测，不随新增人口改变。九人（含死者）的随身物品、遗产根库存、当前 `ownerId` 归九人的遗产分包、商店、公开销售预留、家庭各人的份额、待领取赠与各人的实物段、文化准备/捐赠、加工 working 原料、雇主的就业批次、果树现果及动物现产品都计入相应归属。文化准备看 `supplierId`，捐赠看 `donorId`；家庭份额看 credit/segment 的 owner，不把整个家庭或赠与接收者的名字当所有者；遗产分包可能更换 owner 而不改 ID。公共储存、储备以及明确 commons 所有的实物属于公共边界。

迁入联系人/居民/商人可能重复表示同一个 person。快照按逻辑容器 ID 和库存对象别名共同去重，包括后到记录把两个既有别名组连接起来的情况；相同 ID 数量矛盾、跨归属别名或不明 owner 不挑一个方便的值，相关总量保留 `null`。缺库存、显式 undefined、负数、非有限数、数量 getter 或加总溢出同样未知。稀疏库存未设置某个物品才表示该袋没有该物品；尚不存在的可选系统不是缺测事件。

所有外商随身、其他非九人库存、外贸 offer/shipment 和外援运输库存保留在 `externalTotals`，外援即使已经抵达也要实际领取才进入九人随身边界。出口货物转入外贸预留即出此边界。这是可复验的审计约定，不代表货权、地点或是否可达；外援实际领取与有限外贸预留/领取/遗产保管已有独立 `foodTransfers`，但其他跨边界路径仍未完整覆盖，不能用两个端点反推出全程来源消费。未知 owner 的正库存会使相应范围总量未知，不伪装 external 或零。

`treasuryStock` 是公共汇总，不另计；gift costs/initial、遗产继承份额摘要、配方投入、预期产出、已完成 craft 的历史 input、industry totals/sources、food lots、未收成作物和野生资源都不另算物理容器。这不是世界所有生物质的清点。

## 分项事件与加工限制

同一次 `stepWorldWithFoodEvidence` 的十一个切片分别留存：自主 `eat`、`foodFlows`、`foodLosses`、`foodTransfers`、普通 `care`、`tendChild`、`longCare.visit`、`journeyMeals`、`familyJourneyMeals`、`publicDutyMeals`、`emergencyCareMeals`。每条原回执原样复制，旁列 `scopes`，外商/范围外回执仍保留，但不纳入九人与公共库存分项总量。供餐切片另以 `beneficiaryScopes` 和 `nineIntakeTotals` 统计固定九人本人吃到的食品及伴随水，不按提供者身份过滤摄入。外人给九人吃只增加九人摄入，九人给外人吃只减少范围内库存；公共保管的实物扣减也不是九人本人的必然摄入。缺少数组、旧 flow/loss/transfer 覆盖标记或未观察分钟保留已知明细，总量为 `null`，不能用后来空数组补成零。未知原营养同样传播 `null`，不用饥饿缓解或当前 food 定义倒推。

`foodFlows.scopedTotals.sourceAdded` 只统计当前已覆盖的采集/收获/自然生成等新增；`inputs`、`outputs` 分别包括普通 cook、食物相关 industry craft、受雇加工、留种及原型的实际加工两侧，绝不混成净生产。供餐/腐败切片的 `inputs` 是各自实际扣减；`foodTransfers` 按来源和目标范围另列进出，不算消费。

历史留种证据接入前的 6242 分钟链记录了 112 条自主进食、22 条 foodFlows、9 条实际腐败；当时三种照护、两类旅途、公共供餐与儿童紧急供餐回执各 0 条。该数字保留其阶段含义，不能用作当前新增覆盖的结果。当前主链另独立断言一条留种回执、1 根菜投入与 2 种子产出；没有安排原型试验，零原型回执不提供正例。未发生的已覆盖动作也不能证明完整消费为零。

**食物相关 industry craft 已由[加工转换证据](industry-food-processing-evidence.md)覆盖，实际 employment 完工已由[独立切片](employment-food-processing-evidence.md)覆盖。** 开始 craft 是个人原料→working 预留的内部转移；完成才记录原批次投入和成品产出，完成后的历史 input 不再计现物。独立合成测试经正常编号菜单制作 gameMeal：实际预留 1 生猎肉/1 水/1 木，途中 SQLite 重载，再完成 2 餐食；只产生一条 `processed / industry_craft`，不记为 sourceAdded，报告仍为 `completeFoodLedger:false`。本人留种现已产生独立 `processed/saveSeed` 回执；主脚本的同一 `conversions` 条目仅作交叉核对，不再累计第二份投入/产出。两次 `plantCrop` 仍是单列、已核对实物的转换，不冒充 foodFlows。[温室与受保护代管实际收获](greenhouse-custody-harvest-evidence.md)现已接入，代管产物按原遗产包所有者而非劳动者/孩子分类。留种和晾鱼原型已按文末最新标记接入；外贸生产、其他未列加工、边界转移及损失仍不完整。已有 `emergencyCare` feed/rescueMeal 与 `publicDuty` receive 切片已由[公共与紧急供餐核对](nine-public-care-food-accounting.md)接入；已接入旅途仅限 visitorJourney eat、visitorAid eatMail 与家庭迁居真实逐成员口粮。

另有明确标识的合成回归，把家庭份额、遗产根/分包及 working craft 共 14 根设为下一分钟腐败。原引擎逐项实际扣减并取消不足批次，收集器同时得到四条真实损失，数量与完整实物差额相符，SQLite 重载后不再重复记损失。带审计/不带审计的引擎世界深度相等。此合成注入与上方未经改造的正常九人链分开，不能当自然开局证据。

完整输出包含全部菜单选择、开始/完成时刻、失败/在途状态、日界生长、上述分项事件、每个持久化检查点的只读实物明细与终点九人状态。终点九人活着是本次有脚本照料的观测，不可据此推出持续供养能力；部分居民终点仍较饿。仍无完整全局营养生产/消耗账、总健康伤害账、第二茬收成或长期天气灾害测试。

独立审查见 [九人粮食链 review](../reviews/nine-resident-food-chain.md)。真实模型验收准备仍见 [九人验收准备](nine-resident-acceptance-preparation.md)。

本次只读核对与缺测边界的独立审查见 [food accounting review](../reviews/nine-food-accounting.md)。

## 历史离线验证（旅途集成前）

- 最终代码全库 `node --import tsx --test tests/*.test.ts`：**2465/2465 通过**，0 失败、0 跳过。
- `node_modules/.bin/tsc --noEmit`、`tsc -p tsconfig.server.json` 与 `vite build` 全部通过；Vite 仍提示既有的大 chunk，非构建失败。
- 新 accounting 聚焦 15/15、原九人验收/review 聚焦 5/5 通过。独立审查另外重跑扩展链及边界反例，具体范围见审查页。
- `node --import tsx scripts/acceptance-nine-food-chain.mjs --offline` 成功输出上述正常菜单链结果。
- `node scripts/acceptance-long-run.mjs 3` 三年隔离回归通过，第三年累计 16478 计划、重载成功、账户总和 1290。它是另一个既有合成生命周期场景，不是本九人 15 日/真实模型/长期供应验收。
- 全程未读取密钥或真实存档，未调用外部模型、浏览器或 npm，未提交、推送。

## 旅途供餐集成

新增旅途切片的逐成员/provider、固定九人受益边界、严格事务与旧数据处理，详见 [旅途 food accounting](nine-journey-food-accounting.md)；独立反例与审查见 [旅途 accounting review](../reviews/nine-journey-food-accounting.md)。该增量只修改离线审计 helper、脚本断言、测试及文档，真实模拟语义不变。


## 历史留种阶段覆盖

[本人留种加工证据](seed-saving-food-flow-evidence.md)新增真实 `production.saveSeed` 的 `processed/saveSeed` 回执：根菜1份投入、非食品种子2份输出（零营养、无食品批次）。该阶段覆盖为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1`，此前标记可读但不能证明留种已观察；当前已升级为下述包含原型的版本。日报与九人主链只计加工两侧，不算新增粮食或摄入；原批次未知保持null，plantCrop及未列路径仍在范围外，完整生产/消费账仍未知。


## 当前食物流覆盖（含原型）

当前 `FOOD_FLOW_COVERAGE` 为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_prototype_v1`，与[记录器](../../src/world/food-consumption-evidence.ts)、严格 schema、日报、运行时审核及九人只读核对一致。[鲜鱼晾晒原型](prototype-food-flow-evidence.md)在真实开始时记录一次鱼投入，成功时另记鱼干产出；失败/放弃只保留终态，不再次扣鱼、伪造腐败或算作摄入。原型与留种都属于加工，不是来源新增。

旧 `...seed_v1` 及更早标记仍可读取，但不能证明原型已观察，当前范围的总量保持 `null`；明细和历史验证不被改写。原批次未知、漏采与未列路径继续保持未知，`foodProduction` / `foodConsumption` 不因局部覆盖增加而成为完整账本。
