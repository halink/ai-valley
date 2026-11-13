> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 离线九人公共与紧急供餐核对

## 本次接入范围

`tests/helpers/nine-food-accounting.ts` 现在接收引擎已经存在的两个可选切片：

- `publicDutyMeals`：本人实际完成 `publicDuty.receive`，只包括公厨与公共照护的实际食物、水扣减。
- `emergencyCareMeals`：儿童实际得到 `emergencyCare.feed` 或一次性 `rescueMeal` 的食物、水。

只改变离线 helper、断言和文档。没有新增引擎动作、初始供应、模型知识、权限、生产入口、观测开关或存档字段。原 18 类物理容器、固定九人身份和公共实物范围、范围外库存、别名去重及只读快照均保持原义。真实模型、真实存档与生产运行不属于本次验证。

## 库存与受益者分别核算

完整保存每条回执，不因提供者或受益者在范围外就删掉它。

- `scopes` 仍按实际扣减的 `container` 区分 `nine-and-public`、`external`、`unknown`。`scopedTotals.inputs` 只统计固定九人和公共实物库存的扣减。
- 公共供餐的 `source: public` 必须指向回执所列建筑的 `public:<buildingId>`，个人来源必须是 `person:<providerId>`。公共服务者是外人也不会把公共库存误归为外部。儿童紧急供餐只有提供者个人来源，不能伪装为公共来源。
- `beneficiaryScopes` 与 `nineIntakeTotals` 按固定九个受益者身份统计，独立于库存归属。外人用个人食物供九人只增加九人摄入；九人供外人只记范围内库存扣减；公共库存供外人同样不增加九人摄入。
- `nineIntakeTotals.units` 是回执食品原料份数及伴随水，不虚构额外成品。公厨每次真实投入两根 turnip、一份水，公共照护每次一份 meal、一份水；儿童紧急供餐每次一份 meal 或 turnip、一份水。服务次数按 `completedServings` 单独记一次，不能把两根原料算成两次服务。
- `nutrition` 只累计原批次可知营养。公厨固定42、公共照护固定20的饥饿缓解及健康变化并不决定原料营养；儿童急救中引擎对缺定义的后备效果也不补成原批次营养。`hungerRelief` 保持独立，健康及工资事实留在原回执中，不算食物或营养。
- `economy.treasuryStock` 仍只是公共汇总，不是另一份实物。只计公共建筑 store 实际扣减，不再加一次 treasury、资金账户或工资。

两种总量分别传播未知。来源容器归属未知不会抹掉明确属于九人的受益者摄入；外人所得食品的未知营养也不污染九人摄入。范围内原营养缺失时对应 `nutrition` 为 `null`，已知份数继续保留。

## 严格接收与原子拒绝

仍要求同世界、固定九人集合、连续的一分钟快照及 `(fromMinute, toMinute]` 内的回执。克隆时只读取纯数据描述符，不调用 accessor；稀疏/扩展数组、非普通对象、符号和未知观测顶层字段拒绝。两个新增切片分别复用 `checkedPublicDutyMeal`、`checkedEmergencyCareMeal` 的严格 schema，验证字段、真实配料、来源、原批次数量/营养、即时变化、工资差额与操作特有身份；不根据当前世界定义重算原事实。旧有切片沿用既有验证，不声称本次重写了所有历史 schema。

所有切片、覆盖计数、游标和身份集合在整步验证完成后才更新。一条新回执损坏也不能留下先处理的直接进食、公共供餐或其他切片。拒绝后可以在同一区间提交修正后的观察；输入与每次 `finish()` 输出相互独立。

