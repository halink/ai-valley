# 可恢复的离线长测入口候选

本交付新增的是 **实际 runtime、SQLite 和外部进程监督器上的离线恢复演练入口**。模型回复是固定假决定，不连接 SiliconFlow，不读 `.env`、密钥、真实世界或浏览器。真实长测没有启用，不能将该入口、恢复测试或模拟时间称为“真实十五日通过”。旧 live probe 的 9 次/180 秒限制未更改。

此前一次真实请求未收到响应，供应商执行与账单仍未知，用户账单核对尚待答复。本入口不重发该请求，无法借离线标记、价格时点、旧授权或恢复参数打开真实网络。没有真实模型/端点/key/数据库覆盖参数。

## 固定候选协议

- 初始 seed5401 九人合成世界，480 开始；未来目标为 21,600 游戏分钟（15 游戏日），终点 22,080。
- 唯一候选 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`、唯一拟议端点 `https://api.siliconflow.cn/v1/chat/completions`，1 槽、0 重试、无回退。
- 全局最多 20,000 次请求意图、720 段、保守预留 6 小时运行预算。每段先扣满 30 秒，即使快速退出、失败或被杀也不退还。以上是**离线协议上限，不是用户对真实长测的费用或请求授权**。
- 每段目标最多 60 游戏分钟，最多 128 请求，runtime 内部 25 秒；guardian 从 spawn 前计 30 秒，TERM/KILL 清理各最多 1.5 秒。每段上限不因 ready 信号重置。清理宽限单独记录，不包含在 6 小时主运行预算中。
- 金额预算为 0，实际供应商费用始终未知；离线回复不附加伪造的 `acceptanceCostUsd:0`。既有严格 opt-in 运行时政策仅作合成价格评估，真实官方价格尚未在本入口验证。
- 假决定只选当前菜单中的等待/留在外地，不补给、不修改年龄/动作权限/生存规则。人工推进 tick 只是离线加速，不是实际墙钟存活或真实智能行为验收。

## 使用

先确保仓库已有 `output/`，使用绝对 node 路径和空环境：

```sh
env -i /absolute/path/to/node scripts/run-nine-resumable-offline.mjs \
  --offline --output "$PWD/output/resumable-unique"

env -i /absolute/path/to/node scripts/run-nine-resumable-offline.mjs \
  --offline --resume "$PWD/output/resumable-unique"
```

每条命令只运行一个有界片段，不无限循环或自动续跑。只能写本仓库 output 子目录。首次必须新目录；续跑只接受精确离线协议的私有目录，拒绝旧 probe、生产 runtime 目录、符号链接、非单硬链接、开放权限的数据库和 sidecar。guardian 和 worker 均清空环境并预加载离线 guard。guard 是可信代码防误用，不是恶意同用户进程/原生扩展的 OS 沙箱。

## 持久化与防重复

1. guardian 持有独立 `launcher.sqlite` 的 SQLite EXCLUSIVE 锁，先在审计库记录整段预算，再启动 worker。因此冷启动、导入阻塞或初始化退出不能绕过全局预算。worker 只接受已预留片段编号。
2. worker 持有 `owner.sqlite` 的独立 EXCLUSIVE 锁；审计库使用单独连接，每个事件独立 FULL 同步事务提交。并发恢复会拒绝，不靠 PID 或可误删的锁文件。崩溃后 OS 释放连接，锁自动释放。
3. 先持久化 request_intent，再允许假调用。请求 ID 跨片段单调递增，包含请求哈希，不保存 prompt、key 或 raw response。
4. 回复只把 intent 变为 response；直到实际世界事务增加对应的成功决定数，才将请求标为已提交。响应并不等于世界采用。
5. 世界先提交、审计再记录提交指纹。两库间不声称原子事务；若正好在两者之间崩溃，SQLite 世界指纹与审计不匹配，恢复拒绝。宁可人工核对，也不猜测或重放。
6. intent 或 response 未决、错误停机、指纹不符、源码/协议变化、预算耗尽都拒绝续跑。没有自动清除未决请求的参数，更没有“强制重试”。
7. 已确认世界提交后、运行时 finally 前的遗留 inFlight 只在持锁、指纹一致、没有未决请求时清理为本地恢复元数据。不会重新发送已提交请求，不重复决定或进食。
8. 无未决请求且最后提交指纹一致的意外退出可续跑；旧未封口段保留并增加 unsealedSegments。新段不能补造旧证据封口，完整十五日证据仍不能因此成立。

