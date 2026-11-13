> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 正式九人十五日验收：离线准备

本批只准备未来真实模型验收，**没有运行真实模型、读取密钥或真实存档，也没有得出九人十五日生存结论**。新增入口不启动服务、不读取环境文件、不打开数据库，不替换既有 `scripts/acceptance-long-run.mjs`。该多年脚本仍是三位初始人物的确定性生命周期夹具。

## 当前组件状态与正式执行缺口

初始准备批之后，[证据 writer](acceptance-evidence-writer.md)、[精确终点与停止控制](acceptance-stop-controls.md)、[runtime/writer 显式离线集成](acceptance-integration.md)及[外部进程监督器](acceptance-process-supervisor.md)已经分别实现并做隔离验证。停止控制覆盖有界墙钟/请求、逐请求仅免费条件、取消与晚到隔离、精确已提交终点；集成可持久保存控制终态与两条证据。监督器只接合成进程适配器，未接真实 runtime 或正式服务。

这些组件默认不启用。[安全隔离离线入口](acceptance-offline-entry.md)现已把全新目录/数据库、真实 runtime、writer 与实际子进程监督接起来，**只运行2.5游戏分钟假模型演练，没有真实模型 runner 或生产服务接线**。实际模型可用性、免费额度/费用证据、接收方与将发送的数据范围均未取得确认；拟议 Qwen 主路由还不满足停止控制的免费候选白名单，不能暗中换模型。逐午夜的精确库存/人口端点仍未提供，不能与已实现的最终目标分钟采样混为一谈。完整九人十五日运行、浏览器视觉和四季验收均未完成，新天气灾害调度仍默认关闭。

## 固定拟议协议与元数据

```sh
node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare > /tmp/nine-resident-preparation.json
```

只接受 `--prepare`；没有 `--run`、数据库路径或密钥参数。输出只是计划与指纹，不是存档。脚本直接通过现有本地 tsx 载入源码，避免把旧 build 当作当前实现；只读取 `src`、自身、package/lock 与 tsconfig 文件，拒绝源码符号链接，不读取 `.env`、`runtime` 或凭据。不会通过 npm 安装或下载依赖，也没有外部模型调用。

`NINE_RESIDENT_PLAN` 固定：

