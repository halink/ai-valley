> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 离线九人精确每日边界快照

这是 **resumable 离线入口**的本地证据候选，只使用 seed5401 合成世界、假模型决定和隔离 SQLite。没有真实模型、网络、密钥或正式存档入口，不改变 live 阻塞，不代表十五日生存、供给或智能决策验收。未提交候选的实测范围见下文及[独立审查](../reviews/acceptance-daily-snapshots.md)。

## 精确采样口径

- 固定原始九个 ID，不以当前幸存人数重新选择九人。完整 `world.residents` 另做人口统计，区分 alive resident / visitor / outside、dead 和 unknown；区域联系人与商人不冒充谷内人口。缺人不当死亡，身份重复/坏记录不当确定人数。
- 初始点是游戏分钟480。随后是日历午夜1440、2880等，最终22080另有部分日终点。不是从480起每隔1440分钟，更不是把事件按日期分桶后叫“世界快照”。报告保留前后部分日。
- 运行时仅在显式离线配置下把下一步截到真实边界。引擎末子步使用剩余真实时长并落在精确目标分钟，**先**完成该步进食、变质、生理、人口和日界处理，**再**随同一事务保存快照。不把一个过界后的状态倒贴午夜时间。
- 每个边界只保留**第一次到达该分钟的提交状态**。该事务的revision、累计事件/回执数与快照绑定。后来同分钟的决定、停止元数据和重启不覆盖它；报告不是“这一分钟所有未来提交的最终状态”。初始480快照为runtime构造之前的合成seed状态，尚无的公共库存结构保持缺测，不初始化补造。

每人保留各物品实际数量、饥饿、健康、精力、alive/dead、resident/visitor/outside、可知deathAt。稀疏库存中缺少一种物品表示0，缺整个库存或非法数量表示null并列unknownFields。缺失身份、指标或死亡时点也保持未知。

公共库存明确只涵盖 `civic.stores` 和 `civic.reserves` 真实独立仓，不重复 `economy.treasuryStock` 汇总。公有遗产包、树上产物、家庭池、企业仓和其他容器不在该公共小计内；标记覆盖范围，不称全社区食物账。缺集合、重复仓ID、同一库存对象别名或坏数量保持未知。相同数值的两个独立实物仓正常相加。

相邻边界的死亡/在外状态差异单列为端点观察，只有实际deathAt落在区间内才给精确死亡时间；离开时点不反推。每个边界事务还按事件账本序号独立保留上一快照之后新归档的death/depart/endVisit/visit/settle/birth事实ID、原时间、类型及actors。previousEventSequence/throughEventSequence定义的是提交顺序切片，不是严格事件时间日桶；午夜首份快照之后同分钟新提交的事实会保留在下一份快照的增量中，不漏记、不重贴时间。因此“离开又回来”的原始事件不会因两个端点相同而被丢掉，但不会把actors人数猜成死亡或迁移人数。

## 原子性、重启和缺口

`WorldStore` 的显式 `dailySnapshots` 选项在原世界数据库创建可选表。快照、连续性游标、世界BLOB、事件及receipt **使用同一个SQLite连接、同一个 BEGIN IMMEDIATE / COMMIT 事务**。任一快照写入或校验失败会回滚整笔。普通服务未启用该选项，不创建采样表或截断日界。

- 每次提交比对上一revision和分钟。跨过未采样午夜、时间倒退、遗留未接入采样的写入、并发陈旧revision都失败关闭。
- 开始已有世界时不能补造历史；旧库没有快照历史就拒绝升级续跑。更换采样范围、九人ID或源码指纹也拒绝。当前resumable manifest固定包含配置，旧候选必须保持原样另行核对，不能拿新程序续跑后宣称历史完整。
- 行主键防同分钟重复，哈希链连到持久游标。恢复会校验快照体、字段、自洽数量及链；缺失/改写历史拒绝。哈希不是防有权重写整个数据库的签名。
- 通用只读报告生成器可以展示缺失午夜，明确 snapshot:null / missingBoundaries，不使用当前状态或事件补齐。片段中途停止时，当下未到午夜的末端没有边界快照，区间端点明确缺测。
- SQLite原子性不使现有世界库、resumable审计库、文件writer三者变成分布式原子事务。原runner的“世界先提交、审计后检查点”崩溃缺口仍拒绝恢复；未封口片段继续令累计证据不完整，绝不重放模型请求。

