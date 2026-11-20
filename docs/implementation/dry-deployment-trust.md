# 部署信任干演练

`createDryDeploymentTrust` 是未接线的服务端校验模块。未配置受信引导实例时一律拒绝；校验成功也总是返回 `liveAuthorized: false`。它不创建世界、登记账户、联网、拨号、发请求、发布或批准生产写入。仓库不含根公钥，更没有私钥。普通/正式启动、开发 V3 和现有供应商准入均不读取它。

- `ordinary-g2-single-effect-policy`：只审一份确定的“原生同龄果落地”政策形状（固定一单位），锁定世界头、机会、源、目标。不复用开发 V3 证书，不声明已验证真实落果前提，也不会消费真实原档机会。
- `provider-reconciled-zero-cost-run`：仅围绕已有生产接入结构做离线签审。严格锁定同一正式候选合同、完整证据哈希与预期账户范围哈希；且仍执行既有远端上次请求处置、账单材料与当期零价授权校验。摘要和签审证明提交了什么材料，不替代查证供应商账单，也不跟季节天气的模拟账户合并。

根必须由可信的部署引导程序按角色固定，两角色根不同。方法的预期见证来自可信观察方，不能用申请人的证书内容反填预期。部署集成不得从请求、环境变量、存档或开发审核密钥装载根、时钟、原档范围或预期见证。代签公钥不可直接使用任一固定根。本机防重仅限同一个干演练实例（同角色拒绝已接受的 nonce 或机会/运行，即使重签，且满 1024 次则关停）；不能代替跨进程、防回档持久机会锁。

签署 UTF-8 紧凑 JSON 数组（ASCII，严格匹配 `JSON.stringify`）；签名是无填充 Base64URL Ed25519，公钥是无填充 Base64URL 规范 SPKI。以下 D 为 `ai-valley-dry-deployment-trust/v1`，所有时间是安全整数 UTC 毫秒，两级不超过 15 分钟，终点不含在内：

- 根签名：`[D,"delegate",role,originDigest,worldId,runId,delegateSpki,notBefore,expires]`
- 代签名：`[D,"permit",role,originDigest,worldId,runId,sha256(delegationUtf8),notBefore,expires,nonce,binding0,binding1,binding2]`
- G2 三项：头、机会、`sha256(JSON.stringify([D,"effect","native-aged-fruit-ground-placement",1,sourceDigest,targetDigest]))`
- 供应商三项：已有规范 gated 合同哈希、已有生产证据哈希、预期账户范围哈希。

接真实部署前仍需：部署方独立确认各角色根与签审人员/轮换和撤销机制；可信原档、账户及实际版本证明；来自供应商的可独立复核的授权、最近未知请求处置、账单及当期零价和适用收费的原件；专门批准向指定供应商发送约定数据的确切运行。运行时还须联接可信启动与原生同事务的重校、持久唯一消费/回档保护，及供应商账户与既有预算/日志、撤销与失败关停。任何一项都没有通过这个干演练开通。
