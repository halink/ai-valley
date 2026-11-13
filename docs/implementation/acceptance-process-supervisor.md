> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 九人验收的外部进程硬时限：离线监督器

本批只交付**默认不接线的外部监督策略及合成进程验证**。没有真实模型 runner、服务/CLI 接线、密钥或真实存档读取，没有新增数据发送途径；正式九人十五日验收仍未运行、未授权。本批也没有修改既有运行时、停止控制、writer 或证据 schema。

`src/server/acceptance-process-supervisor.ts` 不导入模型、数据库、文件系统或配置。它不能自行启动服务或模型：调用者必须显式注入一个非阻塞、受信任的进程适配器。初版具体适配器位于 `tests/helpers/acceptance-supervisor-fixture.ts`，只能选择固定合成场景，不能传入命令、脚本、可执行文件、环境变量或模型参数。后续[安全隔离离线入口](acceptance-offline-entry.md)另接通真实runtime子进程、全新SQLite和writer，但仍只注入假模型；两者均不是正式真实模型入口。

## 时限与终止顺序

`AcceptanceProcessSupervisor` 是一次性状态机。单调时钟、定时器与进程观察接口可注入，测试不依赖改变真实系统时钟。

1. `start()` 在调用 launch 之前记录起点并装定时器。预算从子进程启动前开始，**不等 ready/heartbeat，也不因这些消息重置**。子进程导入、初始化、同步死循环、同步证据写入和关闭均发生在另一个进程，不能堵住监督器事件循环。
2. 到 `maxWallMs`，对**本次独立进程组**先发 `SIGTERM`。即使子进程尚未完成初始化也适用。
3. 到绝对宽限终点，再发 `SIGKILL`。从 KILL 阶段起只等待 `killWaitMs`，不无限等待 child close、IPC断开或管道EOF。
4. 延迟触发的定时器不能从实际唤醒时间重新赠送完整宽限。最终观察窗口是起点加 `maxWallMs + termGraceMs + killWaitMs`；父中断和提前退出后的孤儿清理使用更早的清理窗口。
5. 观察到 leader exit 还不够。若进程组仍存在，继续 TERM → KILL 清理。若组消失但从未收到 OS exit，结果仍为 unknown，不能据此编造退出码。

这不是实时操作系统保证。监督器本身必须持续得到CPU并保持可响应，launch/adapter方法必须非阻塞；监督器的同步死循环、OS调度停顿、不可中断内核I/O、系统暂停或整个机器断电不受这个状态机抢占。实际进程耗时单独记录，不替换 runtime 停止控制自身的 elapsedMs。时钟失效或定时器失败时尽力发 TERM/KILL并立即返回未确认状态，不假装已完成有界等待或确认所有进程死亡。

## 父进程与孤儿

模块导入不安装全局信号监听器、不调用 `process.exit()`。测试 guardian 显式绑定 SIGINT/SIGTERM，收到信号后由监督器执行清理，再解绑并返回130/143。重复父中断可提前进入 KILL，但不重复发送或覆盖首个原因。

合成进程树使用 Linux 独立进程组。适配器只能从刚创建的 ChildProcess取得 PID，不能接受任意 PID；`kill(-pgid, 0)` 是组观察，`kill()` 成功仅是发送结果。确认组不存在后锁定 absent，不再给这个已结束组发信号。实现不等待 stdout close，后代持有管道也不能使父进程无界等待。

测试还有独立 **owner → guardian → worker** 拓扑。guardian持有自己的时限，owner管道EOF触发 `parent_disconnect`；即使owner被SIGKILL、worker在同步死循环，guardian仍可清理。**这只证明合成拓扑**，正式运行没有接入此guardian。若guardian本身被SIGKILL、与owner同属被杀进程组、内核/机器失效，则不能靠其自身代码继续清理；生产级cgroup/容器/服务管理器、逃离进程组的后代、PID复用与同权限恶意进程不在本次已验证保证内。

孤儿收到SIGKILL后可能成为等待容器init回收的僵尸。测试检查指定合成后代已不存在或为Z态，不把“已不执行”混同于“进程组完全消失”。若组仍被探测到，`cleanupComplete=false`，保留 `group_unconfirmed`。不会为消除这个未知值去杀不属于本次运行的进程。

