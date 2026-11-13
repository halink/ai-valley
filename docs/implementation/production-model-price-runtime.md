> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 合成价格期与真实 runtime 的排空封段桥

`createSyntheticPriceRuntimeSegment` 连接已有合成价格会话、生产候选 journal、品牌内存 HTTP 和真实 `ValleyRuntime`。它没有 CLI、真实 transport、key、URL、路径或调用方时钟入口。正式 `main.ts`、production policy/admission、HTTP 实现与 live 脚本未改，依然默认阻断。不得用本组件或合成零价格解除旧请求/账单未知状态。

## 固定范围与资源所有权

- 调用方提供已隔离、独占的 world、journal、session 三个 SQLite 句柄。组件不打开文件，也不证明路径或来源真实性。
- 两账必须匹配 run/world、精确模型/端点、原创建时间、绝对截止、全局请求上限与请求超时，且累计 attempts/completed 和持久世界指纹相同。现有未决、异常、未封段或停机标记直接拒绝。
- 只有价格会话已有可用合成价格，才能开始新片段。组件不创建新会话、不安装价格、不延长截止、不重领请求数，不提供清锁或自动重发。
- 现有30秒片段、128次每段、6小时/20,000次全局天花板不变。请求超时加提交宽限必须小于30秒；旧候选允许150秒并不意味着这里可接150秒请求。
- 两种离线 runtime 桥共享同一 store 对象的独占标记。正常封段后仍须 `close()` 释放对象所有权，再关闭底层句柄或开始下一段。调用方仍负责文件级独占和安全路径。

## 提交与排空顺序

1. 先校验品牌内存能力及两账契约，FULL 提交 session segment，然后才允许 runtime 初始化写世界。
2. 每次模型调用先 FULL 提交 session intent，再由原 HTTP 候选 FULL 提交 journal intent，之后才调用内存 transport。两账记录同一请求正文摘要。
3. 原 HTTP 候选校验响应并提交 journal response，桥再 FULL 提交 session response；只有两者完成才解析编号决定。
4. 每次真正世界提交后，从 store 重载持久状态并依次提交两个 checkpoint。普通 tick、预留、初始化和停机提交不会清 pending。
5. 真实决定事务 durable commit 后，以结果对象、人物、revision、请求ID、两账请求/响应摘要和世界指纹逐一关联。仅接受的决定依次 ack journal、session。接受计划不代表动作已完成。
6. 到 admission cutoff、达到请求限额或显式 `drain()` 时，停止新调度/预留/派发，已发请求仍可正常 response→world commit→ack。排空不改变响应路径的 `acceptanceReady`。
7. 最后一个在途槽在 `finally` 移除后才真正 stop。停机 intent、世界停机提交、订阅者及停止控制均完成且无 issues、双账无 pending、指纹和计数匹配后，先完成 journal stop，再以 session seal 为最后落盘步骤。任何硬截止的等号处均拒绝，不能在截止时才开始排空。

准入在调度、准备后、世界预留提交后和 dispatch 的价格评估返回后重新检查，覆盖同步订阅者/价格回调要求排空的竞态。HTTP候选已有的 synthetic clock 接点还绑定 session 硬期限和派发前 cutoff，防止 journal intent 慢写之后跨界调用内存 transport；不改变真实 HTTP 代码或其时钟规则。

排空期间普通 tick 保持原行为，每次持久世界变动仍双 checkpoint。若人物变化导致旧响应被拒绝，保留未决并锁停，不伪装成干净排空。`close()` 是取消和释放资源，不会替在途请求等待成功；应先 `drain()` 并等 `status().sealed`，再关闭。

## 故障与恢复

三个数据库之间没有原子事务，也不保证 exactly-once。任一侧写失败、无效决定、人物变化、时钟倒退、期限到达或异常停机都会保留本地失败，并尽力持久 block 两账。失败标记本身写不进去时，`persistenceIssues` 明确列出，不能据此声称已有持久终态。

- 世界已写但 checkpoint 不齐：重开指纹不符。
- intent/response 或一账 ack 后退出：保留未决，禁止重发。
- 两账 ack 都成功但未封段：session 重开仍拒绝。
- journal stop 完成但 session seal 失败：仍未封段，不能续期。
- 只有完整 session seal 持久成功后退出，才可用同一契约、世界、剩余额度继续。

runtime 的 reservations、`metrics.requests` 和 acceptance 的 dispatched 计数是本地控制记录，不能当作两账 attempts 或供应商调用次数。同步回调可能在预留甚至控制层 dispatch 后、实际模型调用前要求排空；此时可以没有任何 transport 调用。费用始终未知，不补零。

## 计时与真实运行边界

组件设置准入截止、片段硬截止和 pending 提交宽限计时器，但它们在同一 Node 事件循环，不能抢占同步阻塞。所有关键操作重新校验绝对时间；`requiresExternalWatchdog=true` 明确仍需独立进程监督。没有自动片段调度、可信官方价格取得、真实账单核对、完整验收 writer 或正式存储接入。

输出固定 `realModelExecuted=false`、`liveExecutionEnabled=false`、`actualProviderCostCny=null`、`readyForProduction=false`、`acceptancePassed=null`。不代表免费模型真实可用、远端取消成功、九人十五日通过或长期1.0可发布。

## 验证

主测试 `tests/production-model-price-runtime.test.ts` 使用新建合成 SQLite、品牌内存 HTTP、可控时间和真实 runtime。包括两个价格期跨库重开、派发前慢写、双账/世界提交失败、精确截止、晚到、异常停机及8个实际 `process.exit` 边界。退出测试不是断电或 SIGKILL 测试；完整 seal 后退出可继续是正例，其余未决/未封段全部拒绝。

独立审查及反例见 `tests/production-model-price-runtime-review.test.ts` 与对应 review 文档。新增通用排空接口曾被独立反例发现 dispatch 内价格回调重入窗口，现已增加 dispatch 后准入重检并复验。

测试只读取仓库源码及自己创建的合成夹具，在清空环境、仓库内 HOME/TMP 和已有 offline guard 下运行。offline guard 是可信离线代码的防误用保护，不是 OS 沙箱。既有 bwrap 因权限拒绝未重试；没有用替代方式执行被阻断的全量测试，也没有网络、key、`.env`、正式存档或账单读取。

最终定向结果、类型检查与范围指纹在父任务与审查记录中报告。没有全量测试、Vite/浏览器或真实模型验收，也未提交/推送。

### 最终离线结果（2026-11-10）

- 新桥主测试29项，独立审查8项；全部纳入最终9文件定向回归，**185/185通过，0失败、0跳过**。范围是新桥、旧runtime桥、价格会话、HTTP独立反例、安全journal独立反例及原runtime测试。日志 `output/price-runtime-check/regression.log`。
- 独立审查自身重跑8/8通过，历史重入失败与修复后结果均保留；见 `output/price-runtime-review/targeted-tests.log` 和审查报告。
- 全项目 `tsc --noEmit`、服务端独立目录编译与 `git diff --check` 通过。服务端产物位于 `output/price-runtime-check/build`，没有覆盖公共build。
- 未跑原HTTP/停止控制中重设fetch mock的测试文件，也没有移除不可写offline guard以运行它们。上述185项不是全库通过。
- 正式main、policy、admission、HTTP实现及并行食物菜单9文件的SHA256与开工前一致。当前8文件范围冻结清单：`output/price-runtime-check/frozen.sha256`。
