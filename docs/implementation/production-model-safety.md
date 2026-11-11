# 生产模型安全门禁与离线候选

## 当前正式入口

`main.ts` 使用纯配置门禁，不读取模型 key 或凭据文件。缺省模式为 `no-model`；请求 `siliconflow-free-only` 模式仍为 `blocked`，启动日志及健康接口明确报告原因。健康的观察 HTTP 服务不等于模型就绪：`ok:true` 与 `ready:false` 分开表达。

唯一候选是 SiliconFlow 的 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`，固定 completions 端点、单槽、零自动重试、无备用和零元支出意图。名称或环境变量中的“免费”不证明价格、账户可用性或账单。正式入口当前没有实时解锁开关，旧未知真实请求不得重试，旧短探针预算不变。另有未接正式入口的[有界 HTTP 候选](production-model-http.md)，缺前次未决核对证据时仍不可派发。

正式存档启动所有权目前只在 Linux 实现，其他平台失败关闭。模型接线、免费状态验证、旧请求核对和跨平台能力都仍是发布边界，不能据此宣布 1.0 生产运行通过。

## 已实现的离线候选

三个独立模块不连接真实 HTTP：

- `production-model-policy.ts` 固定候选身份，默认禁止隐式调用。
- `production-model-journal.ts` 接收调用方专门创建的合成 SQLite 句柄。确认实际 `journal_mode=DELETE`、`synchronous=FULL` 和 `locking_mode=EXCLUSIVE`，持有独占直到句柄关闭，同句柄也只允许一个 journal。提交意图后才允许派发，记录只保存请求/响应摘要，不保存提示或 key。
- `production-model-candidate.ts` 只接受由模块自己创建的品牌内存 transport，不能传 fetch、任意执行回调、URL 或 key。它不是生产 HTTP 客户端。

每个显式合成契约绑定 run/world 身份、累计请求上限、绝对截止时刻和单请求时限。新建不会覆盖现存审计表，重开必须匹配原契约和已记录世界指纹，不能通过重启续领额度或重置时间。上限的实现天花板不是用户授予的真实请求预算。

401/402/403/429、其他 HTTP 失败、响应身份不符、无效响应、超时、时钟倒退、持久化失败和并发请求都会锁停。取消仅停止本地等待并请求 abort，不声称远端取消成功。响应晚到不交付、不清除 pending。正常响应仍需对应世界事务持久提交后显式确认；响应和世界提交不是跨库原子事务，任何中间崩溃都保守拒绝自动恢复。

恢复遇到 intent 或 response 阶段 pending 时持久化 `unresolved_request_no_retry`。没有自动清锁/重发接口。两个独立进程不能在意图提交与派发之间抢占或改写同一 journal；外部只读检查也须等所有者关闭。目录及文件必须由可信调用方隔离管理，本模块不提供真实路径接入器或防恶意同用户文件替换的保证。

token usage 只作观察，`actualProviderCostCny` 始终为 `null`。此处内存候选的 `realModelExecuted` 和 `liveExecutionEnabled` 始终为 `false`；journal 另支持绑定准入摘要的 gated HTTP 契约，其已记录 intent 的远端执行结果为未知，不能沿用 synthetic 的未执行声明。合成测试不证明免费账单、远端取消、九人十五日自主生活或长期生产就绪。

## 验证

`tests/production-model-safety.test.ts` 覆盖默认门禁、凭据属性未读取、精确候选、请求界限、FULL意图顺序、响应未提交、跨重启限额、401/402/403/429/500、超时与晚到、写入失败、竞争所有者、损坏审计、时钟倒退、SIGKILL和无需监听端口的health检查。

`tests/production-model-safety-review.test.ts` 独立复现过派发前所有权竞争：仅事务CAS不足以覆盖intent→transport间隙，改为整个句柄生命周期独占。复核还覆盖真实合成子进程竞争、同句柄重复对象和响应记录失败。

所有数据位于仓库 `output/test-tmp/` 的随机合成目录，不读取正式档、`.env`、key 或真实模型输出。未执行任何真实模型请求。