## 状态不能互相冒充

返回值把以下事实分开：

- `trigger`：child_exit、wall_limit、parent_signal、parent_disconnect、启动/传输/时钟/定时器失败。
- `exit`：真正的 OS child exit 事件及退出码/信号。不能由子进程IPC自报、输出文字、kill成功、管道关闭或超时推断。
- `outcome`：exited_zero、exited_nonzero、signaled、not_started、unknown。SIGTERM后正常退出仍记录 `exited_zero`，同时保留 wall_limit/parent_signal原因。
- `signals`：TERM与KILL分别为not_attempted、sent、not_found或unknown。
- `groupState`、`cleanupComplete`、固定错误码：退出未观察、组消失未确认和信号权限失败都明确保留。

零退出码不表示完成游戏范围或验收。即使实际本地SIGKILL已观察，`remoteCancellationConfirmed=false`，`confirmedCostUsd=null`，`realModelExecuted=null`，`acceptancePassed=null`。监督器不查看模型请求或账单，不能证明远端计算终止、免费额度或零费用。原Qwen主路由与免费候选白名单的冲突没有被暗中替换或解决。

终态为一次快照，晚到/重复exit、旧timer、重复interrupt不能继续修改内部终态或自动重启；返回副本的修改也不能影响控制器。原始异常文本、栈和子进程日志不进入报告。

## writer 只读恢复与安全路径

监督器不写 writer journal、不补终态、不补 seal，也不把进程退出原因塞进未完成的 acceptance control。进程被强杀后，只能对已存在的合成目录调用既有 `readAcceptanceEvidence`：有效前缀仍可查看，最终中断请求、费用、终点和验收结论保持未知。实际SIGTERM的合成writer可以封存一个 signal 中止段，但没有 runtime acceptance control，这也不是九人十五日完成。

特意测试了**seal字节已写出但seal fsync同步卡死**再被SIGKILL的窗口。此时只读reader可得到 `complete=true` 的一致逻辑段，但这不证明fsync返回、断电持久性或进程正常完成；监督器仍记录实际SIGKILL与wall_limit，验收结论未知。两份报告必须并列保留，不能用可读seal覆盖OS中断，也不能为让它显示失败而改写旧目录。

恢复测试逐字节核对读取前后文件一致；旧目录拒绝再次创建writer，后续合成段只能显式创建全新目录并通过previousRunId关联，不能拼接缺测。合成进程验证受限路径、`..`和符号链接祖先被writer拒绝。既有Linux描述符锚定、独占0700/0600、O_NOFOLLOW等限制不变。

全部具体进程都在新建 `/tmp/valley-supervisor-fixture-*` 私有目录内运行，只有固定合成脚本，子进程环境为空，无继承NODE_OPTIONS、PATH或凭据，无shell。fixture禁用fetch；这不是对任意恶意代码的网络沙箱。没有读取 `.env`、runtime目录或真实存档，也不把合成结果包装为远端执行授权。

## 离线验证

使用已安装工具，不使用npm或浏览器：

```sh
node --import tsx --test tests/acceptance-process-supervisor*.test.ts
node --import tsx --test tests/acceptance-process-supervisor*.test.ts tests/acceptance-integration*.test.ts tests/acceptance-stop-control*.test.ts tests/acceptance-evidence-writer*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare
git diff --check
```

覆盖受控时钟、子进程故障/卡死、初始化与封口阻塞、忽略TERM、OS信号、父中断、owner死亡、孤儿/继承管道、有界未知结果、事件重放、安全路径与writer只读恢复。独立反例及复验见[审查记录](../reviews/acceptance-process-supervisor.md)。

独立反例发现并修复旧timer回放泄漏、信号重入时终态早于发送结果、同步timer误启动、超期信号/错误延长宽限、嵌套回调漏记已到达OS退出等问题；额外probe重入反例也已修复。修复保留原反例，不弱化断言。

## 最终执行结果