- `createFrontierWorld(5401)`，formal/frontier，初始九名本地活人及其具体 ID；不补给、不改库存、不重排身份。
- 从游戏分钟 480 开始，目标 22,080，持续 **21,600 游戏分钟**，不是十五条日报，也不是十五个现实日。
- 游戏一天 20 现实分钟，全球模型槽上限 16，主模型 `qwen3.8-flash`，备用 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`，完整当前 provider 限制随清单保存。原先 8/4 起始槽、预算、退避、回退、停表与保护行为不改。
- 没有停表时名义 300 现实分钟；这不是承诺的完成时长。模型等待、保护性停表和 tick 上限会改变实际时长，不能把等待乘游戏时钟比例当成损失。

清单保存版本、协议哈希、源码逐文件 SHA-256 及总哈希、Node/系统架构、完整合成开局哈希、地图和 definitions 哈希、具体初始名单。源码哈希覆盖脏工作树，不能仅凭 Git HEAD 或版本号断言实现一致。指纹是对账用，不是签名、秘密凭证或防篡改保证。未来运行还必须保存运行 ID、开始/结束墙钟时间、实际请求 provider、运行后的源码与锁文件指纹，以及终止原因。期间改变源码、模型、初始库存、时钟、并发或重启，都必须另记协议偏离，不能与原方案悄悄合并。

该配置是**拟议协议，不是模型调用或花费授权**。`realModelExecuted=false`、`readyForRealRun=false`、`acceptancePassed=null` 是有意保留的字段。没有真实 runner 或自动将结果升级为通过的逻辑。

## 两条运行时证据如何接入

`ValleyRuntime` 的最后一个 options 现可同时传入：

```ts
{
  mode: 'formal',
  dayMinutes: 20,
  modelSlots: 16,
  decisionWaitEvidence: { observe: writeWaitEventSynchronously },
  directEatingEvidence: { observe: writeFoodEventSynchronously }
}
```

以上仅示意两条独立 observer，不是完整 runner 或可直接启用模型的脚本。后续 `acceptanceStop` + `acceptanceEvidence` 显式集成会独占这两个通道，不能再同时传独立 observer；完整 API 见[离线集成](acceptance-integration.md)。验证只使用合成世界、内存 SQLite 与注入假模型，默认服务和旧隔离脚本没有自动打开运行时入口。

### 等待证据

沿用[逐人决策等待证据](decision-wait-evidence.md)。会话、排队资格、实际发出、回复/超时/失败、计划接受、重试、资格丢失和停止分别记录，墙钟、单调时间、游戏分钟分开保存。只把 `actorKind=resident` 的目标居民计入九人统计；来访、境外人员、外贸人物另列，且初始九人和后续人口要区分。

`wait_finished.reason=stopped/no_longer_eligible` 是删失，不是成功。等待已包含请求和重试，不能三次相加；多人的并行等待也不是世界停表时长。错误只输出安全代码，不保存原始错误、提示、模型回复或密钥。

### 已提交自主进食与后续独立切片

新 `directEatingEvidence` 在 `start()` 开始独立会话。每次真正推进时通过同一个 `stepWorldWithFoodEvidence` 执行世界引擎，但仅在 `WorldStore.commit` 成功并安装新世界后输出 `food_step_committed`，并在其他订阅者前发出。

- 草稿执行或存储失败，不发布其进食。存储已提交但订阅者抛错，仍保留已提交进食，避免漏报或重复回放。
- 启用与禁用的引擎选择、模型输入、请求顺序、完整正式九人 World 和 SQLite 重载逐项一致。观测不写入 World、公开 snapshot 或模型上下文。
- 每条带会话、连续序号、世界 ID、已提交 revision、精确起止分钟及独立冻结的回执。`receipts` 仍只覆盖成功 `eat`，保留原 event/plan/person ID、食品、实际份数、营养及单独的饥饿缓解值；同一个提交另可携带食物流、腐败、有限转移、各类照护/旅途供餐切片，不能混成自主进食或完整消费。当前食物流已包含留种与原型阶段，见文末版本说明与[逐日覆盖](isolation-evidence.md)。
- runtime 可能推进小数分钟，不得套入只接受逐分钟采样的 `createIsolationEvidence`。相邻进食区间以精确端点连接，停表没有新游戏区间，不伪造缺失的逐分钟状态。
- 需要日报时按回执自身 `at` 分桶；恰逢午夜归入刚结束一天。跨午夜的一个 runtime step 并不提供午夜库存或人口 snapshot，不能用 step 末库存冒充午夜库存。
- 只观测会话覆盖时段。会话内所有区间完整、正常关闭且文件验证通过时，才可将零回执解释为该区间没有自主进食；没有接入、缺行或异常时 totals 保持 `null`。

回调是受信任、快速、同步、非重入的外部 sink，不得通过闭包改变 runtime。事件及回执冻结，不含 World 引用。独立 observer 抛错或返回 Promise 时证据状态进入 `failed`、停止后续发出，不替居民行动或自行停止普通模拟；显式启用 `acceptanceEvidence` 时，验收控制另会停止运行并保留不完整段。失败并不承诺磁盘上的字节可恢复。慢同步 sink 消耗 CPU/墙钟，不能声称对真实时序零成本。

## 终止与可靠性

两个状态必须和原始 JSONL 一起外部保存：`decisionWaitEvidenceStatus()` 与 `directEatingEvidenceStatus()`。`auditDecisionWaitEvidence` 和 `auditRuntimeFoodEvidence` 用于读回受信任内部输出后的闭合、连续序号、会话/世界一致性核对。食物审核另验连续时间、递增 revision、回执时间和数量、重复 event ID。缺结束事件、状态缺失/failed、缺行、错误会话或端点不一致均保持未知。已观测回执数量可另列，不可称完整总量。

这些审核器不是任意外部 JSON 的解析器或防伪系统，调用方必须先做 schema/type 校验；伪造状态和重编序号不在信任模型内。等待日志完整也不等于时钟有效、每人均成功或十五日验收通过。

正式 runner 尚须落实以下接线与授权，不能把已实现组件误写为尚无功能：

1. 获得真实模型使用、实际提供商、仅免费政策/费用上限、运行范围和将向指定提供商发送哪些数据的明确批准。不能从准备清单、假模型零费用或已有插件/密钥推定授权。当前拟议 Qwen 与免费白名单不兼容，需明确解决而非静默换路由。
2. 新[离线入口](acceptance-offline-entry.md)已实现描述符锚定的独占新目录/SQLite和输出，拒绝已有目标与符号链接；正式真实模型接线仍须保留这些路径保护。不要读取/复制当前线上库；不能用准备元数据代替实际路径保护。
3. 显式配置已有[停止控制与 writer 集成](acceptance-integration.md)，验证实际文件系统、全新目录、源码指纹、逐类 JSONL、控制终态及 seal 读回。writer 已处理短写、I/O失败、fsync和一致性校验，集成已将失败保留为不完整；正式 runner 仍须实际接线并核验。标准输出重定向或仅存在 seal 文件不保证持久完整。
4. 事前固定并配置已有墙钟、请求数、信号与费用停止控制，再连接独立外部监督器和适用于正式进程的受信任适配器。现有监督策略及合成 TERM→KILL 测试不能代替生产接线或证明远端取消、零费用；崩溃、未落盘区间或缺失终态不能报完整。
5. 验收 runtime 已限制为单次使用，普通 runtime 也已增加请求代次与晚到隔离。恢复仍须新 runtime、新会话、新起点及新输出目录，保留重启和停机缺测，不用人物 ID 硬拼完整时段；这些本地隔离不证明远端请求已停止。
6. 目标为精确 21,600 游戏分钟。显式停止控制已将最后 tick 裁至 `endGameMinute`，仅对恰好提交的目标分钟采样并保留失败/缺样；这是一项明确的验收尾步语义，不承诺与无边界运行的任意中间状态相同。正式 runner 须使用并核验此结果，不能以附近/越界时刻代替；逐午夜库存与人口的精确采样仍待实现。

当前已具备默认关闭的 writer、停止控制、终点采样、信号绑定、显式离线封存，以及安全独立数据库与真实runtime子进程的离线监督接线。仍缺可启用真实模型的受控transport/运行入口、真实免费条件和数据发送授权，以及午夜精确采样。组件验证、证据完整封口、目标分钟到达和可持续生存是不同结论，必须分别报告。

## 未知量与未来结论

完整 `foodProduction`、`foodConsumption` 和毛健康损伤仍为 `null`。自主 `eat` 切片不含幼儿喂养、公共/长期照护供餐、旅途或加工投入；后续独立切片已覆盖其中明确列出的普通/儿童/紧急/长期照护、公厨、访客/家庭旅途、留种及原型等路径，但仍不是全部医疗、境外生活或消费。库存减少、动作次数、饥饿变化均不能补作总消费。也不能从存量上升反推生产。九人的死亡、离开、迁入、健康与库存应按具体证据分别报告，不能仅凭模型返回成功或九人还存在就判定“可持续生存”。

## 离线回归

只使用已经安装的本地工具，不调用 npm：

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/nine-resident-acceptance.test.ts tests/decision-wait-evidence.test.ts tests/food-consumption-evidence.test.ts tests/runtime.test.ts tests/model-routing.test.ts
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare > /tmp/nine-resident-preparation.json
```

