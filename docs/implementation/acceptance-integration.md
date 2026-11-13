> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 九人停止控制与隔离证据的离线接线

本批把已有 `AcceptanceStopControl`、两条证据通道与 `AcceptanceEvidenceWriter` 最小接合。默认关闭，未改服务入口、准备入口或环境配置，没有可连接真实模型的新增 CLI。仅允许已注入模型的 runtime 显式启用；这不是对任意同进程包装函数的网络沙箱，也不代表实际运行授权。

后续[安全隔离离线入口](acceptance-offline-entry.md)已将本集成接入实际受监督runtime子进程和独占新SQLite，并用假模型核对短终点、重载与故障。没有真实transport、费用或数据发送授权，普通服务仍不启用。

九人拟议范围仍为 **480 → 22080，21600 游戏分钟**。本批仅验证短合成片段及故障边界，没有运行真实模型十五日验收。原拟议 Qwen 主路由不满足既有免费候选白名单，不会被暗中替换。DeepSeek/GLM 标识、测试中的零价声明和零费用回执都不是供应商当前可用性或免费额度证明；`freeModelAvailabilityVerified=false`、`realModelExecuted=null`、`acceptancePassed=null`。

## 显式 API 与生命周期

调用者自行创建独立测试数据库、全新 writer 目录、假模型与可控时钟。然后给 `ValleyRuntime` 同时传入：

- `acceptanceStop`：明确终点、墙钟、请求上限、候选模型、价格评估和可选时钟/signal。
- `acceptanceEvidence: {writer, sourceFingerprintAfter}`：writer 必须 open，起始世界 ID/分钟必须匹配，`sourceFingerprintAfter` 必须是同步返回 SHA-256 的回调。它在终止时重新提供指纹，不会代替调用者读取任何文件。

集成自动独占连接等待和已提交自主进食 observer。不允许同时另外传这两项 observer，避免重复或分叉收集。未启用时，原有 runtime 和独立 writer 用法保持不变。构造期间读取/初始化世界失败会 abort 已连接 writer；错误参数与默认生产模型在世界读取之前拒绝。调用者仍负责关闭自己创建的 store。

开始时先建立两条观测会话，再启动控制器，并记录 running 控制状态。正常终止的顺序是：

成功的每次世界提交会先更新控制器的已提交分钟，再通知证据或普通订阅者。这样订阅者在推进提交后重入终止，也不会把终态错写为上一分钟；该更新不补造 endpoint。

1. 控制器撤销准入，保存未完成预约身份，发送本地取消 signal。
2. runtime 撤销请求代次并清除槽位，提交停表世界，然后依次结束等待和进食通道。
3. 控制器收集 `shutdown_failed` 等关闭问题后才触发新的同步 `onStopped` 接口。不能在步骤2内部提前封存。
4. writer 追加严格 schema 的 `acceptance_control` 终态。只有没有提交/关闭故障、两通道真正 stopped、末次源码指纹与起点一致时才调用既有 close/readback 流程。

`runtime.stop()` 默认记录 manual_stop；显式 `runtime.stopAcceptance('signal')` 可供已有 `bindAcceptanceTermination` 接收调用者提供的 SIGINT/SIGTERM 源。模块导入不装全局监听器、不退出进程；调用者显式解绑。runtime 只使用一次，甚至 start 前已经 stop 也不能重新启动。没有自动重试、新建目录或续跑行为。

## 可观察事实与未知值

JSONL 新增 `kind=acceptance_control`，与 `decision_wait`、`direct_eating`、checkpoint、最终 close_status 共用序号/哈希链。它只保存固定允许字段：

- 精确控制起点、已观察终点、目标、墙钟/请求限制、单调已用时。
- stopped 原因，不把 wall_limit、request_limit、signal、cost_unknown 或 nonzero_cost 翻译成 scope_finished。
- 精确已提交 endpoint 的世界 ID、分钟、revision 和逐人 ID/生存状态/健康/饥饿/精力，缺样保留 null。
- reservation、真正 dispatched、settled、interrupted、未知费用计数，以及未完成预约的 ID、模型、`dispatched` 标志。
- 问题枚举、已确认总费用（存在任何未知请求即 null）、远端取消未确认和验收结论未知。

等待通道的 request_started 发生在模型派发前的记账附近，不能拿它代替 dispatchedRequests。未派发预约占用请求额度，却不伪装成模型调用或已发生费用。终止时仍有派发请求则其费用未知，即使发送了取消信号。晚到成功/拒绝不更新账本，不修改世界，不重试也不追加已结束证据。

reader 的 `acceptanceControl` 返回：

- `lastObservedStatus`：有效前缀中最后一条原始观察，可为 running。
- `finalStatus`：前缀中最后一条 stopped 原始观察，可能有失败问题；它不等于已验证终态。
- `verified`、派生 `gameScopeComplete`/`controlComplete`：还必须通过整段 seal、通道范围、控制原因、请求记账及终点一致性核对。
- 派生中断/未知费用/已确认总费用：段不完整或没有终态时为 null，不从初始零计数推定崩溃时仍为零。

