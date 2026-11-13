> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 默认九人三期合成 runtime 连续性演练

本批扩展固定离线 worker，不接入真实模型。正式 `main.ts`、HTTP实现、价格来源、policy/admission、runtime、价格会话和启动预算实现保持不变。`sustained` 与 `sustained_crash_response` 是固定测试场景，不接受任意代码、模型、地址、密钥或真实存档。

## 实际运行的内容

- 从固定 seed5401 默认九人世界开始，使用现有 `ValleyRuntime` 的正常一秒 tick、20分钟/游戏日、单模型槽及真实墙钟，不手动 tick、不改时间、不补写居民决定。
- 内存 transport 回答实际发出的编号菜单，只选“原地停留15分钟”。回复及1+1 token用量都是明确的合成夹具。这个小用量影响本地 `ModelBudget` 的吞吐，不能当作真实模型吞吐或费用。
- 每期不立即停止，而由既有准入截止排空。截止为启动时预留的30秒减5秒请求窗口及1秒提交宽限；导入、初始化和等待gate均消耗同一预算。
- 测试显式启动三次 guardian，第二、三次恢复同一目录。同一世界状态跨段连续，不代表同一个进程不间断运行。至少一次恢复在旧合成价格自然过期之后。
- 每次启动仍先持久扣满30秒，原run/world/source、六小时绝对截止、20,000请求及720段等上限不变。没有自动后台循环或重启。

## 观察与对账

`rehearsal-N.json` 保存当前片段开始加载的持久世界摘要、runtime构造后的摘要、结束后的摘要、自然tick记录，以及有界的合成请求/回复和逐笔ack观察。它只是在固定可信代码下记录的本地证据，不是签名、价格权威或生产准入能力。

worker必须实际覆盖全部九人、多个自然tick和世界分钟推进，才可输出该片段观察报告。guardian仍先要求真实worker/watchdog零退出、进程组消失、监督报告一致，再独立重开数据库核验。观察报告hash绑定进程报告，而进程报告hash绑定启动账。

请求记录的 `observedAtMs` / `observedMonotonicNs` 现在由内存 transport 在同步 invoke 入口直接采样原生墙钟和单调钟，先于流对象创建。私有 WeakMap 将冻结记录绑定到本 factory 实际收到的原请求对象；克隆、同 ID 的其他对象和其他 factory 的请求查不到记录。worker 仍可在20毫秒轮询中准备假回复，但必须取得该原生记录，缺失时失败，不用回包轮询时间代替、不从 intent 倒推、不补填截止前时间。

这一改动针对2026-11-11 CI暴露的观察语义问题：旧记录使用延迟轮询的时间，可能拒绝截止前已经派发、截止后才回包的合法在途请求。旧日志只能证明观测晚147毫秒，无法证明实际invoke是否提前。原验证器未放宽：原生 invoke 的墙钟及单调钟仍必须分别严格早于原准入截止，ack仍必须按序且不晚于报告结束；真正迟派发仍失败。核心桥原有drain规则和live HTTP实现不变。[修复与独立审查](../reviews/production-model-dispatch-clock.md)。

报告中的居民ID与固定默认姓名、实际user提示开头绑定，而不是仅要求九个ID都出现。tick和请求观察的单调时间必须位于报告生命周期内，报告完成不得早于原始wall及monotonic准入截止。恢复前检查所有已完成启动的进程报告和其绑定的观察附件，不能只检查最新一份。

测试辅助对账器直接读取自己生成的合成目录，验证三条审计哈希链、价格前向链、每个request ID的请求/响应hash、model/session各自的ack世界指纹，以及每次启动的预留和完成报告。不会通过journal/session构造器生成新的审计记录来“修复”证据。

对账器使用readOnly SQLite重建本次短世界，并限制完整事件集合不超过180条，以确保与runtime工作窗口一致。它不是任意长期存档的通用读取器。每个报告引用的审计末端都要回放到相符的计数、世界指纹、无pending、已封段状态；仅证明某hash曾在链中出现不够。

world的requests是runtime预留计数，不总等于内存transport次数；分别记录并核对实际模型账attempts、completed、观察到的请求和世界成功决定。不能用单个累计数字替代逐笔对应。

2026-11-11 的 CI 修正进一步要求精确守恒：本地开始数 = 实际合成请求数 + 有独立持久回执的发出前取消数，不再容许没有解释的较大计数。固定单槽片段至多一个终末取消，原成功、localDecisions、响应与双账 ack 仍严格相等。实现、历史回执链和验证边界见[准入取消证据](production-model-admission-cancellation.md)。

只在合成目录内保存可复查的SQLite、完整观察JSON、监督/启动报告、调用记录及对账摘要。正例结束后还实际启动第四期，在第九次新增ack之后、第十个response已入model账时退出。此时session仍为intent，双方均保留同一未决ID，全部启动额度不退款，下一次resume不得创建新预留或进程。

## 复验

源码与脚本在第一次启动之前冻结。任何中途修改都应触发source不一致并拒绝恢复，不得为让测试通过更新原契约。

```sh
env -i /absolute/path/to/node \
  --import "$PWD/scripts/acceptance-offline-guard.mjs" \
  --import "$PWD/node_modules/tsx/dist/loader.mjs" \
  --test --test-concurrency=1 \
  tests/production-model-continuity.test.ts \
  tests/production-model-continuity-review.test.ts
```

