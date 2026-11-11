# 九人验收安全隔离入口：离线接线演练

本入口把已有真实 `ValleyRuntime`、SQLite、证据 writer、停止控制与外部进程监督器接起来，**只运行注入假模型的 2.5 游戏分钟演练，不运行真实模型，也不是九人十五日生活验收**。普通服务、开发预览、既有多年夹具均不改变。真实运行授权关口仍关闭，没有可启用真实模型的开关。

## 使用与冻结协议

在 Linux、现有本地依赖已安装的工作树运行：

```sh
node scripts/run-nine-resident-acceptance.mjs --offline --output /tmp/valley-nine-offline-unique
```

目标必须是不存在的新目录，父目录已存在。拒绝相对路径、已有目录/文件、符号链接及含 `runtime`、`secrets`、`.git`、`.env*` 的路径；不接受模型、密钥、数据库、恢复、费用、时长或执行命令覆盖参数。没有 `--run` 或 `--resume`。失败目录保留证据，不自动删除、覆盖或当作下一段续跑。

`offline-manifest.json` 同时保存原拟议九人十五日协议和明确分开的演练协议：

- 原协议继续是 `createFrontierWorld(5401)`、初始九人、480 → 22,080 分钟、21,600 游戏分钟、20 现实分钟/日、16 全局槽、Qwen 主路由及 DeepSeek 备用。原开局、名单与库存不改，不补给。
- 演练只至 **482.5**，使用固定假 `wait` 回复和显式 DeepSeek 标识以测试现有免费候选门，**没有请求该提供商**。该选择列在协议偏离中，绝不冒充正式 Qwen 路由已验证。
- 演练手动驱动 tick，模拟每轮一秒墙钟进度；停止控制与独立监督器使用真实单调时钟。内部限制20秒/24次假调用，外部限制30秒，从启动 runtime 子进程之前计时，TERM 宽限1秒、KILL 后最多等待1.5秒。
- 清单记录当前 `src/`、`scripts/`、package/lock 和 tsconfig 逐文件 SHA-256、总指纹、Node/平台/架构、原拟议协议、开局/地图/definitions 指纹及执行类型。覆盖脏工作树，并在 runtime 封口与 guardian 结束时重新计算。它不是签名，也不证明运行时实际执行字节未被恶意替换。

## 存储和凭据边界

guardian 独占创建0700目录，后续由目录文件描述符定位。runtime 仅继承该目录描述符，独占预留0600 `world.sqlite`，SQLite 使用自己的 `/proc/self/fd` 路径，不接收外部数据库目标。证据子目录由同一描述符能力独占创建。即使目录名称被移走/替换，数据库与证据仍定位原目录，不跟随替换后的路径。

writer 原有字符串路径接口和行为不变；新增的 `AcceptanceDirectoryTarget` 只允许受信任的已持有目录能力派生单一安全子目录。创建仍要求新目录，读回仍走原严格 schema、序号、哈希链、状态和 seal 检查。

启动器为 guardian 和 runtime 使用绝对本地 Node/脚本/loader 路径、`shell:false` 和 `env:{}`。不继承模型配置、凭据、代理、NODE_OPTIONS 或任意环境变量。执行 cwd 为 `/`，不加载 `.env`，也不导入普通服务 `main`/配置。guard 在 tsx 和 runtime 前加载，阻断 fetch/WebSocket、HTTP(S)/HTTP2、TCP/TLS、UDP、DNS，以及 `.env*`、`runtime`、`secrets` 等受限路径读取。测试只请求拦截函数，未发送网络流量或读取真实凭据。

源码元数据预检在应用模块/tsx加载之前遍历允许的源目录，拒绝源码符号链接、硬链接及非常规文件；不能先经符号链接加载源码再靠事后哈希声称拒绝。代码指纹随后另行通过no-follow描述符读取。

