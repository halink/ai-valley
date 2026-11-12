# 官方免费模型 runtime 候选桥审查（2026-11-12）

## 实现范围与结论

`createReviewedProductionModelRuntime` 是默认关闭、仅供受信调用方集成的候选 API，不是新的 CLI，`main` 与正式启动服务均未接线。必须显式 `enableLive:true`，并提供匹配的 gated transport、contract 和有效绑定 admission。构造不读取凭据；durable intent 落盘后才获取凭据，固定 CN 精确型号，无重定向、自动重试或付费 fallback。

journal 支持 gated 世界 checkpoint 与停止生命周期回放。checkpoint 不清除 pending；只有响应对应的持久世界事务确认才清除 pending。跨库写入缺口、未知请求结果、失败及未完成停止仍拒绝恢复。本批没有清除真实未决记录。

**审查结论仅为离线合成测试下的集成候选，不是正式可运行、真实模型验收或长期稳定性验收。**

## 独立审查发现与修复

1. **价格记录过期但无模型请求时，世界仍推进。** 初始自然时钟探针在过期后观察到 minute 480→482.4，控制器仍 running。修复为每次进度检查重验价格，并将价格期限、contract 期限与运行预算的最早值映射为固定单调钟 deadline；即使没有请求，也有定时停止。持久世界提交前再次检查，避免同步模拟耗时后提交已过期草稿。恢复后探针显示过期前后 minute 都为 481.2024，control stopped、live false、凭据回调 0 次。
2. **同步凭据回调可以耗尽预算后仍到达 fetch。** 初始 1000 ms 预算加 1200 ms 虚构凭据回调触发离线 fetch 阻断器。修复为 HTTP 在回调完成后、fetch 之前执行同一绝对 deadline 检查；预算也涵盖 runtime 构造、同步写入与延迟定时器。恢复后相同探针以 `wall_limit` 停止，保留未知 intent，没有到达阻断器。保留 pending 是保守恢复策略，不等于供应商已执行。
3. **来源标签夸大。** 调用者伪造的零价格字段与 hash 曾获得类似已审查官方记录的标签。现明确 `pricingBasis:'caller-supplied-unverified-record'`、`pricingVerifiedBySoftware:false`。结构、hash、URL 与零字段只检查一致性，不能认证官方来源；受信操作方必须另行核实实际价格、账户资格及历史未知请求。
4. 正常停机后 live 状态曾仍为 true，现要求控制器仍 running。同时补启动前、正常停机、关闭后的断言。旧 gated checkpoint 一律拒绝的测试已改为验证 checkpoint 不确认 pending，以及 pending 下不得 clean stop。

早期 84/84 虽通过，却未覆盖前两项缺陷，不能作为无阻断问题的依据。此前文档“生产源码未改变”“未发现新的阻断级问题”的结论已由本次记录取代。

## 已核实的验证证据

- 恢复后八文件联合回归：**94/94**，0 fail / cancelled / skipped；完整日志 `output/reviewed-model-runtime-commit-review/recovery-regression.log`，约 104.8 秒。
- 两项独立自然时钟安全探针：`recovery-security.log`，对应上述过期无推进、同步凭据超时不派发。该探针使用不可变离线 fetch 阻断器。
- 恢复后的全仓 `tsc --noEmit` 退出 0；`recovery-typecheck.log` 无诊断。
- 已有恢复用例实际关闭/重开合成 SQLite，核对原 deadline 与累计 attempts；未知结果拒绝新桥重试；关闭后迟到响应不改变持久世界指纹。三个合成子进程退出/重开探针覆盖控制失败、停止提交前、停止终态前窗口，均不能继续派发。
- 本次额外对抗用例：冻结墙钟而单调钟越限、价格过期后的迟到回复不采用/不重试、虚构价格来源明确不认证。另有进度价格检查的同步阻塞、较晚 absolute deadline 不延长预算等边界测试。最终结果见下节。

测试以 `env -i` 清空继承环境，使用项目内 HOME 和临时合成世界、SQLite、凭据及响应。联合测试的受信 mock harness 允许测试替换 fetch/listen，其他网络与凭据/存档路径由离线 guard 阻断；这不是操作系统沙箱或恶意代码隔离证明。没有读取真实 key、账户或存档，没有请求供应商。合成未知账单不能记成实际零费用：`actualProviderCostCny:null`、`providerBudgetEnforced:false`、`readyForProduction:false`。

日志在 gitignore 内，不随提交交付；新检出需重跑。重启前缺少最终汇总的较大测试日志不计通过。未执行全库测试、Vite、浏览器视觉或真实模型验收。

## 未完成与限制

正式 `main` 仍只提供无模型观察服务。桥的默认上限为 30 秒，没有价格续期会话、账户级跨目录唯一活动锁、正式父子进程监督/恢复协议和启动接线。当前官方精确价格、账户资格、历史真实未决请求与账单均未在本批核实。墙钟跳变会保守拒绝；单调钟固定预算防止墙钟冻结延长已有期限，但不是操作系统 suspend 或供应商远端撤销的保证。晚到请求可能已被供应商处理，本地 abort 不证明远端取消。

官方免费不等于供应商硬性零费保证，但不会再以供应商绝对零费能力为无限期阻止接入的额外条件；下一步仍按 [接线方案](../implementation/formal-model-entry.md) 做受控集成。

## 本次最终重验

新增三个对抗用例后，两文件针对性回归 **25/25**（包含原 94 项中的 22 项，不相加为 119）：`review-adversarial.log`，0 fail / cancelled / skipped，约 31.8 秒。最终全仓 `tsc --noEmit` 退出 0：`review-final-typecheck.log`。本次新增仅为测试与审查文档，恢复后生产修复源码未再变化。最终 `git diff --check` 通过。本批仅本地提交，没有 push。