- 所有有 `eventId` 的已收切片共用事件去重，跨切片、跨分钟也不可重复。
- 公共服务还按 `shiftId / serviceNumber` 去重；换一个 eventId 不能把同一服务再记一次。
- 儿童 `feed` 同一 `agreementId` 的提供者/受益者必须不变，已观察 `mealNumber` 递增，不能倒退或重复；同一协议的已知供餐时段必须小于24小时。
- 首次观察允许从第2至4餐开始，不补造此前记录。前后没有该切片缺测时，下一个已知餐号必须连续；中间确有缺测时允许跳号，但只保留看到的两条，整段总量仍未知。明确空数组是已观察零餐，不能为跳号辩护。
- `rescueMeal` 没有协议/餐号，不为它虚构事务身份；依旧受事件去重和严格操作 schema 约束。

## 缺测、旧记录与重载

没有采样、整步 observation 缺失、旧 observation 未带某个数组，均不是该动作发生零次。缺哪个切片就增加它的 `unobservedMinutes`；此后该切片的两种总量为 `null`，以前保留的真实明细不删除。只有完整已观察区间中的明确空数组才产生零。字段不完整的当前回执按损坏输入整步拒绝，不擅自补齐成旧记录或零摄入。

世界 SQLite 保存加载后，同一个外部内存 collector 可以继续收集，已完成服务不会重放，重复输入也不会再次入账。collector 自身不写入世界/存档，不实现跨进程持久化恢复；新建 collector 只代表新的起点，不能假装恢复此前覆盖。运行时 durable commit 和 writer 的封存保证仍由原证据层承担。

## 回归边界

`tests/nine-public-care-food-accounting.test.ts` 使用明确合成的九人身份集合，沿用真实最终编号菜单与实际引擎：

- 公厨/公共照护 × 公共/个人来源 × 双向跨九人边界，共八个供餐情形。
- 有协议的儿童 feed、一次性 rescueMeal 的双向跨范围供给。
- 每分钟证据引擎与普通 `stepWorld` 世界深度相等；行动途中 SQLite 保存加载、完成后重载无重放，审计字段不进存档。
- 真实双批次营养与库存差额、缺原定义、缺切片、最后一步缺水导致失败且不产生摄入。

合成 fixture 的人员、库存和营养版本不属于自然九人开局。原 `acceptance-nine-food-chain` 没有增加人物、资源或供餐脚本，只扩充两个切片的覆盖断言；因此原链中的两个新切片是已观察零，并非本次公共/急救正例。独立手工反例和审查结论见 [review](../reviews/nine-public-care-food-accounting.md)。

`completeFoodLedger` 恒为 `false`，`foodProduction` 和 `foodConsumption` 恒为 `null`。边界贸易/外援/货权转移、留种播种、温室和外部生产、未列使用/损失仍不完整；供餐之外的公共勤务或紧急照护动作也不是摄入。这些局部切片不证明九人长期或跨季节生存，更不证明模型自治验收通过。

## 最终验证

以下为最终冻结代码实跑结果，不是只运行新增用例：

- `node --import tsx --test --test-concurrency=4 tests/*.test.ts`：**2914/2914 通过**，0失败、0跳过、0取消，约187秒。包含新增17条真实引擎回归与46条独立反例。
- `./node_modules/.bin/tsc --noEmit`、`./node_modules/.bin/tsc -p tsconfig.server.json`、`./node_modules/.bin/vite build` 均通过；Vite 仅有既有的大 chunk 提示。
- `node --import tsx scripts/acceptance-nine-food-chain.mjs --offline`：6242游戏分钟，229动作全完成，0失败/待处理；萝卜45 + 12 − 1 − 48 = 8，种子24、金币1295不变，原四次SQLite重开断言通过。两个新切片各观察6242分钟、缺测0、回执0、九人供餐数0。
- `node scripts/acceptance-long-run.mjs 3`：三年通过，第三年累计16478计划，账户总和1290，各年SQLite重载成功。这是已有的另一套合成生命周期场景，不是九人或模型自治验收。
- 接入前后 `src/server`、`src/world`、`src/shared`、`src/client` 的全部TypeScript源码哈希一致。修改文件无尾随空格，tracked diff检查通过。

本次只修改两个离线helper、四个测试文件及相关文档。全程未读取密钥或真实存档，未调用真实模型、浏览器或npm，未提交、未推送。
