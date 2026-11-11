# 九人验收隔离证据 writer

本批只实现**默认关闭的持久证据接头**，没有真实模型 runner、模型调用命令、密钥读取、数据库打开或正式九人十五日验收。既有服务、准备脚本和多年脚本不自动启用它。后续[最小离线集成](acceptance-integration.md)允许显式接入受控 runtime，自动保存控制终态并在失败时保持不完整。`--prepare` 仍只输出拟议清单；真实运行仍需批准、预算和独立数据库等后续工作。

## 显式接入与分类

`src/server/acceptance-evidence-writer.ts` 导出 `AcceptanceEvidenceWriter` 和只读的 `readAcceptanceEvidence`。调用者显式提供全新绝对目录、源码 SHA-256、世界 ID 和真实起始游戏分钟；可提供前一段 run ID 以标记重启。构造函数不启动任何 runtime。

```ts
const writer = new AcceptanceEvidenceWriter({
  directory: '/tmp/authorized-synthetic-parent/new-evidence-run',
  sourceFingerprint,
  worldId: world.id,
  fromMinute: world.minute,
});
// 显式传给已有 runtime options，不增加运行入口：
const options = {
  decisionWaitEvidence: {observe: writer.observeDecisionWait},
  directEatingEvidence: {observe: writer.observeDirectEating},
};
// 定期保存状态。状态为 null 就是没有观测，不是零。
writer.checkpoint({decisionWaiting: runtime.decisionWaitEvidenceStatus(),
  directEating: runtime.directEatingEvidenceStatus()});
// 先停止 runtime，使其发出各自的结束事件，再关闭 writer。
runtime.stop();
const report = writer.close({reason: 'manual_stop', sourceFingerprintAfter,
  statuses: {decisionWaiting: runtime.decisionWaitEvidenceStatus(),
    directEating: runtime.directEatingEvidenceStatus()}});
```

这只是接线说明，不是新建真实模型运行命令。`scope_finished/manual_stop/signal/storage_failed/evidence_failed/model_failed/limit_reached` 是调用者提供的终止原因枚举，不从进程状态猜测原因，也不自动处理信号、停止模型或证明预算合规。`writer.status()` 区分 open/closed/failed、已尝试序号和 fsync 已确认序号。`abort()` 只关闭描述符并尝试写入明确的 aborted 失败标记，不补发会话结束事件。

输出为四类独占文件：

- `run-start.json`：版本化格式、随机 run ID、拟议协议哈希、调用者传入的源码指纹、世界/起点、可选前段 ID、墙钟。`realModelExecuted`、`acceptancePassed` 始终是 `null`；writer 不证明是否调用过真实模型。
- `evidence.jsonl`：一条全局序号和 SHA-256 链，`kind=decision_wait/direct_eating/checkpoint/acceptance_control/close_status` 明确区分原始等待事件、已提交自主进食事件、周期状态和最终状态。载荷中的原会话序号保留，跨分类仍有共同持久顺序；按 `kind` 即可分别提取原始事件，不将两条通道混算。
- `run-close.json`：最后独占创建的终止 seal，保存整份 journal 的字节数、行数、末哈希、字节哈希、起始清单哈希、结束墙钟/原因/源码指纹。
- `failure.json`：仅在失败或 abort 时尽力创建，保存固定错误码、run ID、尝试序号与最后 fsync 确认序号。磁盘故障也可能让此文件无法写出，不能把它缺失解释为成功。

不会复制 World、快照、prompt、模型回复、计划意图、原始异常、栈或凭据。所有输入先按类型严格校验并重建允许的字段，额外键拒绝，不调用输入 `toJSON`、getter、自定义数组 `map`，稀疏数组也拒绝。数值必须有限，单条有限数值相加溢出时总量也保持未知；ID 有长度和字符约束，model/item/错误码均有固定范围。这里的 ID 仍须来自受信任 runtime；它不是把任意文本塞进 ID 后自动识别秘密的脱敏系统，恶意 Proxy/同进程代码不在信任边界内。

## 路径与持久边界

当前安全实现支持 **Linux 且 `/proc/self/fd` 可用的本地文件系统**，其他平台明确拒绝，不退化成较弱路径检查。调用者指定的父目录必须已经存在。逐级以 `O_DIRECTORY | O_NOFOLLOW` 打开目录，用持有的目录文件描述符锚定下一层；拒绝目录/祖先符号链接、`.`/`..`、已有最终目录以及路径中的 `runtime`、`secrets`、`.git` 和 `.env*`。不读取这些目标的数据。最终目录用独占 mkdir 创建为 0700，文件用 `O_CREAT | O_EXCL | O_NOFOLLOW` 创建为 0600；不会覆盖或清空既有目录。失败后保留部分目录，不自动删除、不原地重试。

短写循环直至全部写出；零进展、非法写入长度和 I/O 错误都使 writer 永久 failed。每条 JSONL 写完即 fsync，创建文件/目录后还 fsync 所属目录。关闭时先关闭 journal，真实读回并校验完整链和字节数，再独占创建/同步/关闭 seal，最后再次读回验证。close/fsync/静默丢字节失败有离线注入回归。同步 sink 有墙钟开销，不声称对真实调度零成本。

