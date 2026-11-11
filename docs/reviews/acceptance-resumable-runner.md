# 可恢复分段验收器独立审查

日期：2026-11-10。范围是默认关闭真实模型的离线恢复演练，不是真实十五日验收。

## 结论与范围

审查 `acceptance-resumable-{protocol,journal,runner}.ts`、`acceptance-run-directory.ts` 的恢复与数据库入口，以及离线 launcher、guardian、worker 和独立 watchdog。对本次已审查、已执行的离线边界，修复后未发现新的阻断问题；此结论不替代最终源码的全量回归、构建或真实提供商验收。

当前入口只创建或恢复其自身的合成世界，使用固定假决定。没有接入真实 transport、凭据读取、浏览器或模型覆盖参数。旧 live probe 的最多 9 请求、180 秒内部预算没有扩大。此前真实请求的远端执行和账单仍未知，不得借本入口重新发送；实际费用、远端取消、真实十五日结论均未得到证明。

## 核对的主要不变量

- 请求意图在独立 SQLite 审计库中以 FULL 同步事务提交后，才进入假调用。请求 ID 和次数跨段累计；有未决 intent 或 response 时拒绝恢复，不自动清除或重试。
- 收到回复不等于世界采用。只有对应世界提交增加一笔成功决定，审计才释放该未决请求。世界库和审计库不声称跨库原子性；崩溃留下未决或指纹不匹配时保守拒绝。
- guardian 在 spawn 前持久化整段预算；独立 launcher/owner SQLite 锁防止并发启动和恢复。固定模型、协议、源码、开局和当前世界指纹参与核对，不因重启重置预算。
- 历史已封口证据逐段核验 runId、previousRunId、结束分钟和报告哈希。当前段完整与累计完整分开；旧未封口段不能由后续段补造。
- 审计记录请求哈希而非 prompt、密钥或原始响应。受控失败输出不打印原始异常或模型正文；合成成功也不附加伪造的零费用回执。
- worker 在独立 watchdog 确认进程身份并打开启动 gate 后才加载 runtime。watchdog 使用 PID/starttime 核对，无法确认身份或组清空时不猜测成功。

## 发现、修复与复验

### 1. 已提交决定后的崩溃无法恢复

独立复现：第一笔假决定已写入世界且审计 pending 已清空，随后子进程退出 73；恢复时共享 runtime 把持久化的旧 inFlight 当成未知失败，专属观察器随即将会话置为 `blocked/decision_failed`。

修复仅在持锁、世界指纹完全匹配且无未决请求时清理本地遗留 inFlight，并记录新的恢复检查点。独立重跑同一故障点后，恢复保持 active，关闭为 paused；累计 9 次意图、9 次成功、pending=null，没有重复首笔决定，unsealedSegments=1。旧段仍不完整。

### 2. 历史证据丢失未被恢复检查发现

独立复现：正常关闭第一段后删除该测试自己的 `evidence-0001/`，原实现仍允许第二段成功关闭，报告当前 evidenceComplete=true、unsealedSegments=0。

修复将每个封口段的报告哈希写入审计，并在恢复前验证全部已封口段。独立专项中的同一删除反例现在以 `resumable_prior_evidence_invalid` 拒绝。新增 cumulativeEvidenceComplete，避免把当前段完整误作累计完整。

### 3. 启动前消耗未纳入预算预留

静态审查发现原预算在 worker 冷启动后才登记，启动阶段失败可不计入累计预留。现改为 guardian 持 launcher 锁，在 spawn 前登记整段预算，worker 只接受已预留编号。

此修复经代码核对；审查者未额外执行“预留之后、worker 初始化之前被杀”的专门进程用例。6 小时仅是 worker 主窗口预留，不包含 guardian 自身导入、源码核对和各段清理宽限，不能称为端到端全局 6 小时硬墙钟。

### 4. guardian 死亡时同步阻塞 worker 的清理

静态审查指出只靠 worker 的 JS disconnect 回调不能中断同步死循环。修复增加独立 watchdog、启动就绪管道和早期断开检查，并处理已断 IPC 的受控发送错误。