## 统一报告

每片段仍通过原有命令显式启动：

```sh
env -i /absolute/path/to/node scripts/run-nine-resumable-offline.mjs --offline --output "$PWD/output/new-unique-run"
env -i /absolute/path/to/node scripts/run-nine-resumable-offline.mjs --offline --resume "$PWD/output/new-unique-run"
```

每条仅执行一个有界离线片段，不自动跑满十五日。片段结果新增 `dailyReportFile` 和 `dailyReportHash`，指向 `segment-NNNN-daily-report.json`。该派生报告并列：

1. 从同库原子记录读回的边界快照、人口和个人/公共库存、缺口与状态变化。
2. 逐个重新验证封口的原始片段证据，保留食品来源、加工、腐败、转移/归属、各供餐切片和等待统计的原始scope、complete、issues及totals。
3. 未封口/时间覆盖缺口、明确的 `realModelExecuted:false` 和 `acceptancePassed:null`。

第二部分是**片段范围的既有证据**，不是逐日完整流量或九人专属摄入。报告不把库存差反算消费/产量，`foodProduction`、`foodConsumption`、`grossHealthDamage` 继续为null。报告JSON是派生输出，不是恢复数据库的第三个权威；写出失败会使片段关闭失败，不能宣称交付完成。

## 离线验证

专项：`tests/acceptance-daily-snapshots.test.ts`；独立反例：`tests/acceptance-daily-snapshots-review.test.ts`。在空环境、预加载 `scripts/acceptance-offline-guard.mjs` 下运行，所有数据均由测试新建。覆盖实际runtime分数分钟进食恰在午夜完成、同分钟后续提交、下一步、重载、数据库触发器写失败回滚、两个连接陈旧revision、跳过日界拒绝、历史删除/修改、缺字段、重复人口/库存，以及真实子进程在快照事务内部和commit之后退出后的重开结果。

这些不是并发压力、实际断电或硬件故障测试，也不证明SQLite之外的原子性。构建时禁用Vite环境文件读取；最终实际命令与通过/未运行范围由交付报告列出，不以专项代替全仓验收。

### 2026-11-11 冻结候选结果

- 空环境 + offline guard，新专项、独立反例、resumable、真实子进程恢复和receipt回归：52/52通过，0跳过。独立审查16项包含在这52项内，不能重复加算。
- 原集成/停止控制4个文件的63项在空环境、原有抛错/假fetch夹具下通过，0跳过。先给它们统一预加载guard时有47项在重定义不可配置fetch的夹具阶段失败；随后确认它们注入的模型和fetch均为合成后，按原测试工作流重跑，不修改guard或既有测试，不发真实请求。失败日志保留，不称初次全绿。
- 全仓TypeScript检查和服务端编译通过。Web构建通过，显式 `configFile:false, envFile:false` 并复制原base/outDir，未加载环境文件；仍有原有大chunk警告。先预加载guard的Web构建因其realpath包装不保留 `.native` 导致Vite `safeRealpathSync is not a function`，该工具兼容失败与最终安全配置构建分开记录。
- 公开CLI实跑新建→恢复，两段退出码0、进程组清理完成，分钟480→540→600，请求/成功36→72、pending为空。两份统一报告hash核对、SQLite quick_check、源码指纹复核通过。未到午夜，因此只存在480基线，540/600末端保持缺测；午夜实际行为由专项runtime/engine和事务测试验证，不拿这两段假装跨日。
- 原五个赠食可见性候选逐文件SHA-256保持不变，暂存区为空，没有commit/push。

最终日志和CLI样本保留在 `output/daily-snapshot-development/`。完整425文件的 `npm test` 未运行；这是115项相关验证和构建结果，不是全仓或真实模型验收。