这是对**受信任本地代码**的离线防误用措施，**不是恶意代码的 OS 网络/文件系统沙箱**。不声称能阻止同权限恶意进程、原生扩展或被篡改的 Node/依赖；Node 在启动脚本前执行的调用方 preload 也不在脚本补救范围内。使用干净的普通 Node 启动命令，不把不可信程序加入工作树/依赖。完整测试依赖 Linux `/proc`、`O_NOFOLLOW` 和 POSIX 进程组，未证明 macOS/Windows 等价安全。

## 实际子进程停止和恢复

公开启动器保持到独立 guardian 的存活管道。guardian 脱离启动器进程组；启动器退出或被杀导致管道 EOF，guardian 独立停止 runtime。runtime 自有新进程组，监督器只向自己创建的组发信号，没有 PID 参数或任意命令入口。

正常信号走 runtime 的现有取消、提交、终态和封口；初始化或运行中同步阻塞不能阻塞 guardian，后者有界 TERM → KILL。只有 OS `exit` 事件能证明子进程退出，成功发信号、IPC ready 和管道关闭都不能代替。退出后还探测组是否清空；未知清理状态下不读取可能仍在变化的证据，也不宣称清理成功。

guardian本身被SIGKILL、整机失效、内核不可中断I/O、逃离进程组的恶意后代及同权限攻击不在此保证内；尚无生产cgroup/容器级兜底。

恢复只读本次独占目录中的证据，不打开数据库，不补日志、不重算过去、不续封崩溃片段。缺终态、缺 seal、写入失败、来源变化、未确认退出均保留不完整或未知。重新执行必须使用新目录、新数据库、新 runtime、新证据会话；这只是重新演练，不是沿旧世界恢复连续生活。真正的续跑/停机缺测协议仍需另行实现和批准。

内部 guardian 的固定合成情景仅供测试：终点、信号、初始化阻塞、同步阻塞、SIGKILL、writer 失败、费用未知、停止后晚到回复及 guard 探针。它们不是可扩展的命令或真实模型配置入口。

## 输出与结论边界

- `offline-manifest.json`：冻结协议、偏离、源指纹和未授权关口。
- `world.sqlite`：本次全新合成世界。正常关闭时 WAL 已由 store 关闭处理；崩溃时可能保留 WAL，不自动恢复它。
- `evidence/`：原 writer 的逐类日志、开始/结束状态与 seal，失败时保持原始不完整片段。
- `process-report.json`：真实进程监督状态，包括信号尝试、OS 退出和清理是否确认。
- `offline-worker-close.json`：仅正常清理路径产生的 runtime/SQLite 重载核对记录；崩溃时缺失。
- `offline-result.json`：外部只读核对结果与结束指纹。`offlineEndpointVerified` 只指本次短离线演练终点，不表示生活验收。

外层固定 `realModelExecuted=false`、`readyForRealRun=false`、`acceptancePassed=null`。原通用 writer/监督器报告的 `realModelExecuted=null` 保持原义，不擅自改写原证据。假模型零费用不是真实账单证据，`realProviderCostUsd=null`，`remoteCancellationConfirmed=false`。完整生产、消费和毛健康损伤仍未知；完整封存的中止段也不能算终点完成。

## 真实模型前的剩余关口

必须另获用户明确批准：实际模型及提供商、发送的游戏上下文数据范围、运行范围和时长、免费政策或费用上限。不得从现有密钥、准备清单或本次假模型零费用推定授权。拟议 Qwen 主路由与免费白名单冲突仍未解决，不得静默替换或放宽门。

此外仍缺真实 provider 免费可用性/费用凭证、实际可用的受控 transport、精确逐午夜库存/人口采样、完整21,600分钟真实运行及独立生活结论。四季与浏览器视觉验收也未进行。本批只解决安全的新存储命名空间、假模型 runtime 进程接线及离线停止/证据核对，不把后续真实接线当作已交付。

独立审查和最终命令结果见[审查记录](../reviews/acceptance-offline-entry.md)。

另见[单候选免费模型离线契约](acceptance-free-transport.md)：独立拟议单模型/单并发，默认拒绝，仅内存合成证据与固定探针。当前 manifest 记录它的未执行状态，不把它接入本入口或真实runtime，不改变上述真实关口。