独立实际进程复验：启动合成 `sync_block` worker，收到 ready 后 SIGKILL guardian。watchdog 随后记录 guardian_disconnect，TERM 与 KILL 均为 sent，workerState=absent、groupState=absent、cleanupComplete=true；该测试的 worker 和 watchdog 最终均不存在。

首次测试助手尝试用本环境不存在的 `/proc/<pid>/task/<pid>/children` 获取自建子进程，未形成验证结论。随后改为仅观察本测试的 spawn 返回值，执行了上述成功复验。该环境差异不计为实现失败或通过。

## 审查者独立执行

Linux、Node v24.22.1；空继承环境，预加载 offline guard，串行定向执行：

```sh
NODE=$(command -v node)
env -i "$NODE" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs \
  --test --test-concurrency=1 tests/acceptance-resumable.test.ts
```

当时文件包含 14 项，结果 14/14 通过，0 失败、0 取消、0 跳过，约 15.15 秒。覆盖所有权锁、意图持久化、响应未提交、晚到阶段拒绝、预算累计、指纹和审计损坏、路径/sidecar、实际 runtime 正常恢复、失败/取消未决及历史证据缺失。

另以临时合成夹具独立完成上述提交后退出和 guardian 硬杀复验，夹具已清理。提交后退出可按 `tests/acceptance-resumable-process.test.ts` 中的 committed 场景复现；guardian 硬杀复验使用临时观察助手，不能把仓库中的 watchdog 管道 EOF 用例当成完全相同的测试。

审查期间未读取 `.env`、密钥、真实存档或真实调用结果，未调用提供商或浏览器，未运行并行全量或构建，未改动源码或仓库 index。本文件是随后单独授权保存的审查记录。

## 实现者后续验证，与独立执行分开

以下由实现者执行，审查者只读核对了相关代码和记录，不能算作审查者独立重跑：

- 专属两文件单次串行 20/20 通过、0 跳过，约 26.47 秒；记录为 `output/resumable-development/focused-20.log`。包括四个实际子进程崩溃点、独立 watchdog 和 launcher 参数门禁。
- 此后新增准备失败即时停机：专属提交观察器识别 `model_context_limit/model_request_invalid`，持久化 blocked 并排队停止 runtime。新增合成状态注入用例由实现者报告 1/1 通过；这项不包含在前述独立 14 项或实现者 20 项中，也不是模型实际产生超长 prompt 的端到端用例。
- 最后版本公开离线 CLI 新建、恢复各 exit 0：游戏分钟 480→540→600，累计请求 36→72、成功 72、pending=null，预留预算 30,000→60,000 毫秒。两段重载、段端点与累计证据标记均为 true；guardian/watchdog 均清理完成。审查者核对了 `output/resumable-development/public-summary.jsonl`；原合成证据位于 `output/resumable-public-20261110/`。以上输出不保证随仓库分发。

公开 CLI 的所有结果仍为 realModelExecuted=false、acceptancePassed=null、实际费用未知，仅覆盖 120 游戏分钟，不是十五日。

## 未测与剩余边界

- 审查者未独立重跑最终新增的准备失败测试、公开 CLI 正常新建→恢复、最终全部专属用例或仓库全量、类型检查和构建。
- 意图/响应未决，以及跨库提交不一致均会停止恢复；本实现没有自动修复这些不确定状态，也不承诺每种崩溃都可继续。
- 迟到隔离验证覆盖阶段拒绝和合成取消，不证明真实 HTTP、供应商取消或远端计费行为。
- watchdog 保证依赖至少一个监督进程和操作系统正常工作。双监督同时失效、同用户恶意修改、PID 身份不明或僵尸组未清空时，不得宣称清理成功。
- 哈希链不是抵御有权限重写数据者的签名；离线 guard 是可信代码防误用措施，不是恶意代码或原生扩展的 OS 沙箱。
- 未执行十五游戏日或六小时长时间压力运行，未证明长期生存、完整食品账、真实智能决策质量、官方免费可用性、账户可用性或实际零费用。真实长测仍禁用，需独立核实与授权，不得将本审查当作启动许可。
