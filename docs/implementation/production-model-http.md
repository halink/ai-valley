# 有界 SiliconFlow HTTP 生产候选

## 当前状态

这是未接正式 main 的候选，不是已启用的生产模型。正式配置及 health 仍保持 `no-model` / `blocked`，不读取 key。仓库没有自动生成核对证据、启动此客户端或读取 `.env` 的入口。

仅实现并离线测试固定型号 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`，固定官方地址 `https://api.siliconflow.cn/v1/chat/completions`。没有 Qwen/GLM、Pro 型号、代理、自定义地址、重定向、自动重试或付费回退。

现有用户授权已覆盖免费型号的九人长测及虚构角色状态、记忆、关系和可选动作传输，不要求重复授权。**上次无响应真实请求的远端执行结果与账单仍未核对，因此当前不得创建可运行的 live 配置或发起请求。** 本批未读取 key、`.env`、正式档或旧真实运行产物，也未发起模型或浏览器请求。

## 证据准入，不用布尔值冒充核对

`production-model-admission.ts` 只验证可信审核方提交的结构化记录，不联网、不鉴定提供商或用户身份。一次准入需绑定：

- 同一 run/world、累计请求上限、创建/绝对截止时间、单请求时限。
- 既有用户授权的证据摘要及数据范围，零元支出限制。
- 上次未知请求的原始证据摘要、执行核对记录、账单核对记录、结果与核对时点。没有记录、未知金额、非零金额均拒绝；不得把“客户端已停止”解释为“提供商没有执行”。
- 官方 pricing 来源、精确型号、来源摘要、检查时点、适用输入/输出/其他费用均为零及有效期。未知适用价格或任一非零项拒绝。

记录摘要写入 gated journal 契约，之后换 run、预算、世界、证据或型号均不能续用原账本。单独写 `true`、环境变量“免费”、模型名称或 token usage 都不是证据。

这些摘要只固定**审核过的记录**，不证明来源真实性，也不是签名或账单核验服务。调用方必须实际核验原件，不得用合成测试数据、随意摘要或过期来源建立 live transport。现有授权可引用复用；上次未决核对缺失不能补造。当前没有将这一步交给用户可控 HTTP/环境参数的入口。

价格背景：2026-11-09T03:31:44Z 曾核实 [SiliconFlow 官方价格页](https://www.siliconflow.cn/pricing) 的该精确型号为 Free，输入和输出免费；[官方免费调用说明](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation) 说明免费模型调用账单为零。这是历史核查，不代表未来或本次账单。任何真实启动前需重新检查当前价格。候选将每次 dispatch 的证据新鲜度限制为最多 15 分钟，过期即锁停，不自动抓取价格或换证据放行；需要更长运行时，须另行实现和审查持久化的价格刷新/分段衔接。

## 派发与持久化

`createGatedSiliconFlowHttp` 默认关闭。只有显式 `enableLive:true`、gated 契约、全部准入记录匹配才可构建 capability；它不会自行调用 credential provider 或发送请求。测试用的 `createMemoryProductionHttp` 是独立品牌，无 fetch、key、URL 或任意 transport 回调注入。纯 `preparePinnedSiliconFlowDispatch` 用合成字符串测试实际 HTTP 请求准备顺序，不创建 live capability。

`ProductionSiliconFlowHttpCandidate` 复用 `ProductionModelJournal` 的 SQLite FULL/DELETE/EXCLUSIVE 机制：

1. 校验状态、准入、单槽、模型和输入字节限额。
2. FULL 提交 intent 后才允许传输；已存在 pending 或耗尽限额直接锁停。
3. 建立请求/绝对时限；读取 credential 后，在 fetch 前再次检查 owner、时间、价格、active request、pending id/phase/请求摘要。
4. 固定 POST、`redirect:error`、省略 cookies/referrer、禁用 HTTP cache；无重试。
5. header、流体累计大小、UTF-8、JSON、返回型号、单 choice、finish 和 usage 逐项检查。响应最多 128,000 bytes，不使用无限制 `response.json()`。
6. FULL 提交响应摘要后才交付结果。必须由世界事务 durable commit 后显式 acknowledge，才能清 pending；跨库不是原子提交。

401/402/403/429、其他 HTTP/流错误、重定向、身份不符、超时、时间回退、过期价格、损坏持久状态或写失败均锁停。关闭/超时会 abort 并停止本地等待，即使 headers/body 晚到也不能记为完成。不能推断远端取消成功。恢复遇到 intent 或 response pending 保留累计次数并拒绝自动重发，不能清空账本重领额度。

累计请求及绝对运行时间沿用 resumable 的 20,000 次/6 小时实现天花板；这是实现限制，不是新增授权或每次重启的新额度。单请求上限沿用 journal 的 150 秒。这里复用了 resumable 限额常量，没有把离线 resumable runner 接到真实模型，也不代表九人十五日验收已经完成。

## 费用与生产限制

`spendingLimitCny:0` 是用户限制，不是提供商硬锁。没有证据证明 SiliconFlow 提供或已启用本候选可用的账户零预算硬锁；本实现不虚构该能力，也不把它设为额外授权门槛。即使当前官方免费，未来改价、账户条件变化、网络失败或远端未知结果仍意味着客户端无法绝对保证零收费。

usage 只记录观察，不折算账单，`actualProviderCostCny` 一直为 `null`。synthetic 状态明确没有真实执行；gated journal 有 intent 后的 `realModelExecuted` 为 `null`，表达“可能已远端执行”，不是假报未执行。`providerBudgetEnforced:false`、`remoteCancellationConfirmed:false`、`readyForProduction:false`、`acceptancePassed:null` 不因本批测试通过而变成成功。

生产路径仍需可信证据审核与凭据提供方、隔离存储接入、长期分段/刷新和世界事务衔接。调用方持有 SQLite 句柄及 world acknowledge 权限，是受信任本地代码；这不是抵抗恶意同用户修改数据库/代码的安全边界。

## 验证范围

全部使用仓库内独立合成 SQLite、品牌内存 HTTP 和纯请求准备。覆盖默认关闭/credential未访问、准入缺失/更改/过期/非零/未知、固定模型及HTTP选项、header/流界限、UTF-8分片、网络错误、超时/晚到/取消、持久化失败、审计损坏、跨重启pending/累计上限、世界ack要求和正式模式保持关闭。

独立审查记录见 [production-model-http](../reviews/production-model-http.md)。真实 HTTP、真实 key、provider 账户/账单、真实长期模型验收均未运行；合成通过不能替代这些证据。

本批最终离线验证：

- 新 HTTP 两文件独立重跑：40/40 通过。
- HTTP + 既有 production-model-safety 四文件：66/66 通过，包含已有 SIGKILL/跨进程守卫。
- `tsc --noEmit` 与 `tsc -p tsconfig.server.json` 通过。
- Vite 以 `build({envDir:false})` 构建通过，显式禁用 `.env` 自动读取；只保留已有大 bundle 提示。
- `git diff --check` 通过。本批未单独运行全量套件，待统一验证；没有 commit/push。