2026-11-07，Node v24.22.1。最终源码及seal-fsync精化fixture完整回归 **2069/2069** 通过，0 failed、0 skipped、0 cancelled。新增监督器 **38项**（实施29项、独立9项），监督器/集成/停止控制/writer组合 **125/125**。独立审查无剩余阻断项，另单独复验最终seal-fsync场景1/1。

类型检查、服务端编译、Vite构建、离线准备命令与 `git diff --check` 全部通过。Vite仍报告既有超过500 kB的分块警告。早期2059项、随后精化fixture前2069项都只是中间结果；最后在所有代码与fixture定稿后重新执行2069项，没有省略失败反例。

最终准备清单仍为9人、21600游戏分钟、`realModelExecuted=false`、`readyForRealRun=false`、`acceptancePassed=null`。覆盖284个源码/配置文件，源码指纹 `8eaefbaebb7a514d33bca97414eaff8ae3d6da9a72048959e2af61ec5976b462`；后续源码变化须重新生成。

没有读取密钥/真实存档，没有调用真实模型、浏览器或npm，没有提交/推送。真实免费模型可用性、数据发送批准、正式监督入口及实际九人十五日结果仍未取得；本次不承诺远端取消、零费用或生产级不可逃逸进程隔离。

## 2026-11-07：高负载测试时序修正

后续并发构建/隔离年度运行暴露了测试假设，而不是需要延长的生产截止：真实进程用例原先同时要求从 launch 起的 1500 ms 预算、必然收到 ready，以及报告耗时小于4000 ms。子进程的 Node/tsx 启动和模块导入也在这1500 ms内；CPU争用时，监督器在 ready 前终止子进程正是预期行为。监督器本身的调度延迟同样不受实时OS保证。独立原版38/38通过；同一CPU上12个有限忙循环使原 `init_block` 稳定失败为 `ready.length: 0 !== 1`。

本次没有改 `src/server/acceptance-process-supervisor.ts`，没有增加生产预算、TERM宽限、KILL观察窗口，也没有把生产时钟改成从ready开始。测试分成两层：

- 状态机用可注入时钟严格验证启动前计时、1500 ms TERM、1620 ms KILL、最终观察界限，以及延迟回调不能赠送新宽限。原有100/120/150 ms边界与过期回调反例仍保留。
- 卡死场景仍是真实独立进程、真实同步死循环/阻塞fsync、真实进程组信号和OS exit。只有测试驱动时钟由父进程在明确事件后推进，避免把导入速度当成功能。`init_block`、`sync_block` 的ready从死循环内部发出，`seal_block` 从实际seal fsync卡住处发出；`ignore_term`还必须确认子进程实际收到并忽略TERM，才推进宽限。零/非零退出的ready先完成IPC发送，避免立刻exit丢消息。
- 新增 `never_ready` 使用未修改的真实system clock：从launch前开始1500 ms预算，整个场景不发送ready，也必须触发wall_limit。OS exit尚未及时观察时保留unknown，不伪造清理。它和精确模拟时钟断言一起覆盖“无需ready的硬截止”和实际调度边界，而不是继续断言机器必须足够快。
- 父INT/TERM、owner被KILL后的EOF、孤儿/持有管道、真实KILL和只读证据字节检查仍保留。孤儿在KILL后等待`/proc`显示死亡或Z态，再推进最终观察窗口；不会由发送成功推断死亡。

测试日志分别记录guardian启动开销、worker ready耗时、整体真实墙钟和监督器注入时钟，不能混称真实耗时。12秒测试看门狗和15秒单测超时保持原值；看门狗只负责让缺失事件失败并清理，不会把超时记为通过。失败清理也修正为：即便guardian管道已close，只要已知worker进程组没有被确认absent，仍清理该组；close不再冒充进程组消失。仍无法从未交付PID的启动崩溃推导进程身份，这不是生产级隔离方案。

### 可重复负载对照

在本次Linux环境中CPU 0可用，以下只启动有限合成CPU负载，结束时清理自己创建的负载进程；其他环境须选择允许的CPU。原版和修正版使用相同 `synthetic init_block` 名称片段：

