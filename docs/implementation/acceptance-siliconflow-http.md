# SiliconFlow 单模型 HTTP 形状与九人离线接线

本批继续准备受控九人测试，但**仅运行内存模拟 HTTP，没有真实 HTTP client/adapter、live CLI、凭据或实际数据发送**。默认真实运行保持关闭。公开 `run-nine-resident-acceptance.mjs --offline`、原 Qwen 主模型/DeepSeek 备用的十五日拟议方案以及原固定探针契约均不变。本模块不是另一条获准真实运行的入口。

## 复用的生产路径

- `model-completion.ts` 抽出纯 `modelRequestPayload` 和 SiliconFlow 精确端点常量。生产 `completeModel` 与本批模拟共用请求 JSON；原 Qwen 流、DeepSeek/GLM thinking 参数、temperature、token上限和生产路由保持原规则。
- messages 仅序列化一次，得到快照后检查 UTF-8 字节数并构造 body，防止访问器/toJSON 双次求值使检查值与发送值漂移。
- `decisions.ts` 抽出纯 `parseModelCompletion`。生产 `callModel` 与离线九人接线共用编号、时长、目标重复及错误反馈解析，而不是在测试入口另写一套居民决定规则。
- 本批复用的是生产请求编码和决定解析，**不是生产 fetch 网络调用**。生产 fetch 仍不是受控验收入口，不能把它直接接入本批而宣称获得相同保护。

## 单候选模拟能力

`acceptance-siliconflow-http.ts` 只接受 `createMemorySiliconFlowHttp()` 创建的私有品牌能力，拒绝复制、代理和伪造能力。能力只能被一个成功开启的会话使用，不接受调用者的 fetch/send 回调或真实 key。

冻结协议为：

- 精确 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`。
- 精确 `https://api.siliconflow.cn/v1/chat/completions`。
- 单并发、最多24请求、整个会话20秒、单请求5秒、最多32,000响应字节。
- 重试0、备用null、请求redirect字段固定error。状态、精确端点或模拟redirected元数据有重定向迹象时失败关闭。
- headers 与 body 分别放行；支持分块、暂停、失败、取消和晚到。UTF-8严格解码，Content-Type和可选Content-Length校验，响应只接受精确model、一个choice、stop结束和非负安全整数usage。

这里验证 HTTP **形状和处理边界**。没有打开本地HTTP服务器，没有真实 fetch/Response 网络交换，因此不是实际DNS/TLS、代理、重定向或供应商响应兼容性测试。`redirect:'error'` 目前是请求记录断言，不是已在真实网络上验证的行为。未来真实adapter仍须另行实现、批准和独立审查。

请求时限包含本模块输入序列化、headers与body等待；计时器即使延迟触发，也会在各阶段检查单调时钟。上游runtime在调用本模块之前准备prompt，受整个会话/运行时限制，但不计入本模块的单请求准备时间。同步阻塞不能被同线程计时器抢占。

## 证据与费用分离

所有证据必须同步持久化并返回严格true，异步、未确认和抛错均失败关闭。先记录 gate、dispatch_intent、transport_invoked，再记录headers中的独立合成回执、body字节/hash、completion元数据和终态。gate、保存和清理回调重入停止后不能继续返回成功。

headers回执仅接受显式 `synthetic-fixture`，绑定本地requestId、providerRequestId、精确模型/端点、USD、最终结算声明及非负有限总额。没有回执、字段缺失或身份不符时费用保持未知并停止；非零合成费用保留后停止。HTTP失败或JSON损坏不会抹掉先收到的可核对合成回执。usage只是token数量，不是费用证据。

`syntheticCostUsd` 只属于夹具；`realProviderCostUsd=null`、`accountAvailabilityVerified=false`、`remoteCancellationConfirmed=false`、`readyForRealRun=false` 始终保留。公开价格页上的输入/输出免费标识不能证明本账户可用、覆盖所有收费项或远端已取消。没有将实际费用补零。

日志不保存prompt、正文、reasoning_content、原始异常或假凭据。正文仅保留字节数和SHA-256。`dispatch_intent`不证明网络发送，`transport_invoked`仅证明内存调用。HTTP事件各自独占写入文件并fsync，不宣称有原writer的哈希链或通用崩溃恢复器。

## 新九人世界的接线

`acceptance-siliconflow-nine.ts` 的 `createNineResidentHttpRehearsal` 要求先持有独占新目录能力，不接收数据库路径、恢复开关、环境变量或凭据。流程是：

1. 开启品牌模拟能力，再创建 `createFrontierWorld(5401)` 原开局；验证480分钟与九个唯一创始居民。
2. 独占预留新SQLite，初始化既有runtime和writer。只配置上述一个模型、一个槽，不改居民、物品、开局资源或权限。
3. 请求只允许这九个创始ID，foreign/outside或其他角色请求即停止。共用生产prompt/编码/解析，但数据只进入本地内存能力。
4. 真实runtime接收明确合成回执后桥接 `acceptanceCostUsd:0`。原writer里的confirmedCostUsd是这段合成演练口径，不是提供商账单。
5. 仅到482.5游戏分钟。正常关闭重新读取本次新数据库并比对世界指纹；记录 `http-close.json`，保持真实验收结论null。

runtime已有公开停止入口只接受manual_stop/signal，本批不扩展其schema。HTTP失败会先停止runtime，防止原有重试逻辑派发；runtime记录manual_stop，**精确失败原因在独立HTTP终态**，两者必须一起查看。调用方应在finally中执行返回的close并关闭目录能力。失败目录不可复用。

当前模块**尚未接入外部进程监督器**，manifest显式 `processSupervisorConnected=false`。项目已有离线guardian不能因此被当作自动保护这个新模块；本模块没有自己的公开运行命令。同步阻塞、进程崩溃、供应商远端取消、停机后续跑和真实15日验收均未验证。不得将本模块切换到真实模型后直接运行。

## 验证与剩余关口

新测试用空环境和网络/凭据读取guard，实际创建新临时SQLite并在完成后清理本次测试目录；没有读取.env、真实runtime档、key或联网。主测试包含九人各一次有效编号决定、精确短终点、重载一致、HTTP失败/坏决定/未知费用停机、超时和晚到证据不可追加。独立审查发现Buffer.slice共享视图问题，改为真正复制后反例通过。

复现新专项：

```sh
NODE=$(command -v node)
env -i "$NODE" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test \
  tests/acceptance-siliconflow-http.test.ts tests/acceptance-siliconflow-http-review.test.ts
```

实际账户可用性、运行时官方零价范围和供应商收费保证、具体数据/运行授权、真实HTTPadapter、外部监督器接入与真实九人十五日都仍待后续单独处理。无法可靠证明的项必须保持未知；不能用本地开关、合成回执或本批测试代替授权与费用证据。

独立记录及最终回归见 [审查文档](../reviews/acceptance-siliconflow-http.md)。
