# 写前存档兼容闸门

状态：首个安全小切片；合成验证已完成，独立审查与本批持续规则验证另记。不是完整存档 schema 验证器，也不是已完成全部阶段0/1。没有启用新气候迁移、补发种源、模型请求或新生存规则。

## 冻结的支持范围

- 当前世界 `schemaVersion:1`、合法身份/revision，以及 `formal` / `validation` 模式。
- 完整 inline 世界；历史 terrain 分离但 events/processed 仍 inline 的格式；当前 `terrainKey` 加 `ledgerVersion:1` 的分离账本格式。
- 未知显式 ledgerVersion、无地形却声明分离账本、缺失地形/资源基表、资源差量缺口、terrain 指纹不符，均拒绝后续可写启动。
- 仅保留两个明确升级字段名：`mvpClimate` 与 `worldUpgrade`。目前没有可写格式，任何已存在的值（包括 null）都拒绝。未来实现必须新增受审查的支持，不删除字段绕过。其余旧扩展字段不按名字、前缀或任意 version 正则猜测拒绝。
- 不存在或零长文件沿原新建路径；有未处理非空 WAL/journal 的空主库拒绝。通用 Store 可打开其已初始化但尚无世界行的空库；持久 MVP 保持原策略，非零已有空库拒绝，不悄悄重建世界。

## 原文件只读与所有权

文件探针不对源数据库建立 SQLite 连接。源 DB、WAL、rollback journal 经只读 no-follow FD，以固定64 KiB buffer流式复制到随机私有0700临时目录（文件0600）；不复制或触碰源 SHM。私有副本上的 SQLite 使用 readOnly，按最新 WAL 读取，不使用 immutable 忽略 WAL，不 checkpoint 或修复源库。

源 FD 保持至探针结束。复制前后核对 dev/ino/size/mtimeNs/ctimeNs 与路径身份；变化即拒绝，不重试覆盖。所有路径 finally 关闭连接/FD并清理私有副本；清理失败结构化拒绝，不继续可写启动，不打印存档原文或路径。

**一致性前提仍是入口既有独占所有权。** 此探针不能替直接调用 Store 的代码取得锁，也不保证抵抗不遵守所有权协议的并发写入。MVP/formal/self-hosted 继续用原描述符锚定路径和终身锁；锁可新建自身永久 `.runtime-lock`，这与世界DB/WAL/SHM字节不变分开报告。

hot rollback journal 需要恢复时，私有副本只读 SQLite 会失败关闭。合成用例已确认此类旧档可在另一个可写副本恢复，但本闸门不自行恢复，更不删除源 journal。处置为停机并保留原档与 journal，单独审查/授权恢复副本后再启动；该限制不是“损坏不可恢复”的判断。

## 接入及防御

`WorldStore` 在 mkdir/可写 SQLite/schema 操作前探测，覆盖直接构造入口；read 再核验世界/账本 envelope。commit 在事务前核验待提交世界，并在事务内核验既有同身份 state，防止未知格式被覆盖。模型 runtime 构造仍有原有启动写入，所以未知版本不能进入该阶段。

MVP 保留场景/人口/旧模块验证与 early-return 迁移。self-hosted 在 session 标记创建前先检查格式，避免未知存档造成新未决标记；既有标记不删除，未知发送、恢复与费用策略不改变。此闸门不声称完成 world/session/journal 跨库原子事务。

## 规模和性能边界

DB/WAL/journal 按固定 buffer流式复制，不把整个数据库同时放入内存，但启动需要相应临时磁盘空间及全文件读取时间。每个 world state 的编码和解压后 JSON上限256 MiB；超过范围拒绝，不截断或重建。归档数据库总大小没有凭空设置低上限。资源差量用实际条目数量检验扩展覆盖，不按损坏的巨大 resourceCount 循环。

每次 commit 增加一次既有 state 解压/解析，成本 O(state)，不是 O(历史事件表)。本机合成小样本：MVP 98,304字节库平均探针约1.45ms、commit约2.21ms；formal 135,168字节库探针约55.45ms、commit约4.34ms（10次探针/20次提交，含原有成本）。这不是大型线上档性能保证；不能据此自动启用高频生产新系统。已初始化空库及缺失文件无需副本数据解析。

## 本批合成覆盖

临时脚本/数据在忽略的 output/preflight-verification，不提交测试套件或存档：

- missing/零长新建；MVP gzip、文本 inline、无关旧扩展、formal分离账本及历史terrain+inline账本。
- 真实未checkpoint WAL中的最新分钟被读到；重复探测原DB/WAL/SHM/journal哈希不变。
- 未知世界/账本版本、mvpClimate/worldUpgrade存在、错误账本组合、坏gzip、随机文件，在Store可写构造前失败且原字节不变。
- commit未知依赖拒绝；构造后外部改成未知schema时 read/commit再次拒绝，不覆盖。
- 巨大resourceCount快速拒绝；hot rollback journal停门前，独立可写副本证明原数据可恢复。
- 未知MVP/formal/self-hosted入口不构造运行世界、不调用模型；self-hosted不新建session标记，已有标记原文保留。

未覆盖：实际用户存档、大型历史库压力、断电磁盘保证、全部领域字段合法性、新气候迁移、共享配额/个人知识能力层、真实模型与完整生产部署。继续按依赖逐批实现，不能把本闸门称作总架构安全层完成。

## 检查点

2026-11-18：独立 Spec 与 Standards 两轴审查无 P0/P1；TypeScript/build 通过。实际持续规则验收于 11:32:21 UTC 开始，预计 12:02:21 UTC 结束：每分钟提交、关闭并重新打开新建合成 SQLite，完整读回比对世界。此提交是验收进行中的进度备份，不能视为30分钟已通过。没有访问真实用户存档或调用模型；前端未改，实际浏览器截图仍未获得。

### 持续规则验收结果

已于 2026-11-18 11:32:21.097–12:02:21.472 UTC 完整运行，实际 1800.3748 秒、3596 ticks，每 500 ms 推进1游戏分钟，不追赶补跑。31次提交、关闭、重新打开新建合成SQLite并完整JSON读回比对全部相等；进程退出0、fault:null，4人health100，库存与33个资源数值有限且非负。开始/结束源码指纹一致：`39912a913d33b94efb652c5aa40bd1c2de268d070e985efd5af39132cc7ce223`。

此次覆盖新闸门在持续规则负载下的反复存取，不是实际用户存档、真实模型、完整四季玩法、崩溃断电或画面验收。证据保留在忽略目录 `output/preflight-verification/`，不发布存档/日志。源码检查点 `d8a2251b6abf4ecca1ab3a4590cc224f0048cf46` 的 GitHub CI 成功。