```sh
pids=''
trap 'kill $pids 2>/dev/null || true' EXIT
for i in $(seq 1 12); do
  taskset -c 0 node -e 'const end=performance.now()+12000; while(performance.now()<end){}' >/dev/null 2>&1 &
  pids="$pids $!"
done
taskset -c 0 node --import tsx --test --test-name-pattern='synthetic init_block' tests/acceptance-process-supervisor.test.ts
```

原版该用例失败，修正版通过。再把负载持续时间改为30000 ms，测试名称改为 `injected deadline kills real synthetic|real wall deadline`，最终版本 **5/5通过**。在这次持续负载中，init/sync/ignore_term的worker ready耗时为2227/5556/5894 ms，足以直接否定原1500 ms必然ready的假设；对应监督器逻辑时钟均严格为1620 ms，TERM与KILL阶段边界也分别通过。

另一次受控调度暂停实验只对本次合成guardian发SIGSTOP，在4200 ms后恢复：未修改的system-clock监督器报告elapsed=4406 ms、wall_limit、TERM/KILL均已发送，但exit尚未观察、cleanup仍未知。这直接重现了旧 `<4000 ms` 断言不具备OS保证的原因。该实验不是增加测试时限或生产暂停逻辑，实验后清理本次worker组；自动回归用已有延迟时钟反例确定性覆盖同类边界，不要求每次全量测试暂停机器调度。

最终版本主套件与独立review为 **39/39通过**（30主测试、9review），两个安装版TypeScript检查和 `git diff --check` 通过。独立review另重现并验证了guardian错误退出后的已知worker清理。全仓并发与构建/年度负载结果由本轮整体验证另外记录；以上专项结果不替代整体验证，也不代表真实模型验收。

### 本轮首轮并发整体验证

冻结代码后，独立验证者在09:06:49Z同时启动 `node --import tsx --test --test-concurrency=4 tests/*.test.ts`、两个TypeScript检查、禁用外部配置/环境文件的Vite构建，以及一年隔离脚本。第一轮全量 **2373/2373通过**，154.49秒，failed/cancelled/skipped/todo均为0；没有先失败再重试。前后所有src/tests/scripts中的TS/MJS文件哈希一致。服务端编译、类型检查和构建均通过；Vite仍只有既有大于500 kB的分块警告。

年度隔离运行的113份日报连续覆盖161280分钟 `(481,161761]`，内存SQLite重载及逐日动作/营养/份数/明细与总量/事件去重/通道缺测对账全部通过。自主eat为1325次、15908营养，来源264条、1320浆果、15840营养，孩子照护31次、31芜菁与31水、620营养、1488饥饿缓解；普通care与longCare是已观测零，不能充当这些场景的正例。完整产量/消费等仍为空，不因本次监督测试稳定化改变证据含义。

复现日志位于本次临时验证目录 `/tmp/valley-supervisor-load-first-l9Jm8P/` 的 `full-tests.log`、`year-regression.log`、`year-audit.json` 和 `timing.txt`。这些离线结果不包含真实模型、真实存档或正式九人十五日运行。

### 后续缺失 report：测试时钟停止推进，而非生产截止放宽

后续一轮并发全量曾为 **2803/2804通过**，`sync_block` 未得到最终report；此前独立30/30及串行2804/2804通过并不能解释或消除这次失败。本轮找回原始失败输出：worker在约899 ms已ready，TERM与KILL分别在注入1500/1620 ms发出，随后真实OS `exit(SIGKILL)` 已观察到，但同次进程组探测仍为 `present`。原测试驱动只为orphan/hold_pipe推进KILL后的时钟，普通场景一直停在1620；监督器安排的1630 ms探测因此永不执行，最终12秒测试看门狗杀死guardian。该证据区分了启动缓慢、OS退出、进程组消失和最终报告，不推断当时残留成员的身份。

生产监督器在真实时钟下会继续执行后续poll；本轮没有改变 `src/server/acceptance-process-supervisor.ts` 或生产预算。这次修复只针对可注入时钟的合成测试协议：

