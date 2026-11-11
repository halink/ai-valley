# 九人验收停止控制（默认关闭，离线准备）

本批提供可独立测试的 `AcceptanceStopControl`，以及 `ValleyRuntime` 的显式 `acceptanceStop` 选项。它没有真实模型运行命令，不读取 `.env`、密钥或真实存档，不开启服务、浏览器或网络。带此选项的 runtime 必须显式注入模型实现；直接使用生产 `callModel` 会在读取数据库之前拒绝。测试只使用假模型和内存 SQLite。任意同进程注入代码仍须受信任，这个检查不是针对恶意包装函数的沙箱，也不是实际运行授权。

拟议九人协议仍为游戏分钟 **480 → 22080**，共21600分钟。当前 `NINE_RESIDENT_PLAN` 中的 Qwen 主模型不是本停止控制的可用路由；不得无声替换模型或把旧配置称为满足免费限制。真实验收前仍须由用户确认实际模型、仅免费政策、墙钟和请求上限、隔离目录/数据库，以及完整接线和终止落盘方式。`--prepare` 依然只准备，不执行真实模型。

## 精确终点与缺样

调用者固定 `endGameMinute`，不能在运行中改目标。每次 tick 在保护性停表判断之前把推进量裁成 `min(原推进量, 终点−当前位置)`。只有成功提交的世界恰好等于终点，才生成只读 `AcceptanceEndpointSample`，保存世界ID、准确游戏分钟、提交版本以及逐人ID/存活状态/健康/饥饿/精力。完成后先撤销执行资格，再停止；最后的停止提交可能增加版本号，但不改变游戏分钟。

- 不越过终点再倒拨，不把相近分钟四舍五入为终点，不从库存或晚到回复补造终点。
- 终点没到、时间倒退、越界、提交或监听器失败，都保留 `endpoint=null` 或明确失败原因。已提交最终世界的监听器抛错时也保守缺样，不把提交成功误当整个采样成功。
- `observeEndpoint` 可同步接收只读样本。抛错或返回 Promise 均为失败，异步拒绝会被消费；不等待不受控 sink。
- `gameScopeComplete` 仅说明获得准确本地端点；`controlComplete` 还要求因终点正常关闭、无关闭问题及未知费用。二者都不是生存验收结论，`acceptancePassed` 始终为 `null`。
- 最后一小步会缩短 `dt`；这是显式验收停止语义，不承诺任意中间状态与无边界模拟完全相同。

控制状态和样本仍可由 `acceptanceStopStatus()` 读取。后续[最小离线集成](acceptance-integration.md)增加显式 `acceptanceEvidence`，按停止控制完成后的顺序保存终态、两条证据通道与源码指纹。未启用该选项时仍只在内存中。断电、SIGKILL或进程崩溃仍可能留下无终态的不完整段；必须按 reader 的 verified 和派生标志判断，不能仅凭 seal 文件存在或原始局部状态认定成功。

## 墙钟与请求上限

`maxWallMs` 为正整数，最多2147483647毫秒；`maxRequests` 为正安全整数，均无默认放宽。墙钟窗口从控制器 `start()` 开始，runtime构造和初始观测初始化不计入；需要覆盖整个进程启动时应由外部监督器计时。使用单调时钟而不是 `Date.now()` 计时；回退、非有限值或异常立即停止，时长保留 `null`。即使世界停表、没有新决策或模型永不返回，也有独立定时器触发墙钟停止；每次准入、同步准备后、模型调用紧前、回复后和采样后还会再次检查。

请求先取得单次 reservation；达到上限后，下一个准入尝试终止整段并中断在途请求，不能靠重试、回退或并发穿透。`requestReservations` 与 `dispatchedRequests` 分开：bookkeeping/sink失败后未真正调用模型的预约仍占用额度，但不算实际派发。所有居民、区域和外贸角色共用上限。上限不自动重置，控制器和启用控制的 runtime 都只能启动一次。

这是**本进程在可执行边界上的墙钟限制**，不是操作系统实时中断保证。JavaScript 同步引擎步骤、同步SQLite/证据写入、阻塞事件循环不能被同线程定时器抢占；到期后的下一可执行检查会停止，已发生的同步提交不会回滚。已派发的远端计算也不能据此保证立刻停止或不再计费。若未来正式验收需要硬杀进程的绝对墙钟保障，还须独立外部监督器，并把无seal/被杀运行明确保留为未完成。

