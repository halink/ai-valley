# 合成进程正常退出信号竞态审查

## 证据与修复范围

2026-11-11 的 CI 运行 `43069682481` 第4分片，`production-model-process-review.test.ts` 正常首段失败。诊断记录 worker/watchdog 均零退出、`trigger=child_exit`、`cleanupComplete=true`、`groupState=absent`，但 `issues=[signal_failed]`。CI 未记录 errno，不能声称远端已经直接证实 ENOENT。

确定性回归复现了与该记录一致的分支：首次组探测 present，读取 leader stat 时 ENOENT，随后组 absent。原适配器把 ENOENT 记 unknown，监督器永久记录 signal_failed，因此 guardian 正确拒绝该报告。保持原行为提取后，新增回归先失败；修复后通过。

改动限于 watchdog 的信号适配器及其可测试函数。ENOENT 后重新探测整个组，仅 absent 返回 not_found；缺失身份、仍有后代、组未知、身份变化或其他读取异常仍失败关闭。读取 stat 与实际 kill 的异常分开：只有真正的组信号 ESRCH 才直接表示 not_found。watchdog 原有 gone 缓存不变。

没有修改 supervisor、guardian、worker、启动预算账、30秒预算、1.5秒清理窗口或无 issues 的完成要求；没有重试失败 launch，也没有把合成结果扩大为真实模型验收。

## 确定性验证

新增 `tests/production-model-process-signals.test.ts` 共17项：

- TERM/KILL 在身份匹配后才发送；组已 absent 时不读取身份、不发信号。
- stat ENOENT 后分别重探测 absent、present、unknown。
- 未知/变化身份，stat EACCES/EIO/ESRCH，实际 kill ESRCH/EPERM。
- 完整监督器报告复现正常退出竞态，修复后 issues 为空、TERM 为 not_found。
- leader 缺失但组仍 present 时继续产生 signal_failed，即使后来 absent 也不抹去失败。

红绿日志为 `output/process-signal-ci-fix/before-fix.log`、`after-fix.log`。

## 独立审查

独立审查实际补丁与调用点，另行运行新增17项回归，均通过；补查缓存 absence 后再次调用、缺失/不匹配 stat，未发现阻塞问题。确认原 group 闭包仍被复用，身份保护及 guardian 门槛未放宽。

已知边界保留：如果重探测时组仍短暂 present、后来才消失，仍会保守失败。该修复不能保证所有 CI 抖动均已消除，也不是 pidfd/cgroup 隔离。远端 CI 需在授权发布后另行验证。

## 最终本地结果

在仓库 `output/process-signal-ci-fix/snapshot` 内用已提交 HEAD 加本补丁建立独立源码快照，未复制 `.env`、真实 `runtime` 或其他人的未提交修改。Linux / Node v24.22.1 下，`npm run build` 通过（类型检查、服务端编译、Vite）；7个相关文件组合回归 **99/99通过，0失败、0取消、0跳过**，82.3秒，包括原正常续段、真实30秒同步/封存后卡死、guardian/watchdog SIGKILL、预算不退回及诊断权限反例。日志为 `output/process-signal-ci-fix/build.log`、`regression-final.log`。

首轮组合98/99通过，唯一失败是快照未包含测试需读取的 `.github/workflows/ci.yml`；补入原HEAD文件后，单文件6/6及最终完整组合均通过。原失败保留于 `regression.log`，没有改动断言来消除失败。

共享工作树另一次类型检查曾发现并行生态审查测试的 TS2322，已单独报告，未改该文件。本批独立快照验证不代表共享工作树最终合并验证、全仓测试或远端 Node22 CI 已通过。截至该专项阶段，未提交、未推送。

## 最终整合验证

2026-11-11，统一整合在 Linux / Node v24.22.1 下验证包含本修复、野生动物饮水修复及原有未提交工作的共享工作树。`node scripts/test.mjs --test-concurrency=2` 首次完整运行474个文件，**6189/6189通过，0失败、0取消、0跳过**，耗时约1045.8秒，包含本次17项确定性竞态回归和原多进程边界测试；没有过滤、重跑失败测试或修改断言。构建与测试前后的1382个非环境源码文件路径及SHA256均相同；10个原有视觉设计与赠食文件保持原字节。

类型检查、服务端编译及 Vite 生产构建通过。首次 `npm run build` 仅在 Vite 默认配置加载器尝试写只读 `node_modules/.vite-temp` 时报 EROFS；原日志保留，改用 `npm run build -- --configLoader native` 后完整通过，没有改源码、依赖或构建配置。原有包体积提示保留。

运行使用空环境、只读源码和依赖、仅回环网络；不挂载 `.env`、真实 runtime 或 `.git`，输出全部在仓库 output 下。日志、隔离脚本、计时与哈希清单在 `output/integration-water-signals-20261111/`。这只证明当前工作树的本地离线整合通过，不代表远端 Node22 CI、所有时序竞态消失或真实模型验收；没有推送。
