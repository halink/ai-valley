# 旧真实短测入口已关闭，仅保留离线合成回归

## 当前状态：默认失败关闭

2026-11-10 发布审查确认：旧 `run-nine-siliconflow-live.mjs` 只接受显式参数、近期价格时点和空环境，没有核对上次真实请求的远端结果/账单，也没有生产 admission/journal 的跨启动保护。换一个新目录可以重新获得九次请求上限，不能作为未决请求的恢复或替代入口。

当前旧真实入口已退休，不能用参数、环境变量、新目录或直接执行 guardian/worker 开启：

- `liveProbeLaunch` 保留旧参数/价格/环境错误诊断，但即使全部旧条件有效，仍返回 `legacy_live_probe_disabled_pending_reconciliation`。CLI 退出码为 2。
- 启动器已移除凭据读取、子进程和网络能力；兼容导出 `readConfiguredSiliconFlowKey` 只抛同一拒绝错误，不读取任何文件。纯字符串 parser 仍供离线测试使用。
- guardian 的默认/显式 `live` 和 worker 的 `live` 在导入运行时、建立目录、读取匿名凭据管道、spawn 或请求之前拒绝。不存在“直接启动内部程序”的备用路线。
- 保留的五个 synthetic 情景必须有严格 offline guard，guardian 只以 offline guard 启动 worker，worker 总是注入内存 mock fetch。它们不是可选择的真实 transport。

旧请求的远端结果、实际账单和取消状态仍未知，本次没有读取真实产物或把历史文档当账单。未来真实执行必须先完成[生产准入要求](production-model-http.md)，包括之前请求结果/账单核对、有效的当前官方精确型号免费价格和已有授权范围；这些条件满足也不会自动重新开启这个已退休入口。重新接入需单独实现并审查统一门禁，禁止使用旧入口、其他入口、代理或浏览器绕过。当前普通服务仍不因本修改接入模型。

以下保留旧协议、证据字段和离线回归用途的说明，**不是当前可执行的真实调用许可或启动指引**。

## 历史真实协议固定范围（现不可启动）

- 仅 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`；仅 `https://api.siliconflow.cn/v1/chat/completions`。
- seed5401原始九位居民，480开始，最多至540游戏分钟；不改初始库存、不补给、不改变动作规则。
- 1槽、最多9请求、内部180秒、每请求45秒、响应64,000字节；无重试、无备用、无付费升级。
- guardian从启动子进程之前计195秒硬上限，TERM宽限1.5秒，再KILL并最多等1.5秒。实际OS exit与进程组清空分别验证。
- fresh官方零价观察最多15分钟有效，启动时最多已过12分钟；过期、未来时点、倒退时钟、错误身份或非零价格关闭派发。

## 旧参数与合成目录

旧六参数格式仍能给出兼容诊断：`--live-probe --approved-fictional-data --price-observed-at <Unix毫秒> --output <绝对路径>`。完整有效格式也必定拒绝，不会读 key 或建立目录。flag 和时间戳从来不是用户同意、官方价格、旧请求核对或零账单的证明。

合成 guardian 仍在独占 0700 新目录内创建测试证据；SQLite 与 writer 依赖已有目录描述符能力锚定。拒绝已有目录、符号链接和真实 runtime 路径，不打开既有存档。模拟 key 只走匿名管道，不进入参数、环境或输出；读取管道有长度和五秒时限。

允许的内部情景固定为 `synthetic`、`stall_headers`、`init_block`、`sync_block`、`http_failure`。这些离线测试保留旧 JSON 协议字段、进程清理、mock HTTP、决定解析、证据封存和数据库重载的覆盖。manifest 的 `executionKind` 固定为 `mocked-http`，`dataApproval` 为 `synthetic-fixture-no-user-data`；结果的 `realModelExecuted` 固定为 false，实际费用与验收仍为 null。

严格 offline guard 是可信本地代码的防误用层，不是恶意代码或原生扩展的 OS 沙箱。历史 live guard/transport 源码保留用于纯内存 HTTP 形状回归，不代表启动权限，也不作为替代入口运行。

## HTTP、决定与停止

