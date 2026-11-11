# 单候选免费模型契约：仅离线演练

本批新增 `src/server/acceptance-free-transport.ts`，只验证默认拒绝、证据顺序和停止语义。**没有真实 HTTP 实现，没有发送任何游戏数据，没有调用模型，也没有证明候选免费或用户批准发送。** 所有成功例都来自显式标为 `synthetic-fixture` 的内存夹具。

原 `run-nine-resident-acceptance.mjs` 仍仅接受 `--offline --output`。它不运行本契约，不增加真实运行参数，只在 manifest 附上 `freeCandidateContract` 的拟议配置，明确 `executedByThisEntry=false`、`gameDataSupported=false`、`liveTransportAvailable=false`，实际价格证据与数据批准均为 `null`。普通服务、生产 `completeModel`、`callModel`、runtime 路由和旧 writer 的 schema 均未更改。

## 与原方案分开

新协议 ID 是 `single-free-candidate-offline-contract-v1`，指纹独立计算：

- 候选固定为 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`。
- 提供商固定 `siliconflow`，精确端点为 `https://api.siliconflow.cn/v1/chat/completions`，不接受尾斜杠、别名或其他端点。
- 单并发，最多24次内存调用，整个契约20秒，请求从开始准备起最多5秒。正文最多32,000 UTF-8字节。
- 零预算，重试0，无备用，无自动升级，重定向拒绝。
- 账户范围仅 `synthetic-account-only`，数据范围仅 `fixed-offline-probe-v1`。请求内容是模块内固定的合成探针，不接受调用者提供的 prompt、居民、上下文、模型、URL、密钥或请求体。

它不是另一个可运行的九人十五日方案。原 `frontier-nine-15-game-days-v1` 的 Qwen 主模型、DeepSeek备用、16槽、21,600游戏分钟及开局保持不变。不能借本契约改写原方案或声称原方案已通过。

## 默认拒绝与显式假 transport

`new OfflineFreeCandidateContract()` 不具备任何执行能力。`start()` 必须同时收到合成价格证据、合成数据批准、同步证据保存函数及由 `createMemoryFreeTransport()` 创建的内存能力。

内存 transport 不是用户提供的 `send` 函数。模块通过私有 WeakMap 确认工厂创建的对象，普通对象、复制、代理和自带 `send` 的对象都不能替代；一个能力只可被一个成功开启的会话使用。响应头和正文由测试分别在内存中放行/拒绝，以覆盖卡住、晚到与异常。未知值在内部包装后进入 Promise，避免把 `then` getter 或 thenable 当作可执行响应。

价格证据必须精确绑定协议指纹、模型、端点、提供商和合成账户，包含来源引用、观察时点、失效时点、USD、输入/输出/推理/每请求/其他五类费率及合成硬零计费保证。所有费率须严格为0，不能缺字段、非数、过期或来自未来。数据批准独立绑定同样身份、固定数据范围、批准/失效时点和精确请求/墙钟上限。双方均只接受 `synthetic-fixture`，真实授权或供应商来源标签在此阶段反而拒绝。

这是**离线语义夹具的检查**，不是真实授权、价格验证、账户校验或官方账单验证器。价格标签、模型白名单、赠送额度、余额未变、token用量、HTTP成功，都不能使真实费用变为0。没有缺证据时的默认价格，也没有读取环境变量或凭据来补齐配置的分支。

启动先处于 `starting`，gate证据确认后才变为 `ready`；证据回调重入不能提前派发。验证后的数据属性被复制冻结，调用方后改对象不能扩大范围或推迟过期。每次派发及等待结束后均重验单调时钟、墙钟、请求时限、价格与批准。

## 独立记录，再解析

证据保存函数必须在同步完成持久化后返回严格的 `true`。`undefined`、Promise和异常均视为失败。模块自身不打开文件；调用方可使用已有独占新目录能力的 `writeJson`，以每事件不同文件名保留顺序。专项包含真实新临时目录、逐文件fsync写入和读回核对。内存测试使用内存sink，不把它标成磁盘持久化。