读回只打开固定文件名，以 `O_NOFOLLOW`、非阻塞读取检查常规文件与单一硬链接，拒绝符号链接、FIFO、目录及多硬链接后才读取正文。单文件上限128 MiB、单条记录1 MiB、数组长度10000；超过限制明确失败，没有静默截断/轮转。真实运行要事前评估这一上限。必须使用可靠支持 fsync 的存储；测试不是断电、文件系统或硬件持久性认证，也不提供密码学签名、认证或抵抗同权限进程重写的防篡改承诺。

证据和 WorldStore 不是一个事务。世界提交后、证据发出前仍有进程崩溃窗口；旧进食不得从库存反推，也不得因此追加到前一段。发生 writer 失败时 runtime 原有观测器会安全标记 failed，原模拟仍可能继续，显式集成现会检查状态并停止；独立 writer 本身仍不改变模拟调度。

## 缺测、终止与恢复

`readAcceptanceEvidence(directory)` 不写任何文件，不修尾行、不重编序号、不追加旧 run。它只保留首个错误之前的有效前缀及已观测进食数量；缺起始/结束文件、缺最终状态、坏行、截尾、重复/乱序、哈希或文件长度不符、失败标记、源码改变、会话/世界/序号/时间断点都使 `complete=false`。两个通道还须对应清单起点和同一终点。checkpoint 不是最终关闭，不能用最后一个 checkpoint 冒充最终状态。

只有 seal、完整原始事件、两个成功关闭状态和世界/起止范围都核对通过，才能将该段自主进食总量或等待计数视为完整。任何全局缺口会把两条通道的完整总量/计数均置 `null`；仍可单独显示有效前缀中的 `observedReceiptCount`，不能叫总消费。等待的有效单调时钟与日志完整性分开报告，删失等待仍不算成功。

`complete=true` **只证明这一段证据覆盖**，零分钟也可以完整，并不代表跑了21600分钟、九人都成功决策、九人活着或通过生存验收。完整食物产量、完整消费、毛伤害、停机时长、真实模型执行和验收结论始终未知。拟议协议哈希不是实际 runtime 配置证明。

崩溃恢复先只读检查旧目录，再显式创建另一全新目录/runtime/会话，可用 `previousRunId` 关联，但不拼接覆盖、不补停机缺测、不复制真实存档。旧目录永久保留原状；相同目录拒绝再次创建 writer。重启/崩溃进程测试只生成临时合成数据，不读真实保存。

## 离线验证

只用已安装工具、临时目录、内存SQLite、假模型和禁用的 fetch，禁止 npm/浏览器/密钥/真实存档。重点覆盖短写、零写、部分失败、fsync/close失败、静默丢字节、崩溃、缺seal/状态、源指纹变化、schema、符号链接/硬链接、原世界/模型上下文不变。

```sh
node --import tsx --test tests/acceptance-evidence-writer.test.ts tests/acceptance-evidence-writer-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
```

独立反例与实际结果见[独立审查](../reviews/acceptance-evidence-writer.md)。正式九人十五日真实模型结果仍未取得。

## 本批最终执行结果

2026-11-07，Node v24.22.1，最终源码完整回归 **1968/1968**，0 failed、0 skipped。writer新增24项（12项独立审查反例），writer/九人准备/等待/进食/runtime/模型路由组合93/93。类型检查、服务端编译、Vite构建、`git diff --check`通过。Vite仍报告既有超过500 kB的大分块警告，没有将其描述为解决。

独立审查发现的稀疏数组与自定义钩子问题已修复并复验；后续补强还验证有限回执累加溢出保持未知，以及关闭前证据文件被替换时只落合法固定失败码。独立审查再次只读确认这些改动，无剩余阻断项。

`--prepare`在最终源码成功执行，仍为9人、21600游戏分钟、`realModelExecuted=false`、`readyForRealRun=false`、`acceptancePassed=null`；覆盖282个源码/配置文件，指纹为 `88c92dfa2b48f581c7c7e63c8278576b149fe9a615ce43663a0a8ff3f7d401f6`。后续源码改动须重新生成，不能复用这个指纹证明新版本。

另执行未改动的原一年 `--daily-json` 确定性脚本并逐日对账：113条日报、161280游戏分钟、1325次自主进食、15908营养值、零缺测，年度内存存储重载通过；明细、总量、已完成 eat 和连续区间均一致。完整产量、完整消费、毛伤害和技术/模型等待仍为 `null`。这仍是原三人开局夹具，不是九人十五日真实模型结果。

## 家庭迁居供餐的独立可选切片

`familyJourneyMeals` 沿用食物已提交步的严格 schema 和封存协议，按原迁居餐次及成员序号审核同一事务的全部实际份数。旧记录缺字段不等于零；源指纹变化、写入失败、损坏或缺封存时顶层与嵌套总量均保持未知。水的伴随扣减不是食品营养，不把预留或到达当摄入；字段与离线范围见[家庭迁居逐成员供餐证据](family-journey-meal-evidence.md)，不代表完整消费账本。