原始终态可能先于封口时的 `evidence_persistence_failed`，所以即使原始 `controlComplete=true`，也必须看 `verified` 与派生标志。`complete=true` 只代表这一段证据一致关闭；wall_limit/signal 等中止段也可完整封存。零时长片段也可完整，两者都不表示十五日完成或生存验收通过。完整食物产量、完整消费、毛伤害和停机时长仍为 null。

## 失败与恢复

任何世界提交失败（包括失败一次但随后停表提交成功）都会阻止集成封口。停止提交失败不补发两通道的结束事件；可写入的控制终态保留 shutdown_failed。runtime/端点observer失败、通道失败、指纹变化或无法获取都会保留不完整段。writer 写入、fsync、close、回读失败均使派生结果不可信，禁止用已有端点或 checkpoint 补造完整范围。

`run-close.json` 存在不等于成功封存：它的字节可能已写出，后续 fsync/close 却失败。必须调用 `readAcceptanceEvidence` 检查整份文件、链、状态和 failure 标记，不能只看文件名或内存里的局部控制标志。failure 标记是尽力写入，磁盘完全失败时它也可能缺失。现有 Linux 描述符锚定、无符号链接祖先、独占新目录、O_EXCL 文件、0700/0600、短写/fsync/读回约束仍保留；不覆盖已有目录，不原地修复。

崩溃/SIGKILL可能只留下起始控制行和等待事件。这时终止原因、最终在途请求和费用均未知，reader 只读返回有效前缀，绝不补终点、补结束事件或续接旧 journal。恢复先只读查看旧目录，再显式建立全新目录/runtime/会话；可用 previousRunId 关联，旧目录字节保持不变，停机缺测不被填平。

世界库与 evidence journal 不是跨文件事务。世界已提交而证据尚未写出的崩溃窗口仍存在，并以缺测处理。注入式故障测试不是断电、设备可靠性或抗同权限进程篡改认证，也不是供应商账单验证。

## 外部监督与取消边界

同线程墙钟计时器不能抢占阻塞的 JavaScript、SQLite 或同步证据I/O。控制器的 elapsedMs 记录停止控制时的时长，不把随后封口耗时伪装成进程总耗时。构造初始化与关闭落盘也可能延长整个进程运行时间。因此，绝对进程墙钟上限需要独立外部监督器，尤其要覆盖初始化、同步阻塞和封口阶段；本集成批没有实现或启动正式运行监督器。后续[外部进程监督器离线批](acceptance-process-supervisor.md)已验证合成进程的硬时限与清理策略，仍未连接本runtime或真实模型运行入口。

SIGKILL、断电、同步死循环不能靠本组件完成优雅关闭。外部杀死的运行按无可信seal/缺终态处理。本地 AbortSignal 只能撤销本地执行资格，`remoteCancellationConfirmed=false`；远端计算是否停止、是否继续计费仍未知，不承诺硬取消。

## 离线验证方式

只使用已安装工具，不运行 npm：

```sh
node --import tsx --test tests/acceptance-integration*.test.ts tests/acceptance-stop-control*.test.ts tests/acceptance-evidence-writer*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare
git diff --check
```

测试用临时合成九人数据、内存SQLite、假模型、被禁用的 fetch、可控墙钟/单调时钟；合成子进程实际验证 SIGTERM 优雅关闭与 SIGKILL 无封口恢复。独立审查见[复核记录](../reviews/acceptance-integration.md)。未读取密钥或真实存档，没有浏览器、真实模型、提交或推送。

独立新增反例曾发现推进提交后的订阅回调立即终止时，终态分钟落后于真实已提交分钟。修复后先记录成功提交位置，再允许观察回调重入。独立复验保留 `signal`、准确分钟和 `endpoint=null`，不把终点附近的取消捏造成成功采样。

## 最终执行结果

2026-11-07，Node v24.22.1。最终源码全套 **2031/2031** 通过，0 failed、0 skipped、0 cancelled；新增集成31项（实施17项、独立14项），停止控制/writer/集成组合 **87/87**。类型检查、服务端编译、Vite构建、准备命令和 `git diff --check` 均通过。Vite仍保留既有超过500 kB的分块警告，没有声称已解决。

早期全套2026项及随后2030项的通过均是中间结果；最终2031项已在重入终态分钟修复及独立反例落地后重新执行。没有删除或弱化先失败的反例。

最终准备清单仍为9人、21600游戏分钟、`realModelExecuted=false`、`readyForRealRun=false`、`acceptancePassed=null`；覆盖283个源码/配置文件，源码指纹 `751137881c8afd04830caf320f2fff2fb404148f284fc17ce127a9cac1775732`。后续源码变化必须重新生成。本批未运行真实模型验收，未读取密钥/真实存档，未使用浏览器/npm，未提交/推送。
