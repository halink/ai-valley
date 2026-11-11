# 生产候选与真实 runtime 的离线提交桥

`production-model-runtime.ts` 新增 **仅合成、默认不接正式入口** 的组件。它把真实 `ValleyRuntime`、调用方独占的合成 `WorldStore`、`ProductionModelJournal` 和品牌内存 HTTP 候选连接起来。没有 CLI、网络、key、凭据回调或实时启用参数，不读取 `.env`、正式存档或旧运行证据。`main.ts` 仍固定无模型，生产 HTTP 的授权、旧未知请求核对、零价格与最多15分钟新鲜度检查均不变。

这不是可用的生产服务，也不是十五日验收 runner。真实接线仍须解决旧请求/账单核对、可信价格更新、隔离路径/进程监督与完整证据封存；不能把本组件的合成价格断言交给真实 HTTP 准入。

## 提交顺序

1. 调用方先准备合成世界、专用 SQLite 句柄与既有合成契约。桥核对世界身份、正式模式、持久状态指纹、未决请求、原始截止时刻与剩余额度，再构造 runtime。伪造内存 transport 或同一 store 重复绑定在 runtime 写入前拒绝。
2. HTTP 候选仍先 FULL 提交 intent，再允许内存请求；响应经现有严格 HTTP schema 校验及 FULL response 提交后，使用真实 `parseModelCompletion` 解释编号。
3. 桥装饰调用方的 `WorldStore.commit`。每次实际世界事务成功后，从 `store.loadForRuntime()` 读取持久状态并记 `world_checkpoint`，不能用已裁剪事件/receipt 的 runtime snapshot 替代。普通 tick、初始化、请求状态与停机提交都不会清 pending。
4. runtime 新增可选同步 `decisionCommitted` 回调，仅在显式停止控制下可用。它在决定事务持久提交、安装新世界后、其他订阅者前触发，包含原模型结果对象身份、人物 ID、确切 revision 和接受/拒绝结果。桥将该对象映射回唯一请求，并核对持久 revision、指纹和 pending=response，只有明确接受才 acknowledge。
5. 接受决定不表示动作已完成。居民改动、计划拒绝、无效 JSON/编号、写入失败、取消和晚到均不得清 pending 或触发重试。正常停止不重领请求数或重置原截止时间。

回调是可信本地同步接口，不接受 Promise，不能重入或修改 runtime。未配置时原运行行为不变。结果对象身份只在进程内用于关联，不写入审计库；库内仍不保存原提示、模型正文或凭据。

## 恢复和故障边界

- 世界提交前失败：没有被接受的持久决定，不 ack。
- 世界已提交、checkpoint 未提交：两库指纹不符，重开拒绝。
- checkpoint 已提交、ack 未提交：pending=response 保留，重开锁停，不重发。
- ack 已提交：只表示该决定事务已接受。后续普通世界变化另有 checkpoint。订阅者再抛错时保留已接受事实，控制状态与日志同步记录失败，不依赖 `status()` 或 `close()` 才落盘。
- 已匹配、无 pending 的持久状态中残留 inFlight 仅作为本地清理元数据，清理本身再次持久提交/checkpoint。不能用这个分支清 intent/response。
- 关闭先撤销桥，再取消 runtime。未决请求和迟到回复不作成功；中止本地等待不证明供应商远端取消。

以上不提供跨数据库原子事务，不声称 exactly-once，也不自动修复锁停运行。普通 checkpoint 仅允许 `synthetic-production-candidate`，gated live 契约拒绝这一新 API。

### 停机控制也必须持久完成

独立最终复核发现初版桥只有在 `close()` 才写入控制失败：已接受决定后的订阅者抛错虽然停机，但随后直接退出进程可能留下可恢复的匹配指纹。本批已修复这一缺口，并将反例加入永久进程测试。

- `AcceptanceStopControl` 新增默认未配置的同步 stopping 观察点，在 abort、停机世界事务和订阅者之前调用。桥先 FULL 提交 `runtime_stop_started`，不修改已接受决定数。
- 停机世界提交仍更新 checkpoint，但保持停机标记。完成 shutdown、收集订阅者/证据 writer 失败后，runtime 的同步 stopped 观察点才提交 `runtime_stop_finished`。干净结束清标记；异常结束在同一日志事务中写 `runtime_control_failed`。
- 只有 `game_endpoint`、`wall_limit`、`request_limit`、`manual_stop`、`signal` 且无 issues、无未决请求，才可能是干净终态。其他原因（包括 `game_time_invalid`、`clock_invalid`、`endpoint_missed`）以及正常停机中新增的 shutdown/writer 失败均锁停。
- 进程在停机 intent 与终态之间退出，重开记录 `runtime_stop_unresolved` 并拒绝派发。已知失败在停机世界提交前退出，以及 checkpoint 后终态前退出，都不能借匹配指纹恢复。
- 停机观察点写入失败不会被当作正常结束；保留失败或未完成标记，必要时由世界/日志指纹不符拒绝恢复。没有可靠落盘时不声称存在完整终态。

