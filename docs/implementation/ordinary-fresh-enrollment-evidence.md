# 普通世界仅新建档的注册证据合同（测试）

当前决定是 **仅新建档**：不接管、回填或迁移现有玩家档，不把开发 V3 或签名干演练改成正式授权。新模块没有接到普通运行、部署、注册、HTTP、模型或任何写入。仓库没有内置锚、公钥、已注册档或真实外部登记源。

可信测试引导固定普通原档位置、物理文件范围、随机世界实例、环境、代数、策略摘要、审核 epoch，以及两把彼此独立的 Ed25519 公钥。一把只校验事前签封的新建证明，另一把只校验测试登记源对新挑战的当前状态。两者任一缺失均不通过。调用者不能提供摘要、注册身份或根密钥。SQLite 只读打开的是现有协作锁下的私有快照，不打开原档 SQLite，也不写数据库、日志或锁页。

签名格式使用规范 ASCII JSON 数组和规范 Base64URL Ed25519，与通用签名校验相同。D 是 `ai-valley-ordinary-g2-fresh-enrollment-evidence/v1`，B 是 `[environment,worldId,instanceId,originalScope,generation,policyDigest]`：

- 新建证明：`[D,"fresh-only-provisioned-genesis",...B,genesisRevision,genesisRawDigest,epochFloor,issuedAt]`。
- 测试当前状态：`[D,"signed-current-registry-test-status",...B,sha256(genesisUtf8),status,currentRevision,currentRawDigest,epochFloor,consumedCount,consumedDigest,challenge,issuedAt,expiresAt]`。

仅 `fresh-provisioned-checkpoint` 可匹配；预留但未新建、退役、改代、过时 epoch、错误密钥、跨 inode、同 inode 恢复到早先合法字节、过期或旧挑战都拒绝。回调完成后仍在同一锁下重新对比完整压缩世界头；最终快照和所有者检查后再读一次可信时钟，避免在有效期刚结束时返回通过。没有正式效果收据，当前只能验证显式空消费集（数量 0，摘要 `sha256("[]")`）；非空历史不被丢弃或推定为空，而是明确拒绝。成功结果仅为 `signed-fresh-enrollment-test-evidence-only`，`externalProvisioningImplemented:false`、`liveAuthorized:false`、`migrationPolicyAvailable:false` 固定不变。

此合同不证明本机能推断「这个档从未被使用」或单靠副档阻挡回档。真正注册需要由受信独立部署方在文件首次生成前预留身份，在备份恢复域之外维护可独立查验的最新代数、反回档水位和消费记录，明确处理原档与登记记录不一致时的关停、恢复和撤销。没有真实外部可信提供方时，不能部署或视为完成注册。短测的签名提供方只是内存替身。