测试使用仓库output内新建的私有合成目录，不清除旧证据。定向测试产生独立结果，不代表全仓通过。最终测试数、耗时及冻结清单在完成后记录。

## 不代表的保证

所有结果保留 `realModelExecuted=false`、`liveExecutionEnabled=false`、`actualProviderCostCny=null`、`readyForProduction=false`、`acceptancePassed=null`。

这不是实际AI、真实免费调用、供应商账单对账或长期1.0验收。不到两个游戏小时且只做原地停留，不能推断饮食、灾害、经济、人口、家庭或十五日生活平衡。真实旧请求和收费状态没有读取或核对。

正常段后的进程恢复不是断电验收，四个数据库不构成跨库原子事务。哈希链不是外部防回滚锚，不能抵御同权限恶意者协调替换全部状态。offline guard和进程组监督不是OS安全隔离，不保证远端取消或逃逸后代清理。没有重试被拒bwrap，也没有换路线执行被阻断的全量。

## 审查中发现的问题

首轮作者三期加第四期崩溃演练通过，但独立审查实际证实四个证据缺口：重新计算hash后的居民标签置换、截止后请求观察、超出报告生命周期的单调时间均未被旧验证器拒绝；篡改既有观察附件后，旧guardian还能新预留一段。它们并未开启live或退款，但削弱了所宣称的离线证据完整性。

修复分别绑定默认居民真实提示身份、补足wall/monotonic时间上下界，并在任何新预留前核对所有历史报告及绑定附件。独立首轮失败日志保留在 `output/continuity-review/first.log`，不将它算作通过。后续验证必须针对修复后的冻结源码重跑。

作者收紧身份验证时曾错误假设请求由system/user两条消息组成；实际固定DeepSeek编码是一条user消息，首行输出约束后紧接居民身份。该次真实运行被新验证器阻断，保留30秒启动预留且没有完成记录，日志 `output/continuity-check/author-second.log`。根据实际合成请求修正结构后重新创建独立测试case，没有清理失败case或将其冒充恢复成功。

独立扩展测试另有一次测试自身的嵌套context错误，触发既有60秒超时取消。修正测试context，不放宽任何运行或测试截止。`output/continuity-review/second-harness.log` 及同时载入旧测试的 `output/continuity-check/final-regression.log` 保留原结果；最终结果只依据修正后完整重跑。

## 冻结源码上的实际三期结果

最终组合回归中的新演练目录为 `output/continuity-rehearsal/case-TLdeTp/run`。三个真实墙钟片段各覆盖九人，分别接受18、16、11次合成决定，总计45次；自然推进tick分别19、19、20次。世界从第480分钟推进到557.8344分钟，同一run/world及原始契约保持不变。

各段从原始预留到报告完成分别24,388、24,478、24,390毫秒，仍各扣完整30,000毫秒，总计90,000毫秒。第二期实际等到旧证据过期后才重新启动。这里的请求数受真实调度与墙钟影响，并非固定吞吐成绩。

第四次启动在已有45次ack后又完成9次ack，随后第55个请求的response写入model账即真实退出73。watchdog观察到非零退出、进程组absent、cleanupComplete且无监督issues；session仍保留第55笔intent，model保留其response。累计55次attempt、54次ack、120,000毫秒启动预留，下一次resume不产生新预留或进程。

三个干净片段报告、第四次监督报告、原始SQLite及逐次调用日志均保留。`reconciliation-clean.json` 是第四次故障之前已经通过的对账摘要；最终数据库有意保留第四次未决状态，不能把它标成干净运行。补充摘要为 `output/continuity-check/final-three-epoch-summary.json`，第四次实际OS退出核验为 `fourth-crash-observation.json`。它们均显式保留非生产标志。

独立审查单独运行的12项检查全部通过，43.629秒；具体故障修复及其独立生成的证据见 `docs/reviews/production-model-continuity.md`。它独立执行了一期sustained及后续反例，不冒充另做了一次完整三期实验。

### 最终定向验证与冻结（2026-11-10）

- 修正后的13个文件组合回归 **224/224通过，0失败、0取消、0跳过**，378.907秒。包含本批作者2项、独立12项和原有210项定向用例。日志 `output/continuity-check/final-fixed-regression.log`。
- 先前载入错误嵌套context的组合尝试为221通过、3取消，日志保持原样；没有把它改写或计为最终全绿。
- 全项目 `tsc --noEmit` 与独立输出目录的服务端编译通过，日志 `typecheck-final.log`、`build-final.log`，编译产物 `output/continuity-check/build`。`git diff --check` 通过。
- 只修改两个既有离线脚本，新增观察验证模块、作者/独立测试、测试辅助及两份文档，共8个交付文件。正式main、runtime、HTTP、policy/admission、会话与启动预算核心均未变。
- 基线HEAD仍为 `940318b`，index为空；本批没有提交或推送。冻结SHA清单为 `output/continuity-check/frozen.sha256`，证据索引为 `evidence-index.json`。
- 未运行全仓测试、Vite/浏览器、真实模型或十五日验收；未读真实密钥/存档/账单，未联网，未重试被拒隔离。
