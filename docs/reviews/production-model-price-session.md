> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 合成价格期与持久续期状态机：独立复核

## 结论

基于 HEAD `e4539d7` 工作树中冻结的四文件，独立静态审查与新增17项反例测试未发现阻断项。可以接受为**纯离线合成协议组件**，不能据此接受真实派发、供应商价格/账单真实性、实际 watchdog 或长期运行。

冻结校验使用 `output/price-session-development/frozen.sha256`，四项均 OK。本次只新增本报告及 `tests/production-model-price-session-review.test.ts`；未修改实现、正式测试、实现说明或现有生产门禁，未提交。

## 审查结果

- 证据输入封闭，合成价格期最大900000ms，精确到期即拒绝；重开不重新计算年龄。WeakMap 仅防误传，工厂人人可调用，不承担真实性证明。
- contract 固定原绝对截止、身份、指纹与累计额度；续期只能增加连续 epoch，不退款、不清请求/预留。worldId 检查与调用方提供的指纹检查独立。
- pending 只能通过匹配 response 后的确认清除。异常是单向状态。重开 pending、未封段均持久阻断；已确认但未封段不会推定正常退出。
- 时序校验先于操作。价格、请求、提交宽限、片段与全局硬边界使用严格小于。状态快照不会推进时间，符合文档的外部计时器限制。
- 事件须事务提交后才更新内存/返回成功；写失败将对象置为不可用。干净边界首次写失败未留下记录时不能证明尝试存在，这一限制已明确披露。
- 合成 contract、证据 capability、持久证据和状态快照均不能直接开启旧 live 工厂。旧 policy 仍 blocked，关键旧入口无新两模块的直接 import。既有可信集成 API 仍有其原有调用方信任前提，本次未加强或放宽它，不能将此结论表述为抵御任意恶意同进程代码。
- 文档未声称抗恶意全库重写、真实官方来源保证、真实世界原子提交、exactly-once、断电/SIGKILL 恢复或远端取消。调用方仍负责世界指纹、目录安全与单会话路径；新建另一数据库不能被理解为旧会话的自动恢复。

## 独立测试

新增17项全部通过，无失败、跳过：

1. 8种时间驱动操作在全局精确截止处拒绝，保留 pending、请求与 epoch，并跨重开保留失败。
2. 多次干净重开跨900000ms边界，不刷新价格、不退还请求/片段预留；下一价格期仍受原累计请求数约束。
3. 在证据精确到期时安装失败，跨重开无新 epoch。
4. 未开始会话可重开；反序列化 capability 不能安装，且拒绝持久。
5. 新合成产物直接调用原 live 工厂均拒绝，凭据回调调用数为零；原 policy 仍 blocked。
6. 实际子进程在封段写失败后 `process.exit(73)`：重开保留已确认事实和世界指纹，同时因未封段锁停，不能续期。
7. maxEpochs 跨干净重开耗尽后不重置。
8. 同段完成128请求后，第129请求拒绝，不增加计数，重开仍锁停。
9. 干净封段后在原绝对截止时重开，持久停止且保留原预留。
10. 用合法旧 `productionGatedCandidateContract`、合成 admissionHash 与有效窗口内的 now，纯调用 `evaluateProductionHttpAdmission`：cap、record、status 分别因 `admission_identity_invalid`、`admission_scope_mismatch`、`admission_record_invalid` 被拒绝，排除契约 kind/过期时间造成的假阳性。没有补造授权/账单记录，没有创建 live transport。

数据库全部为 `output/price-session-review/` 下新建合成库，测试后清理；子进程使用相同离线 guard。没有网络请求、真实凭据、`.env` 或真实存档访问。测试运行使用空环境，HOME/TMP 指向自有输出目录。

复现：

```sh
mkdir -p output/price-session-review/home output/price-session-review/tmp
env -i PATH="$PATH" HOME="$PWD/output/price-session-review/home" \
  TMPDIR="$PWD/output/price-session-review/tmp" \
  node --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 \
  tests/production-model-price-session-review.test.ts
```

结果日志：`output/price-session-review/tests.log`。独立全项目 `tsc --noEmit` 通过，日志为 `output/price-session-review/typecheck.log`（成功为空）。父任务另报告正式77项及8文件152项回归通过；此处不将这些父任务结果算作独立17项。

## 接受边界

建议接受本次冻结内容，不需因本次复核解冻修复。但任何实际 runtime/transport 集成仍需新的冻结审查，尤其是外部 watchdog、真实世界事务与日志的提交边界、来源取得、原始授权与账单核验。当前证据只能说明所覆盖的合成状态迁移与持久恢复，不能升级为真实生产已验收。
