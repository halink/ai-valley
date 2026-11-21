# 普通世界仅新建档的注册证据合同（测试）

当前决定是 **仅新建档**：不接管、回填或迁移现有玩家档，不把开发 V3 或签名干演练改成正式授权。新模块没有接到普通运行、部署、注册、HTTP、模型或任何写入。仓库没有内置锚、公钥、已注册档或真实外部登记源。

可信测试引导固定普通原档位置、物理文件范围、随机世界实例、环境、代数、策略摘要、审核 epoch，以及两把彼此独立的 Ed25519 公钥。一把只校验事前签封的新建证明，另一把只校验测试登记源对新挑战的当前状态。两者任一缺失均不通过。调用者不能提供摘要、注册身份或根密钥。SQLite 只读打开的是现有协作锁下的私有快照，不打开原档 SQLite，也不写数据库、日志或锁页。

签名格式使用规范 ASCII JSON 数组和规范 Base64URL Ed25519，与通用签名校验相同。D 是 `ai-valley-ordinary-g2-fresh-enrollment-evidence/v1`，B 是 `[environment,worldId,instanceId,originalScope,generation,policyDigest]`：

- 新建证明：`[D,"fresh-only-provisioned-genesis",...B,genesisRevision,genesisRawDigest,epochFloor,issuedAt]`。
- 测试当前状态：`[D,"signed-current-registry-test-status",...B,sha256(genesisUtf8),status,currentRevision,currentRawDigest,epochFloor,consumedCount,consumedDigest,challenge,issuedAt,expiresAt]`。

仅 `fresh-provisioned-checkpoint` 可匹配；预留但未新建、退役、改代、过时 epoch、错误密钥、跨 inode、同 inode 恢复到早先合法字节、过期或旧挑战都拒绝。回调完成后仍在同一锁下重新对比完整压缩世界头；最终快照和所有者检查后再读一次可信时钟，避免在有效期刚结束时返回通过。没有正式效果收据，当前只能验证显式空消费集（数量 0，摘要 `sha256("[]")`）；非空历史不被丢弃或推定为空，而是明确拒绝。成功结果仅为 `signed-fresh-enrollment-test-evidence-only`，`externalProvisioningImplemented:false`、`liveAuthorized:false`、`migrationPolicyAvailable:false` 固定不变。

此合同不证明本机能推断「这个档从未被使用」或单靠副档阻挡回档。真正注册需要由受信独立部署方在文件首次生成前预留身份，在备份恢复域之外维护可独立查验的最新代数、反回档水位和消费记录，明确处理原档与登记记录不一致时的关停、恢复和撤销。没有真实外部可信提供方时，不能部署或视为完成注册。短测的签名提供方只是内存替身。

## 原生首建待登记存档

显式本机引导接口 `prepareOrdinaryRulesFreshGenesis` 只走普通规则真正的初始世界和首笔 SQLite 写入。默认普通启动不调用它，也不能打开待登记存档。接口只接受受信的本机引导参数，不接收调用方构造的 World，不从环境变量、玩家请求或现有存档接管身份。WorldStore 内部的回调不是外部接口，公开给可信引导方的创建闭包只接收签封。仓库不带登记站、部署根或已获授权环境。

引导方固定一把仅用于预留的审核公钥，通过 `reservationInput` 获得尚未落盘的世界身份、随机实例和随机挑战。签名使用同样的规范 ASCII JSON 和 Ed25519，但签域为 `ai-valley-ordinary-g2-fresh-genesis/v1`：

`[D,"reserve-fresh-ordinary-before-file",environment,worldId,instanceId,generation,policyDigest,epochFloor,challenge,issuedAt,expiresAt]`

预留终点不含在内，最多一分钟。它不能签名尚不存在的 inode 或世界字节，也不等于后续新建证明或当前登记签名。验签后只在受信且权限为 0700 的原父目录，通过排他的原生创建写入 `ordinary-fresh-pending.sqlite`，不打开、截断或迁移任何已有路径，也不跟随符号链接。首次真正的 WorldStore 写入在同一事务写入原始世界及不可用的待登记标记，复核原档身份、精确压缩头、版本和原生初始世界，在回读后至提交前再次核对所有者及预留时效；出错不删除、不将重试当成新建。待登记文件名在不完整时也会阻塞普通运行，成功写有标记的档案改名或复制仍不会被普通运行接管。父目录由部署调用者隔离，协作锁不防有原始管理员权限的程序协同改写所有标记、恶意重置文件或伪造备份。

成功返回的是本机待登记检查点描述符：环境、新建世界／实例、物理范围、代数、策略与纪元、精确首笔世界头和预留摘要。不会返回原世界数据、密钥或签名。它可以供将来的独立部署登记方复核，但目前没有外部登记接口实现、调用、恢复协议或状态升级；现有干验证器也不会接管待登记文件。返回始终是 `enrollmentActive:false`、`liveAuthorized:false`、`executionAuthorized:false`。后续必须有真实的备份域外登记、检查点推进与消费对账措施，以及独立单类型生产批准。待登记记录本身不能开启世界运行、效果或真实模型。