这两种新事件只供合成契约使用，也消耗现有审计行上限。原正式入口和实时 transport 没有接入这些观察点。

现有 **60,002 审计行**上限保持不变，checkpoint 也消耗行数，所以本组件可能早于20,000请求上限锁停。20,000是请求天花板，不是保证能够完成的数量。本批没有为长时间 tick 或长期存档增长做性能承诺。

## 资源所有权与范围

调用方负责安全目录、SQLite/world 的独占与关闭。桥不打开文件、不证明调用方交入的 store 路径安全；它只是受信任离线调用方使用的组件。`close()` 幂等、恢复 store 原方法，必须在关闭底层句柄前调用。返回 runtime 仅供受信任测试/后续集成；其显式验收控制限制为单次使用。

每个片段最多30秒本地控制窗口、单模型单槽、零回退。全局请求与绝对时间沿用原 journal 契约，不因创建新 runtime 获得新额度。该组件没有外部 watchdog、价格刷新、源码封口、完整验收 writer 或自动片段调度，不替代既有可恢复离线入口。

输出始终 `realModelExecuted=false`、`liveExecutionEnabled=false`、`readyForProduction=false`、`actualProviderCostCny=null`、`acceptancePassed=null`。

## 验证

实现测试 `tests/production-model-runtime.test.ts` 覆盖实际九人初始世界、内存 HTTP→真实编号解析→世界提交、普通 checkpoint 不误 ack、重开累计限额/截止时间、人物变更拒绝、无效决定、世界/日志写失败、晚到、重复所有者和伪造 transport。独立测试与复核见 `tests/production-model-runtime-review.test.ts` 和 `docs/reviews/production-model-runtime.md`。

测试只使用仓库 `output/test-tmp/` 的自有合成数据库与内存 HTTP，不读取真实存档或密钥。离线 guard 禁止网络和凭据路径；已有旧测试自带不同 mock 时单独运行。最终实际命令/结果在复核记录与父任务统一验收中分别报告，不将定向测试当作全库、浏览器或真实模型验收。

### 初批结果（2026-11-10，停机恢复补强前）

- 本组件两份测试在空环境、仓库内 HOME/TMP、offline guard 下最终 **21/21** 通过，0失败、0跳过；日志 `output/production-model-runtime-check/final-focused.log`。其中10项为独立审查，含两次实际子进程立即退出的提交间隙检查，不称为断电或 SIGKILL 测试。
- 组件初始8项与既有 HTTP、安全日志、runtime、resumable、acceptance integration 组合 **130/130** 通过，0失败、0跳过。随后新增的同步回调边界及恢复后继续消费原预算3项纳入上述最终21项。
- 最终 `node node_modules/typescript/bin/tsc --noEmit` 通过。中途曾遇并行客户端测试类型错误，最终复跑已消失；没有修改该客户端测试。
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir output/production-model-runtime-check/build` 与 `git diff --check` 通过。服务端产物独立输出，没有覆盖共用 build。
- 本批未跑全库或 Vite/浏览器验收，未提交或推送。正式入口、生产价格门禁和真实模型状态不因这些结果改变。

### 停机恢复补强最终结果（2026-11-10）

- 正常/异常停机、进程退出、HTTP候选、安全日志、runtime、可恢复入口、证据集成和停止控制组合最终 **183/183** 通过，0失败、0跳过，日志 `output/production-model-runtime-check/stop-fix-regression.log`。包含本桥两份测试共29项。
- 此前同一补丁的guard专项 **27/27** 通过；之后增加停机 intent/终态两端写入失败2项，已在上述183项中通过。日志 `output/production-model-runtime-check/stop-fix-focused.log`。
- 最终独立复核 **7/7**，覆盖原反例、异常reason和两个停机退出边界，源码前后指纹相同；记录见 `output/test-tmp/bridge-final-review/final-independent.log` 与 `final-source.sha256`。
- 最终全项目 `tsc --noEmit`、独立目录服务端编译、`git diff --check` 通过。`main.ts`、生产 policy/admission/http 文件确认未改；全库、Vite与真实验收仍由集成任务分别执行，以上不是这些阶段的替代。