新测试冻结定时器，只手动 tick，并禁止 fetch。覆盖固定协议、重复指纹、未知参数拒绝、真正引擎进食、提交失败、订阅者异常、同步/异步 sink 失败、停表、缺行/重复/错误时间/会话、午夜归属、删失等待、完整状态与上下文不变性、内存重载。现有等待夹具也固定 setInterval，避免只固定 Date.now 时在机器较慢的情况下额外 tick 造成假失败。

独立审查见[九人验收准备复核](../reviews/nine-resident-acceptance-preparation.md)。完整命令与实际结果随该文更新，不能把离线假模型回归称为真实模型验收。

## 初始准备批最终执行结果（历史记录）

2026-11-07，在 Node v24.22.1 下执行最终源码：类型检查、服务端编译、Vite 构建和 `git diff --check` 通过；全套 **1,944/1,944**，0 failed、0 skipped。本批新增17项，其中6项由独立审查者编写；独立审查的合并定向组69/69，最后固定名单/源路径补强后的新测试17/17也再次通过。构建仍有既有超过500 kB的分块警告，未将其描述为解决。

准备脚本实际执行成功，清单覆盖280个源码/配置文件，九人名单与21,600游戏分钟目标正确；该批次源码指纹为 `abf7d76b5f137db3e62a737efe6520b8a66bc7600e5f0d9e9e70de92a982ad1e`。该指纹只描述本次工作树内容，后续代码改动必须重新生成。

原有多年脚本未改动，另执行一年 `--daily-json` 并逐日对账：113条日记录、161,280游戏分钟、1,325次自主进食、15,908营养值，年度内存存储重载通过，与原夹具结果一致；缺测分钟为零，明细与总量/已完成eat一致。技术/模型等待、完整生产和总消费继续为 `null`。这是原三人起始确定性夹具的回归，**不是本协议的九人十五日真实模型数据**。


## 历史留种阶段覆盖

[本人留种加工证据](seed-saving-food-flow-evidence.md)新增真实 `production.saveSeed` 的 `processed/saveSeed` 回执：根菜1份投入、非食品种子2份输出（零营养、无食品批次）。该阶段覆盖为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1`，此前标记可读但不能证明留种已观察；当前已升级为下述包含原型的版本。日报与九人主链只计加工两侧，不算新增粮食或摄入；原批次未知保持null，plantCrop及未列路径仍在范围外，完整生产/消费账仍未知。


## 当前食物流覆盖（含原型）

当前 `FOOD_FLOW_COVERAGE` 为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_prototype_v1`，与[记录器](../../src/world/food-consumption-evidence.ts)、严格 schema、日报、运行时审核及九人只读核对一致。[鲜鱼晾晒原型](prototype-food-flow-evidence.md)在真实开始时记录一次鱼投入，成功时另记鱼干产出；失败/放弃只保留终态，不再次扣鱼、伪造腐败或算作摄入。原型与留种都属于加工，不是来源新增。

旧 `...seed_v1` 及更早标记仍可读取，但不能证明原型已观察，当前范围的总量保持 `null`；明细和历史验证不被改写。原批次未知、漏采与未列路径继续保持未知，`foodProduction` / `foodConsumption` 不因局部覆盖增加而成为完整账本。
