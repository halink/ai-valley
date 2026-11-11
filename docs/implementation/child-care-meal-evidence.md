# 幼儿日常照护供餐证据

## 真实范围与资源

默认关闭的 `directEatingEvidence` 入口现在另有可选 `childCareMeals`，仅记录引擎成功完成的 `tendChild`。既有 `careMeals` 仍只记录普通 `care`；自主 `eat`、来源/加工 `foodFlows`、普通照护和幼儿日常照护分别列账，不能相加宣称完整消费账本。`foodProduction` 和 `foodConsumption` 仍为 `null`。专门的 `emergencyCare`、长期照护、公共供餐、旅途、交易、赠送及腐败均不属于新增切片。

先对照 `src/world/family.ts` 的真实规则：具备决定与表达能力的成年现任监护人，实际到未满六岁、未拒绝照护的孩子身边；孩子当前饥饿至少12。原动作需要20游戏分钟，完成时重新检查这些条件，优先使用照护者个人库存的一份 `meal`，没有时使用一份 `turnip`，另扣一份个人 `water`。它不使用桶中储水，也没有普通 care 的提议编号或接受步骤。

原动作使孩子饥饿减48并最低截断至0，健康最多加3。本次不改动这些模拟规则，也不把健康增益纳入食物营养。即使孩子健康突降，原 `tendChild` 仍须依靠现任监护权限，不会自动转为 `emergencyCare`。

## 成功完成点的只读明细

在原资格、接触、需求和库存检查之后，读取被实际选择的个人食品批次；扣减成功并产生原照护事件后记录：

- `action: 'tendChild'`、游戏分钟、成功事件、实际计划及该活动的定义。
- `providerId`、`beneficiaryId`、`person:<providerId>` 和固定 `authority: 'guardian'`。不制造提议或同意编号。
- `inputs` 分别保留实际减少的一份 `meal` 或 `turnip` 与一份个人 `water`。水为0营养、空食物批次，不与食品数量相混，也不与桶水相混。
- 食品原批次按原事务先到期顺序保留此次取用数量、生产/到期时间、原定义与可核实营养，混批逐段保留。
- 孩子动作生效前后的 `hungerBefore`、`hungerAfter`、真实差值 `hungerRelief`。动作之后同一引擎步中的代谢不是本次供餐的一部分。

原批次营养与固定48缓解不同。测试中的两段批次共25营养，仍可缓解48；接近饱足时缓解更小。原定义缺失则营养为 `null`，不会由48反算，也不会回退到当前食品定义。批次数量不足以证明整份来源时保留 `lots:null`、`nutrition:null`。观察器不初始化或修补批次；原 `foodTransaction` 的旧库存初始化仍照原规则执行，不是新增的观测行为。

菜单产生时不预锁定餐食，完成时如果真实库存改为芜菁，记录芜菁；完成前原餐食腐败且没有可用替代物、个人水不足、监护撤回、孩子拒绝/长大/离开/已经饱足、提供者失能均不得发成功记录。两位监护人竞争时仍由原动作逐次检查当前需要。

## 提交、隔离与未知

捕获器只以 WeakMap 关联当前 World 对象的单次同步调用，`finally` 清理，不进入 World、居民知识/决策或序列化存档；预测副本不会被原世界捕获。直接 `stepWorld` 不开启证据，带证据与不带证据的实际世界结果一致。捕获器不是事务回滚器：同步调用抛错时不会返回成功证据，但实际回滚仍由既有运行时草稿与存储事务负责。

运行时仅在 `WorldStore.commit` 成功并安装世界之后发布 `food_step_committed`。草稿中完成喂养但 durable commit 失败，不发布该草稿记录，不改变已提交世界或持久库存；恢复后实际完成只发布一次。输出经过严格检查、独立复制及递归冻结。观察器失败不改变模拟；writer 持久化失败不撤销已提交世界，但顶层及 `directEating.childCareMeals` 的完整总量都保持未知。

