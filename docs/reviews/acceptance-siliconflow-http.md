> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# SiliconFlow HTTP 形状离线接线独立审查

## 范围与结论

独立审查新增品牌内存 HTTP 能力、共享生产请求序列化和九人新世界接线。仅限精确 deepseek-ai/DeepSeek-R1-0528-Qwen3-8B 与 https://api.siliconflow.cn/v1/chat/completions，单槽、零重试、无回退。默认构造无执行能力；没有真实 HTTP adapter、真实凭据、live CLI 或真实费用验证。

新增独立反例位于 tests/acceptance-siliconflow-http-review.test.ts。所有命令以空环境执行并先预载 scripts/acceptance-offline-guard.mjs；没有覆盖 fetch，没有访问 .env、密钥、真实 runtime 存档，没有发网、模型调用、浏览器或提交推送。

## 发现与修复

1. 首轮26项中25通过、1失败：pushChunk 对 Buffer 调用 slice 只生成共享视图，调用方改写 Buffer 会改变已经发布的模拟 HTTP 正文。实现已改为 new Uint8Array(bytes) 真复制，原独立反例修复后通过。
2. 共享请求序列化原先先计算 messages JSON 字节数，再另行序列化整个 body，访问器/toJSON 可使两次值漂移。实现现先序列化一次并快照，再检查与构造正文；独立测试覆盖仅求值一次。
3. 初次类型检查发现 headerEvidence 返回联合类型含可选 undefined，不满足证据 details 类型；主实现已收到修复反馈。类型检查最终结果由后续执行记录说明，不将初次失败隐藏。

## 独立覆盖

- 品牌克隆、代理、伪造及复用拒绝；gate 回调重入不得提前派发。
- Buffer 真复制、逐字节 UTF-8 拆包、无效编码、响应超限及损坏 JSON。
- metadata accessor 与 then getter 不执行；Content-Length 非法、超限、不匹配失败关闭。
- 缺 requestId/currency/allChargesFinal/endpoint 的回执保持未知，HTTP 失败仍保留已知非零合成费用。
- headers/body 阶段超时、晚到、不重试、取消；墙钟空闲停止、并发停止、prepare 时间计入请求时限。
- 错模型、坏 usage、空 choices、不完整 finish 不返回成功；证据写入失败和 clearTimer 重入不能泄漏成功结果。
- 完整 body 解析前已留存 headers 和独立合成费用；reasoning_content 不作为返回的决定正文。

## 九人集成准备边界

acceptance-siliconflow-nine.ts 建立 seed5401 新九人世界、独占新 SQLite、原 runtime 与证据 writer，只允许初始 founder ID 并拒绝 foreign/outside 上下文。接线使用生产 prepareModelDecision / parseModelCompletion，不读现有世界或环境凭据。模块静态审查与父任务的集成测试分开报告，本独立测试文件不冒称已验证九人实际长期生活。

runtime 公共停止原因仅手动/信号可接入，其他 HTTP 失败映射 manual_stop，精确 HTTP 原因单独留在 http 证据中。manifest 明确 processSupervisorConnected=false；同进程时限不能抢占同步阻塞。没有外部监督器接线、供应商侧零收费保障或远端取消证明。合成回执和桥接 acceptanceCostUsd:0 不是实际账单或授权，realProviderCostUsd 始终未知。

本批只是至482.5游戏分钟的合成接线准备，不是九人十五日真实验收，不改原 Qwen 拟议方案，不声称免费模型当前可用或免费。

## 最终独立执行记录

2026-11-09，guard 预载与空环境：独立专项 35/35 通过，0 failed、0 skipped、0 cancelled；修复后的 node_modules/typescript/bin/tsc --noEmit 返回0。没有运行全套旧 mock-fetch 组，未将专项通过描述为全量或真实验收。

## 实现者最终相关回归与构建

2026-11-09 完成最终验证：

- 新主专项20例＋独立35例在空环境、严格guard下 **55/55通过**，0失败、跳过或取消，4.26秒。主专项实际完成新九人SQLite、共享编号解析、每位一次决定、精确482.5分钟封口及重载一致核对。
- 全部14个 `tests/acceptance-*.test.ts` 文件，另加 `tests/model-routing.test.ts` 和 `tests/decisions.test.ts`，空环境串行运行 **283/283通过**，0失败、跳过或取消，92.80秒。旧mock-fetch组沿用自己的离线模拟保护，不与不可重定义fetch的严格guard混跑；新55例另按上项严格guard验证。
- 空环境＋guard的完整 `tsc --noEmit`、服务端 `tsc -p tsconfig.server.json` 均通过。早期类型报错已修复，不将其作为通过记录。
- Vite API `build({envFile:false})` 在空环境＋guard下通过，198模块、5.31秒。仅设 `fs.realpathSync.native=fs.realpathSync` 兼容guard；未读取环境文件或关闭网络/凭据保护。原大chunk警告仍在，主包约1,428.00kB，不宣称已解决。
- `git diff --check` 与新增文件行尾空白检查通过。

未运行全仓 `tests/*.test.ts`，相关283项不是全量通过声明。没有真实HTTP、模型调用、游戏数据外发、真实存档读取、浏览器、提交或推送。外部监督器未接入新九人HTTP模块，真实免费账户可用性、费用与取消仍未知。