事件包括：

1. `gate`：合成证据的绑定身份、时间、五类费用、范围、上限、引用及指纹，真实授权仍为false。
2. `dispatch_intent`：本地请求序号、目标、模型、范围、价格/批准指纹、固定探针hash及超时。**派发意图不证明已调用 transport，更不证明网络已发送。**
3. `transport_invoked`：只表示内存transport已被调用，`networkDispatchConfirmed=false`。
4. `response`：HTTP状态、精确端点/模型是否匹配、响应声明模型或不匹配标记及原模型hash、合法请求ID、费用状态和回执信息。
5. `body`：有界正文的字节数和hash，不保存原始正文。
6. `decision`：只有前述记录全部确认后，才解析固定 `{ "choice": "wait" }` 合成格式。`appliedToWorld=false`，不会更改世界，也不是生产居民决定解析器。
7. `stopped`：终止原因、未知费用计数及真实费用/远端取消保持未知的结论。

回执必须显式标为合成，绑定本地请求序号、提供商请求ID、精确模型/端点/账户、USD、全部费用已最终结算声明、非负有限总额和引用。它独立于决定正文处理。即使响应模型错误、HTTP失败、正文损坏、JSON无效，已验证的合成回执仍单独保留。未知、缺失或不匹配回执不能填0；非零合成费用保留数值后停止。

`syntheticReceiptTotalUsd` 只累计已知合成回执；没有派发或存在未知请求时为null。`realProviderCostUsd` 永远null。保存失败会令 `evidencePersisted=false`，内存快照不是成功持久化、完整封口或磁盘恢复证明。文件序号及hash不是签名，本模块没有新增通用writer的哈希链或恢复器。

## 失败关闭

未批准、价格过期/未知/非零、模型或端点错配、重定向、限流、鉴权/HTTP失败、缺账单、非零费用、超时、时钟倒退、卡住的正文、超大/损坏响应、无效决定、证据写入失败、并发再入和停止信号均不返回可接受决定、不重试、不换模型。

本地终止会取消本地signal并让等待调用结束。晚到响应既不改终态，也不补账或接受决定。清计时器失败会停止；清理回调若重入停止，清理后再次检查阶段与请求身份，不能继续返回决定。`timerCleanupComplete=false` 保留清理失败，不等同证据存储失败。

这些是同线程、可信本地代码下的限制。单调时钟检查可拒绝被延迟调度的超时回复，但不能抢占同步阻塞的sink/clock或恶意代码。需要硬进程时限的运行仍须外部监督器；本独立契约尚未接入runtime/guardian的执行链。原离线入口的外部监督器与网络/凭据守卫保持原样，不宣称它们为任何任意导入本模块的程序提供隔离。

**Abort、TERM/KILL、进程退出、日志封存和本地计时器清理，都不证明远程请求取消或零收费。** 本模块无真实网络，但仍固定 `remoteCancellationConfirmed=false`，不把本地终止语义推广为远端事实。

## 仍未解决的真实运行关口

- 明确批准实际提供商、精确模型、运行范围、时长及游戏数据发送范围，覆盖可能进入请求链的创始居民之外角色。
- 运行当时、对应账户层级的官方零价及限额依据，覆盖所有收费项和不能自动变成付费的提供商侧保障。
- 可对应请求、语义可靠的费用回执或全部费用不计费保证；现有生产completion的token usage不满足此条件。
- 真实HTTP实现需独立审查重定向、响应模型、逐阶段取消、费用与解析分离，并与真实runtime、持久证据和外部进程监督整合。当前没有此实现。
- 完整九人十五日生活、精确午夜采样及其他原验收关口仍未完成。

如这些证据无法可靠取得，应继续保持拒绝，不能用本地 `hardZeroBilling=true` 或 `acceptanceCostUsd:0` 冒充已验证可运行。

专项与独立反例见 [审查记录](../reviews/acceptance-free-transport.md)。