## 免费白名单和费用未知

固定可用标识只包含 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` 和 `THUDM/GLM-Z1-9B-0414`。这只是候选标识范围，**不是对供应商现价、账户套餐或免费额度的确认**。每次运行必须提供其中非空子集，且所有已配置主/备路由在首个派发前校验。

`assessPrice(model)` 必须同步提供尚未过期的完整美元价格评估：输入/输出每百万token价格、每请求价格和其他费用均明确为有限的零。缺项、错误模型、错误币种、过期、负数、非有限值、抛错或无法查明价格都终止；任一正费用也终止。价格在每次预约和派发前重新评估，修改外部白名单数组不能扩张已构造控制器。

注入模型返回 `acceptanceCostUsd` 仅可表示该请求**全部已确定费用**，必须精确为零才能应用计划。普通token统计、未提供费用、部分费用、失败请求或未完成请求都不能当作零元。未知费用立即终止，非零费用记录后立即终止，不重试或改走备用。已知部分仍不能代表全部；有未知请求时 `confirmedCostUsd=null`。这不证明供应商收费正确，也不能撤回已经发生的收费；错误/过期的外部声明和不可信注入代码不在本组件可证明范围内。

## 终止、取消和晚到请求

可显式传入 `AbortSignal`，也可用 `bindAcceptanceTermination(source, stop)` 把调用者提供的 SIGINT/SIGTERM 源接到终止动作。模块导入不安装进程监听器、不调用 `process.exit`；解绑函数由调用者在关闭后执行。预先终止的signal不派发请求。SIGKILL、断电和事件循环永久阻塞不可捕获，按缺测处理。

停止立即撤销 runtime 代次、清空令牌并发送 AbortSignal，然后尝试持久停表和结束证据通道。无论存储/监听器是否抛错，旧请求都不能再应用计划、排队重试或释放新请求的槽位；停止错误进入 `issues`，不是成功关闭。停止提交失败时，两条证据通道保持开放/未知，不补发看似成功的结束事件。生产 `callModel → completeModel → fetch` 现在可接收外部signal，并与既有超时signal组合；这条传递只以mock fetch验证，没有真实请求。

忽略signal的假模型仍可晚到或永不返回，但其返回不会改变已停止世界。控制报告保留 `interruptedRequests`、`unknownCostRequests` 和 `remoteCancellationConfirmed=false`，不声称服务端已经取消。普通 runtime 的重启也增加代次检查，旧 Promise 的 finally 不能删除新同人请求；验收 runtime 则直接拒绝重启，续跑必须另开获批的新段。

## 离线检查

使用已安装依赖，不运行npm：

```sh
node --import tsx --test tests/acceptance-stop-control*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare
```

定向测试使用注入时钟、预先拒绝的fetch、合成九人世界、假模型和内存SQLite，覆盖精准尾步、并发/补槽上限、永不返回和忽略取消、晚到成功/拒绝、信号与回调重入、费用缺失、价格变化、时钟回退及停止持久化失败。独立复核与最终结果见[审查记录](../reviews/acceptance-stop-controls.md)。离线通过仍不等于九人十五日真实模型验收。

## 本批最终执行结果

2026-11-07，Node v24.22.1，最终源码全套 **2000/2000**，0 failed、0 skipped、0 cancelled。停止控制新增32项，其中13项由独立审查者编写，定向32/32；最终类型检查、服务端编译、Vite构建和 `git diff --check` 均通过。Vite仍有既有超过500 kB的分块警告，没有将它描述为解决。

首轮完整回归曾发现停止存储失败时误关闭旧证据的回归，已修复并添加两通道独立反例；失败记录没有隐藏或把首轮称为通过。最终全套在修复以及最终时钟边界补强后重新执行成功。

`--prepare` 实际执行成功，仍为9人、21600游戏分钟、`realModelExecuted=false`、`readyForRealRun=false`、`acceptancePassed=null`。本次清单覆盖283个源码/配置文件，源码指纹为 `2e3245f160a6e870e0b2bb35b2bfae1703ad5a94e9cea40a23e18f99ab2f4473`；后续源码变化必须重新生成。未调用真实模型、读取密钥或真实存档，未运行浏览器/npm，未提交或推送。