- guardian在已收到真实OS exit但尚未settled时，继续检查真实适配器的group状态。只有实际确认 `absent`，才推进注入时钟到下一个已存在、未取消的timer，让监督器自行重探测和结算；不伪造exit、group absence或同一时刻的timer回调。
- 此同步位于guardian，不依赖父进程stdin，因而覆盖owner已被SIGKILL、管道已EOF的情况。host poll在settled或完成后清除；持续present/unknown不会被当成清理成功。
- 真正的TERM1500、KILL1620断言保持严格；最终report允许落在1620至1840之间，因为收到exit不保证同一次探测已确认group消失。新增反例明确要求下一次poll在1630结算，不能用扩大超时替代。
- 12秒看门狗与15秒单测上限不变，新增断言保证即便report已经送达，若仍需看门狗强杀才能关闭管道，该测试也不能算通过。原有已知worker组清理、父INT/TERM、孤儿/持有管道和只读证据检查均保留。

确定性反例仅在合成fixture中让“真实exit时的第一次group探测”保守返回一次present，之后恢复真实OS探测。它不会伪造absence或退出，覆盖live driver和dead owner两条路径。修复前 **0/2通过**：live driver在12秒后缺report，dead owner在约688 ms因未完成的顶层await退出，同样缺report；修复后两者分别在注入1630/130 ms正常结算。这个受控反例复现原失败记录的状态序列，不声称重新自然触发了原内核调度顺序。

可重复负载对照使用同一CPU上的6个30秒有限忙循环，再运行上述两条反例。原驱动仍为 **0/2通过**，修复后连同4个真实阻塞场景和真实system-clock截止共 **7/7通过**；看门狗均未触发。可在允许CPU 0的Linux环境使用以下命令重验当前版本，其他环境应选择允许的CPU：

```sh
pids=''
trap 'kill $pids 2>/dev/null || true; wait $pids 2>/dev/null || true' EXIT
for i in $(seq 1 6); do
  taskset -c 0 node -e 'const end=performance.now()+30000; while(performance.now()<end){}' >/dev/null 2>&1 &
  pids="$pids $!"
done
taskset -c 0 node --import tsx --test --test-name-pattern='injected deadline kills real synthetic|real wall deadline|manual fixture resumes' tests/acceptance-process-supervisor.test.ts
```

独立review新增4条回归：推进真正最早且未取消的timer、无timer时不补造回调、exit后group消失在1630结算、持续present/unknown至1840仍保持未确认，以及严格信号边界和settled后不遗留timer。针对性验证4/4通过。这些测试仍不能提供实时OS、pidfd/cgroup身份、脱离进程组的后代、guardian交付PID前崩溃、远端取消或零费用保证；机器长期不调度时仍可能触发测试看门狗并失败。

本轮冻结代码后的首轮并发4全量为 **2810/2810通过**（180.34秒，0失败/取消/跳过），同时运行的安装版TypeScript检查、服务端编译与Vite构建也均通过。Vite显式禁用配置文件与环境文件读取，保留原base/outDir，只有既有大于500 kB分块警告。全程src/tests/scripts内TS/MJS哈希一致；生产监督器单文件哈希也与本轮修改前一致。没有用串行重跑替换这次并发验证，没有读取密钥/真实存档或运行模型、浏览器、npm、提交或推送。

本轮证据保留于 `/tmp/valley-supervisor-report-race/`：`historical-full-failure.log` 为原2803/2804失败记录，`regression-before.log` 和 `load-before.log` 保留修复前两类失败，`load-after.log` 为7项负载对照，`full-concurrency4.log`、`check-build.log` 与 `frozen-after-check.log` 为本次完整验证。持续不调度、持久未知组状态、不可识别或脱离已知组的进程仍不属于“永不失败”的保证。

并发全量后，主测试与独立review再次合并复验 **45/45通过**（32主测试、13独立review，0失败/取消/跳过），日志为 `final-primary-review.log`。文档与代码空白检查通过。

另在同一个shell中重跑父信号、owner死亡、孤儿/持有管道及两条新反例共 **7/7通过**，随后检查未见仍运行的fixture进程；`cleanup-check.log`、`cleanup-processes.txt` 和空的 `cleanup-fixtures.txt` 保留该次观察。进程退出/组消失仍以各测试的独立OS观察为准，不将一次清理检查扩写为所有环境保证。
