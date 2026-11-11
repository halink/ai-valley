# 合成价格 runtime 的跨进程监督与启动预算账

本批只新增独立离线工具，没有修改正式 `main.ts`、生产 policy/admission/HTTP、价格来源、既有价格会话或 runtime 桥。它运行固定 seed5401 合成世界、品牌内存 HTTP 和固定故障夹具，不读取key、`.env`、真实存档或账单，不提供live模式。

这是进程监督和持久启动交接的演练，不是十五日运行器：每次显式调用只启动一段，正常夹具最多交付一次合成编号决定后排空。没有后台循环、自动重启、自动换世界或自动重领预算。

## 原契约之外的启动预算账

`production-model-process-ledger.ts` 用独占SQLite、DELETE/FULL及连续哈希链保存启动预算。它与已有model/session/world三个数据库分开，不能声称跨库原子事务。

- 首次运行固定原run/world/source、全局绝对截止、20,000请求/6小时/720片段等契约上限，记录当前Linux boot身份。后续只允许同一合成目录和同一契约。
- guardian在spawn任何watchdog之前，先FULL提交本次完整30秒启动预留。启动、导入、等待gate、运行、world写入均消耗这份预留。失败、尚未ready或没有请求都不退款。
- 预留绑定原world指纹、累计attempts/completed、session/model审计末端、该期合成价格摘要、wall与同boot的hrtime截止。剩余全局时间不足完整30秒时，不创建新片段。
- session价格仅由固定合成fixture生成，有效期封顶于这次启动截止。worker晚启动不会获得新30秒；既有价格桥自然以该有效期缩短准入和硬截止。
- 每次干净结束保存实际进程报告，fsync后才完成启动账。报告hash、最新session/model审计末端、累计数和world指纹绑定下一次启动。
- 每段先校验旧审计末端，再重开session，因为其构造器本身会追加poll/checked记录。有效但较旧的session副本、改动的完成报告、源代码变化和身份不符都会拒绝继续。
- 重开时存在pending launch立即持久 `launch_unresolved_no_retry`。guardian死亡、spawn失败、进程结果不明、未封段或失败状态都不能通过重新启动退款、清锁或续领额度。

哈希链不是签名或外部防回滚锚。上述约束防止正常API路径重置及不匹配的单份旧记录；不抵抗同权限恶意者协调替换全部源码、账本和世界。

## 进程拓扑与硬超时

拓扑是 **guardian → 独立watchdog → 固定worker**。watchdog是真正的worker父进程，持有自己的事件循环和worker进程组。

1. guardian持有启动账独占锁，预留后关闭world/session/model句柄，再启动detached watchdog。
2. watchdog先登记guardian管道EOF/IPC断开，再启动worker。worker不继承guardian的写端。
3. worker只加载固定bootstrap，并等待私有gate。watchdog确认本次spawn得到的PID和Linux start ticks后才释放gate；runtime及故意卡死故障均在gate之后导入/执行。
4. watchdog从预留的wall及同boot单调截止减去已经花掉的时间，给现有 `AcceptanceProcessSupervisor` 剩余预算。ready、IPC或心跳不会刷新起点。
5. 到截止先TERM，1.5秒宽限后KILL，再最多观察1.5秒。记录实际OS exit、发送信号结果、进程组是否消失和unknown，不把kill成功、leader退出或EOF当成完成。
6. guardian被SIGKILL后，独立watchdog仍因EOF清理自己的worker。watchdog自身异常退出时，guardian只能对已经获知且start ticks仍匹配的worker尝试有界清理；原启动保持失败。
7. guardian另有从原单调截止推导的外层失败等待上限，不能用它增加worker执行额度。所有清理失败或未知均阻断下一段。

只有watchdog实际零退出、worker实际零退出、worker组已确认absent、监督报告无issues、持久watchdog报告匹配、源码仍一致，guardian才独立重开并核对world/session/model。它不依赖worker自报sealed。即使session seal已持久完成，随后卡死或SIGKILL，也不满足本层干净结束条件。

watchdog 的信号适配器另处理正常退出竞态：第一次进程组探测仍为 present，随后 leader 的 `/proc/<pid>/stat` 已消失（ENOENT）时，再次探测整个组；只有确认 absent 才记 `not_found`，不发送信号。leader 消失但后代仍在、组未知、身份不匹配或其他读取错误继续返回 unknown，并保留 `signal_failed`。不清除已有 issues，不把 leader 消失当作组消失，也不延长原截止；[回归与独立审查](../reviews/production-model-process-signal-race.md)。