重启不会补算停机期间游戏时间。原有计划与活动随世界保留，既有 receipt 索引继续防止重复应用。源码全量指纹包含 src/scripts/config；其他worker还在改源码时真实入口会按设计拒绝或无法封口。冻结后才能做进程级验收。

## 证据与故障边界

- `resumable-manifest.json`：协议、源码、初始世界指纹、真实执行阻塞原因。
- `resumable.sqlite`：逐事件序号/哈希链、累计预算、请求阶段、世界检查点、失败及恢复记录。哈希链用于完整性核对，不是抵御有权限重写数据库者的数字签名。
- `world.sqlite`：本协议独占的合成世界及事件/receipt 账本。
- `evidence-NNNN/`：独立片段 writer，原证据不改写。
- `segment-NNNN-result.json`：精确分钟、阶段端点、数据库重载、控制状态和费用未知。`segmentComplete` 只表示离线本段游戏端点。
- `process-UUID.json`：guardian 的实际退出、发送信号、组清空与清理未确定等事实。进程退出或 abort 不证明供应商远端取消。

独立 watchdog 在 runtime 导入与启动前核对 Linux PID/starttime，确认就绪后才打开 worker 的启动gate。guardian 的匿名管道 EOF（包括 guardian 被 SIGKILL）和独立33秒时限都会触发 TERM/KILL；worker 同步阻塞不能阻止 watchdog 清理。PID身份变化不猜测发送信号，僵尸或组清空未知保留 cleanupComplete:false。该保证仍依赖至少一个监督进程正常运行：guardian 与 watchdog 同时死亡、OS失效、同用户恶意修改/杀进程不受本机制保证。启动前源码核对/guardian自身导入耗时不计入6小时 worker主窗口预留，不宣称端到端全局6小时硬墙钟。

恢复还会验证全部历史已封口段的证据runId、previousRunId、结束分钟及审计保存的报告哈希；历史证据被删或改写时拒绝。当前段 evidenceComplete 与累计 cumulativeEvidenceComplete 分开，出现任何未封口段累计状态保持 false，不能由新段补造。

错误只输出有限码或受控状态，不输出异常堆栈、模型正文和密钥。异常期间 SQLite/磁盘/证据失败可能留不完整记录；没有证据就保持不完整，不造成功。正常关闭会有结果文件；硬杀可能只有先前持久化审计与进程报告。

## 验证范围

专属离线测试见 `tests/acceptance-resumable.test.ts` 与 `tests/acceptance-resumable-process.test.ts`，后者使用实际子进程故障注入和独立 watchdog 管道断开测试；独立复核结果见对应 review 文档。当前实现须经冻结后全量类型/构建/回归复查。即使全绿，也只证明所测本地机制；真实网络权限、官方免费可用性、账户可用性、费用、长时间智能决策质量、完整食品账和真实十五日仍未验收。

### 2026-11-10 本地专项结果

空环境、预加载 offline guard，单并发专属20/20通过、0跳过，26.47秒。包含实际子进程在 intent、response、世界提交/审计间隙、完整提交后退出，未决拒绝重发与已提交安全恢复；独立 watchdog 对同步阻塞子进程管道断开的 TERM/KILL 清理；公开 launcher 参数与仓库输出范围。日志为 `output/resumable-development/focused-20.log`。这是离线机制测试，不是供应商或十五日验收。

独立审查另外复现并复验了两条修复：成功提交后遗留 inFlight 导致恢复误停、历史封口证据被删却未拒绝；还实际 SIGKILL guardian 并观察独立 watchdog 清理同步阻塞worker，见审查报告。冻结后的公开CLI新建→恢复已实际完成：两次退出码均为0，游戏分钟480→540→600，累计请求36→72、成功72、未决请求为空，预留主窗口30,000→60,000毫秒。两个片段的SQLite重载、精确片段端点、历史封口证据、guardian及watchdog清理均验证，watchdog实际退出。证据保留在 `output/resumable-public-20261110/`，精简摘要为 `output/resumable-development/public-summary.jsonl`。这些是120游戏分钟、两个离线片段，不是十五日。

最后又增加“请求准备错误立即停止”的定向反例，1/1通过（`preparation-stop-test.log`）；共享runtime的prompt/context准备失败现在由专属观察器立即持久block，避免等30秒再排队。最终全量和统一构建由集成任务执行，本分支不以局部21项覆盖替代全库验收。
