# 普通一次照护供餐证据

## 有限范围

在默认关闭的 `directEatingEvidence` 入口中新增可选 `careMeals`，只覆盖引擎实际完成的普通 `care`。这不是完整消费账本：`longCare`、`tendChild`、专门的 `emergencyCare`、公共班次供餐、旅途、赠送、交易、腐败及其他消费不计入本字段。`tendChild` 已由独立可选 [childCareMeals](child-care-meal-evidence.md) 另行覆盖，不混入这里的普通 care。普通 `care` 本来支持的同意、幼儿监护和紧急权限仍照原规则执行，并记录具体权限类型；这不等于覆盖其他紧急照护动作。

自主 `eat`、来源/加工 `foodFlows` 与普通照护供餐各自列账，不混加成完整消费，也不把 meal 和 water 合成“食物份数”。`foodProduction` 和 `foodConsumption` 继续为 `null`。

## 成功动作的事实

先完成现有资格、当前同意、地点、真实需求和物资检查，再只读照护者原个人容器中即将消耗的批次。动作实际扣减后记录：

- 游戏分钟、成功事件、实际计划和动作定义。
- `providerId`、`beneficiaryId`、`person:<providerId>` 来源容器。
- 原 `proposalId`，无提议的监护/紧急权限保持 `null`，以及 `authority`。
- `inputs`：照护者实际减少的一份 meal 与配套的一份 water，各自数量分开。水的营养为0，批次为空。
- meal 原批次的生产/到期时点、定义、当次取用数量与该数量可核实的营养。按原事务相同的先到期顺序取用；混批时逐段保留。
- 受助者在动作生效前后的 `hungerBefore`、`hungerAfter` 及真实差值 `hungerRelief`。

普通 `care` 的现有规则是饥饿减22、最低0；本批次不改变该规则。固定22是缓解效果，不是餐食营养。原批次营养为25也仍可能只缓解22，低饥饿时缓解更小；原定义缺失则营养为 `null`，不会反算或回退到当前定义。批次数量不足以完整证明来源时保留 `lots:null` / `nutrition:null`。观测代码不调用初始化、不修补批次。原事务本身的旧存档初始化照常执行。

动作完成后，同一引擎步内其他居民仍可能代谢或行动；因此证据的 `hungerAfter` 是这次供餐生效后的即时值，不是整个 step 的末端值。不得用整个步长的净饥饿变化代替。

## 失败、持久提交与旧数据

提议撤回/过期、餐食在完成前腐败、水已用尽、到场或需求变化都会由原执行路径重新检查。未完成的动作不发成功记录；竞争中的另一照护者若发现当前不再需要基础照护，也不会虚报扣减。已用过的提议不能重放一次消费。

捕获器仍只绑定当前 World 对象的一次同步调用，`finally` 解绑；预测副本无记录。它不往世界、居民决策输入或存档中增加字段，也不是事务回滚器。直接 `stepWorld` 不启用记录；新的 `stepWorldWithFoodEvidence` 返回 `careMeals:[]` 才表示这次调用观察到零次成功普通照护。

运行时仍在 `WorldStore.commit` 成功并安装世界之后发布 `food_step_committed`，没有新默认入口。草稿供餐后数据库提交失败，世界及存储保持提交前状态，不发布草稿记录；重试成功只发一次。外部观察数据递归复制并冻结，观察器失败不会改变照护或模拟。证据 writer 自己写入/关闭失败时，已提交世界不会倒退，但证据覆盖保持失败或未知。

schema-1 旧记录可以缺少 `careMeals`，其余已存在证据照常可读；缺省不是零。每层对象和数组仍严格白名单，拒绝额外文本、访问器、稀疏数组、未知字段和非有限数。审核另外核对来源和人、提议/权限关系、meal/water实际数量、批次数量/时间/营养一致性、普通care缓解规则、时段与重复事件。它审核受信任引擎证据的内部一致性，不是外部数据真实性签名。

## 汇总、日期与重载

`careMeals` 独立给出逐物品单位数、可知营养、真实缓解和完成次数；未知营养传播为 `null`。未观测、事件丢失、重复、会话未关闭、writer损坏/缺seal均不能声称完整总量。writer顶层与 `directEating.careMeals` 内的两份结果在持久性失败时都会清空总量。零步会话没有采集能力标记，照护总量仍未知。

隔离逐日证据增加已观测/未观测分钟、原始明细和独立总量。同一天漏掉任何分钟之后，总量一直为 `null`，以后观察不能补平缺口。完整日界的动作归刚结束的一天 `(fromMinute,toMinute]`；运行时小数步跨日按记录自身时间分组，不补造无记录的日期。

SQLite内存重载保留未完成活动、原同意及原批次，完成后只记录一次；新观察会话不回填已完成照护。

## 离线验证

```sh
node --import tsx --test tests/care-meal*.test.ts tests/food-flow*.test.ts tests/food-consumption-evidence.test.ts tests/nine-resident-acceptance.test.ts tests/acceptance-evidence-writer*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
```

真实最终编号菜单→提议→接受→实际照护覆盖原批次混合、缓解上限、失败和竞争；内存SQLite、durable commit故障注入、严格writer和缺测反例另行覆盖。独立审查见[审查记录](../reviews/care-meal-evidence.md)。年度既有夹具主要执行 `tendChild`，它不在本切片范围内；其中普通care为0只验证观察覆盖和不扩张范围，不能代替普通care真实动作测试。

未访问密钥或真实存档，未调用真实模型、浏览器或 npm，未提交或推送；不代表正式九人长期模型验收。

### 本批次最终验证（2026-11-07）

- 全套离线测试 **2,287/2,287** 通过。新增普通care相关 **24** 项，其中独立审查 **10/10**；最终定向组 **24/24**、与既有eat/foodFlow/writer合并组 **99/99** 通过。
- 类型检查、服务端编译、Vite构建、`git diff --check` 通过。Vite仍提示既有大分块警告，本批次未改变该构建限制。
- 一年隔离复验 **113** 条日记录连续覆盖 **161,280** 游戏分钟；每分钟普通care观察完整，无缺口，内存SQLite年度重载通过。该年度夹具没有普通 `care`，所以此字段为已观测0；并未把实际 `tendChild` 冒充普通care。
- 既有自主进食仍为 **1,325** 次、**15,908** 营养，来源流仍 **264** 条；各事件不重复，完整生产/消费继续未知。普通care的实际供餐由新定向测试验证，年度零次不能作为它的成功执行证据。