共用生产请求JSON、prompt和决定解析。headers、累计有界正文的字节/hash、精确响应model、id、usage分别持久化，然后才允许居民决定解析。只接受一个正常结束的completion，reasoning_content不作为决定正文。重定向、401/403/404/429/5xx、坏JSON、错model、超限/不完整body、无效决定、写入失败、超时与信号都终止当前片段，不转付费模型或在失败后继续重试。

fetch invocation不是供应商收到请求或已执行模型的证明。历史真实结果分开记录 networkCallAttempts 与 validModelResponses；只有收到有效匹配 model 的完整回复才将 realModelExecuted 标为 true，只有尝试而无确认回复时保持未知。当前合成结果一律为 false。Abort、进程退出和KILL都不证明供应商远端取消。

旧协议及保留的合成回归只支持初始九个founder ID；foreign/outside/新增角色请求即停止。这个限制使短测数据范围明确，但不代表未来十五日运行可以忽略来访、迁入、生育或境外人物。长测需要独立协议与审查。

## 零价依据不是账单回执

历史协议以官方[精确模型价格页](https://www.siliconflow.cn/pricing)与[免费调用说明](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation)共同作为有期限的零价准入依据；这不足以满足当前生产准入。账户是否完成认证、模型是否能在该账户调用，要由真实响应另行判断。禁止用余额、赠额、usage或HTTP200伪造费用回执。

transport始终保留actual/realProviderCost为null，不声称获取了逐次已结算账单。历史 runtime 的严格 opt-in `unreceiptedFreePolicy='siliconflow-deepseek-published-zero'`，只允许单独这个模型：有效官方零价条件下可以接受无金额回执的回复，但unknownCostRequests照常递增、confirmedCostUsd保持null、controlComplete保持false。不传此policy的旧验收仍在缺金额回执时立即停止；收到非零金额或畸形金额仍停止。没有注入 `acceptanceCostUsd:0`。

因此，证据完整封存、短测调用/解析成功和“全部实际费用已核实为零”是不同结论。`probeMechanicsVerified`仅核对隔离、进程退出、源码未变、证据完整、数据库重载一致和至少一份已接受决定；不代表十五日、生存、账单或远端取消通过。

## 输出

- live-manifest.json：冻结协议、授权范围标签、官方观察时点/来源、源码逐文件hash。
- provider-*.json：同步fsync的分阶段HTTP元数据，不保存key/prompt/raw正文。
- evidence/：既有hash链writer的决策等待、食物和控制终态。
- world.sqlite：本次全新游戏世界。
- live-worker-close.json：实际接受决定数、确切停止原因、数据库重载比较、费用未知状态。
- live-process-report.json / live-result.json：外部进程事实、恢复与短测判断。

mocked-http内部情景只供离线测试，使用严格offline guard、合成key匿名管道和固定假Response；主入口不接受这些情景参数。它们不能冒充真实调用。

合成 guardian 使用固定30秒总预算、TERM与KILL各1.5秒清理宽限，覆盖完整runtime冷启动、源码核对、决定处理、证据fsync和数据库重载。计时仍在 spawn 前开始，不因 ready 信号重置；历史真实协议的 195 秒外部/180 秒内部常量保留，但不再有可启动的真实路径。原合成3秒/200毫秒配置可能把正常完成误判为超时，尤其在全量测试并发负载下。回归额外核对运行时ready、实际退出/信号与关闭报告，不能让初始化超时代替HTTP或同步阻塞覆盖。

历史独立审查与实跑结果另行记录。旧真实入口现已关闭；合成通过不恢复真实执行权限，也不证明上次请求的结果或账单。


## 2026-11-09 合成时限修复验证

Linux、Node v24.22.1：修复前隔离成功场景实际被3秒总预算及200毫秒关闭宽限中断；修复后专项17/17、独立监督器/协议55/55、无凭据新副本全量4,883/4,883均通过，无跳过。全量379.83秒，包含原三项失败；其中冷启动成功场景耗时13.64秒。主TypeScript检查、服务器编译与禁用环境文件的Vite构建也通过，保留已有大块警告。[独立审查与既有边界](../reviews/acceptance-synthetic-deadline.md)另行记录。

这些是离线验证结果；没有重新尝试真实提供商、读取真实凭据/存档或完成十五日验收。原导出包不改写，需使用含本修复的新版本才能得到上述源码验证结果。