## 安全目录与输入

`production-model-process-storage.ts` 只接受仓库output下显式新目录，或带本协议marker的旧合成目录。目录逐级NOFOLLOW，私有0700；数据库、sidecar与JSON验证文件类型、单链接、所有者、权限和大小。子进程只继承已经验证的目录FD，不接受任意数据库路径。

三个脚本都要求空环境及已加载offline guard，不继承凭据、NODE_OPTIONS、shell或代理配置；模型、目标和故障场景均固定白名单。没有网络回调、任意命令、用户PID或live开关。

显式调用形式如下，路径必须是尚不存在的仓库output子目录：

```sh
env -i /absolute/path/to/node \
  --import "$PWD/scripts/acceptance-offline-guard.mjs" \
  --import "$PWD/node_modules/tsx/dist/loader.mjs" \
  "$PWD/scripts/production-model-process-guardian.mjs" \
  --offline new "$PWD/output/synthetic-process-unique" normal
```

干净完成后同一命令将 `new` 改为 `resume`，继续同一目录。任何异常或pending均拒绝。固定故障参数仅用于离线测试，不构成真实运行能力。

## 不能宣称的保证

**这不是OS安全隔离或生产沙箱。** offline guard是可信固定代码的防误用保护，不能约束恶意同用户代码、原生绕行、逃离进程组的后代、整个状态集替换或检查与SQLite打开之间的同用户文件替换。

进程组和start ticks也不是pidfd/cgroup。watchdog死亡、PID身份交付前的崩溃、leader消失但后代仍在、PGID复用、不可中断内核I/O、OS暂停或监督器得不到CPU，都可能留下未知。zombie说明不再执行，不等于进程组已消失；没有证据时不能报告cleanupComplete。

guardian预留前的源码检查和自身同步存储工作不在worker监督器内，此时尚未启动worker。30秒执行额度加独立清理窗口不是“机器在某一毫秒必然让所有进程消失”的实时OS承诺。SQLite FULL与fsync调用也不等于已经做过断电持久性验收。

所有输出继续保持 `realModelExecuted=false`、`liveExecutionEnabled=false`、`actualProviderCostCny=null`、`readyForProduction=false`、`acceptancePassed=null`。本地kill不证明远端取消、免费调用或真实长期1.0就绪。

## 验证与结果边界

作者测试覆盖持久预留、独占、不可恢复的owner丢失、原截止、两段正常运行、预留/缺失watchdog/intent/response/ack/seal故障、真实墙钟阻塞和guardian SIGKILL。独立审查另覆盖有效旧session回滚、报告篡改、watchdog SIGKILL，以及真实30秒seal后卡死。

首轮作者测试13项中有2个错误期待：`init_block` 在runtime信号处理器安装前执行，OS默认SIGTERM退出是正确行为，不能强求SIGKILL。改用已安装处理器且同步阻塞的 `sync_block` 验证严格TERM→KILL；没有延长预算、放宽结果断言或修改生产实现。原失败保留于 `output/process-bridge-check/first.log`。

独立审查12项实际进程测试分两次通过，日志 `output/process-review/results.log`、`additional.log`，细节见对应review文档。最终组合回归、类型检查及冻结结果另外记录；这些均不是全仓、浏览器、真实模型或十五日验收。被拒的bwrap未重试，也没有更换办法执行被阻断的全量。

### 最终离线结果（2026-11-10）

- 11个文件的定向组合回归 **210/210通过，0失败、0取消、0跳过**，225.3秒。包括本批作者13项、独立12项，以及既有价格/runtime桥、价格会话、HTTP/安全journal独立反例和原runtime测试。日志 `output/process-bridge-check/final-regression.log`。
- 真实固定30秒执行预算下，同步卡死与seal后卡死均观察到TERM→KILL及实际SIGKILL，单项总耗时分别约32.8秒；没有用缩短的测试时钟替代这两项实际墙钟证据。
- 全项目 `tsc --noEmit`、服务端独立目录编译与 `git diff --check` 通过。产物 `output/process-bridge-check/build`，日志 `typecheck.log` 与 `build.log`；未覆盖公共build。
- 本批仅新增11文件，所有既有tracked文件未变，index为空，未提交或推送。冻结清单 `output/process-bridge-check/frozen.sha256`。
- 没有执行全仓测试、Vite/浏览器或任何真实模型验收。上述定向结果不得扩大为全量或长期生产通过。