schema-1 旧记录可没有 `childCareMeals`。缺字段表示未观测，不是零；显式 `[]` 才表示该步观测零次。旧 `careMeals`、自主进食和来源流的既有覆盖仍独立有效。零步会话、丢失开始/结束边界、漏步、重复事件和 writer 损坏/缺封存不能得到完整新增总量。

严格 writer 对每层对象与数组执行白名单，不接受任意文本、额外字段、访问器、符号字段、数组空洞或非有限数。新增审核核对人、个人来源容器、恰好一种食品与水各1、批次数量/时间/营养一致性、饥饿至少12与减48截断、时段及跨切片重复事件。它是受信任内部证据的一致性检查，不是外部真实性签名。

隔离逐日记录独立保留已观测/未观测分钟、原始 receipt 和总量。当日任意分钟缺测，后来的已观测零不能恢复完整总量。区间为 `(fromMinute,toMinute]`，午夜完成归刚结束的一天；小数步按 receipt 时点分组，不凭空补造没有记录的日期。

内存 SQLite 重载保留未完成活动、监护/拒绝状态和原批次。重载后继续检查当时权限，仅记录实际完成一次，不回填已发生的喂养。

## 可重现离线验证

```sh
node --import tsx --test tests/child-care-meal*.test.ts tests/care-meal*.test.ts tests/food-flow*.test.ts tests/food-consumption-evidence.test.ts tests/nine-resident-acceptance.test.ts tests/acceptance-evidence-writer*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
```

独立审查见[幼儿供餐证据审查](../reviews/child-care-meal-evidence.md)。仅使用合成世界、内存 SQLite 和新临时证据目录，未读取密钥、环境文件或真实存档，未调用真实模型、浏览器或 npm，未提交或推送。这不是正式九人长期模型验收。

### 一年既有记录对账（2026-11-07）

运行原 `acceptance-long-run.mjs 1 --daily-json`，未改其控制器或模拟规则。113条日记录覆盖游戏分钟481至161761，共161,280分钟；每条新增切片的观测分钟等于该条采样分钟，未观测分钟均为0。

- 真实 `tendChild` 共31次，逐日 receipt 数与原 `completedActions.tendChild` 完全相等。消耗 `turnip:31`、个人 `water:31`；原 `food/life@1` 批次营养620，实际饥饿缓解1,488。所有31条均另经严格 schema 与新增切片审核通过。
- 每条记录的受益者、提供者、个人来源容器、选用食品、各1单位扣减、原批次时间/数量、饥饿前后与减48关系均核对；逐条重算量、营养和缓解，与每日日总量一致。
- 既有自主进食仍为1,325次、15,908营养；来源/加工流264条，普通 care 为0。四个切片共1,620个成功事件ID，无重复。没有合并为完整消费或生产总量。
- 与上一批保留的一年逐日证据做完整深比较：仅移除本次新增 `childCareMeals` 字段后，113/113条全部相同，包括原动作计数、库存/人口快照与其他证据，而不只是若干总数相同。
- 原年度内存 SQLite 提交与重载通过，钱款守恒、一次出生和原高龄死亡断言照常通过。此处是隔离引擎年度证据，不冒充持续逐步 durable-commit 的真实运行时会话。

### 最终验证结果

- 最终完整离线测试 **2,327/2,327** 通过，无失败、跳过或取消。新增幼儿供餐相关 **40** 项：实际动作/隔离21、运行时/writer10、独立审查9；合并既有普通care、自主进食、来源流和writer的定向组 **139/139** 通过。
- 最终 TypeScript 类型检查、服务端编译、Vite 构建、`git diff --check` 通过。Vite仍有既有大分块警告，没有把它隐藏为已修复。
- 上述一年复验及与旧113条逐日记录的完整对账全部通过。没有新增默认观测入口、没有读取真实存档或密钥、没有调用真实模型/浏览器/npm，也没有提交或推送。
