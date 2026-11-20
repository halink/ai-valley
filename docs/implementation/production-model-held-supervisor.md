# 本机托管进程干演练

`createHeldProductionModelSupervisor` 只在受信部署引导显式构造后可用。没有生产启动、HTTP 路由或账户工具接线；无配置一律拒绝。请求只携带两级签章，不可选择命令、工作目录、参数、环境、进程处理器、模型或凭证。

1. 要求两份现有 SQLite 原档及已有协作锁，不创建或补修原档。核对文件所有者、权限、inode、稳定内容和 SQLite 头，拒绝任一 WAL/SHM/rollback 日志。原档由只读文件描述符捕获，世界和模型日志只在私有完整副本中运行现有重放；只有指定世界、已停钟且没有在途工作，模型日志与世界指纹一致且没有任何模型尝试，才能继续。即使副本重放遇到未知旧请求，也不会修改原日志。独占锁贯穿复制、进程、事后核对和账户释放。证据稳定性依赖现有协作锁与同机可信写入方，不代表能够防御特权文件替换。
2. 已有双角色部署信任链按供应商角色验签，并复用现有完整零价/授权/上次处置校验。签章中的原档范围为 `sha256(JSON.stringify(["held-supervisor-artifacts/v1",world,journal]))`，每份原档项为 `[dev,ino,sha256(fileBytes)]`；账户范围项为 `sha256(JSON.stringify(["held-supervisor-account/v1",registryDirectory,accountScope,registryIdentity]))`。其中账户身份为原已建立的 registry 目录和数据库各自设备号与 inode 的既有范围摘要（offline-account-registry/v1）。二者均来自受信引导配置和真实现场，不从签章反填。首次拒绝不占账户，再在实际 spawn 前验签并检查时效。
3. 父进程只可在既有耐久账户库（包括原协作锁）中保留该运行；受信系统配置必须预先固定原目录、原文件的身份。检查在原账户 OS 锁内且预留事务写入前重做，原路径缺失或更换不新建，也不采用同字节副本。既有未决账户不可领用，不能因任何本机结果对未知旧请求解封、退款或记为供应商无收费。固定 Node worker 只检查本机托管管道，不验证外部账户；它等待 400 毫秒后退出，通过 Linux /proc/self/exe 运行当前受信 Node 二进制的 permission mode，不接受环境变量、stdin、父端控制消息、文件路径或供应商对象，无模块导入或网络代码，子进程运行权限未授予。父端才持有账户与原档。使用现有 `AcceptanceProcessSupervisor` 对真实 OS child exit 和独立进程组缺失分别取证，终止信号只经原始 child handle；若有意外进程组存活或未知，不推断已清理。
4. 只有墙钟内得到无问题的真实退出零码、独立进程组确认空缺且原件未变，才记为这一次演练的 `clean-local-only`。超时、非零、信号、结果不明或启动后复核失败则保留耐久未决，不自动补写、退款、取消远端或重试。演练最大的墙钟为 3 秒，不包含至多 280 毫秒的清退观察。无论结果如何，`liveAuthorized:false`，历史供应商执行/实际成本未知。

限制：Linux 本机、受信 Node 二进制、文件与锁、可信引导和顺从的存档操作者。Node permission mode **不是网络命名空间，也不是任意恶意脚本沙箱**；这里不启动通用 worker。没有独立父死 watchdog、宿主强制网络封锁、跨主机账户锁、生产模型实现或外部真实授权，因此没有上线权限。无需改变原可写账户监督器，更不能拿本机干演练抵账或替代真正远端验收。

## 可选：启动时要求五份独立来源审阅记录

受信引导可选且只可显式配置 `reviewedSources: {mode: "reviewer-signed-sources/v1", files, reviewerSpkis}`。五份本机文件按[来源材料角色](production-model-source-custody.md)固定绝对路径，每份是原字节为 `JSON.stringify({utf8,signature})` 的私有单链接常规文件（最多 2304 字节，无换行）。根、角色、公钥、路径只能来自受信引导，不能出现在请求、环境、存档或 worker 输入里。五个审阅公钥与两个部署根、实际已验签的委派启动公钥均不得复用。

旧账户绑定 `A` 不变。开启此模式时，现有 provider-role 启动签章的账户 binding **必须**为 `sha256(JSON.stringify(["held-supervisor-reviewed-account/v1","reviewer-signed-sources/v1",A,M]))`，其中 `M` 按 authorization、prior-request、outcome、billing、pricing 的固定次序列出 `[role,sha256(文件原字节),reviewerSpki]`。同一合同中的五条准入来源哈希仍校验各文件内的精确正文。真实账户目录与数据库已固定的身份摘要仍参与来源范围与持久预留。旧签章不能开启此模式，新签章也不能通过删掉此选项降级；即使换签合规且正文不变，也必须重新签整个启动清单。

在原世界与日志锁内，预留账户前读取并校验五份文件、准入新鲜度与清单签章。实际 spawn 回调在已有账户预留内再次读取同五份材料、重新验签确认同一清单与时效，然后仅启动原不联网的固定 worker。首次校验失败不会写账户；如果材料在预留后丢失、变化或过期，则不 spawn，预留保持未决。未配置该选项时原干演练路径与默认行为不变。通过仍然只说明本机材料一致与本机进程状态，不证明外部资料真实、实际供应商费用或生产授权。
