# MVP 持久气候点值（observation-only v1）

## 已实现范围

只允许 validation、godot-mvp 身份、受支持小地图且无 formal scenario 的规则演示采用。`World.mvpClimate` 的 schemaVersion=1、capability=observation-only、algorithmVersion=1，记录 seed、参数/RH 表指纹、adoptedMinute/adoptedUs、lastMinute/lastUs 与 current 点值。current 使用原 v1 气候算法，但无 previewOnly，明确 observationOnly=true。算法参数仍是首版游戏假设，未证明生态平衡。

旧 `world.minute` 是唯一时钟。首次采用保留其原 Number 和规范十进制微分钟锚点。每次 stepWorld 的内部子步落定旧 minute 后，先同步气候，再处理居民观察；每次调用前校验完整旧缓存、seed/版本/指纹和预期末端范围。时间转换与上限继承 `mvp-climate.ts`（0–10^10 分钟，半值向上量化）。禁止回拨、未知字段/版本、非法字符串和缓存与重算不一致；不能自动修复覆盖损坏状态。

没有新累计消费者，故仅承诺同 seed/算法/端点的点值相同。**没有实现 SEASONS 的事件前 [start,t) 积分、0.05 分钟规范段、余数、阈值切段及水账。** 这里不是数值器完成的声明。后续 PAW 必须另建保持原事件时间/稳定顺序的积分契约，而非把 point 采样误当降雨入渗结算。

## 真实事务与恢复

createMvpWorld 仍生成 legacy 世界供原模型入口使用。createMvpSession 在真实 structuredClone 草稿上采用新状态；不是 copyForSimulation 升权。规则每个 tick 复制 live 数据、继承只读收据历史并 fork 移动观察流；旧动作、气候、事件与收据在同一次 Store commit 成功后才保留新世界。提交失败回退世界/规则 serial/会话决策计数/移动证据，再在内存标故障暂停，不保留扣料或步进。故障暂停是会话状态，失败的数据库事务仍保留此前完整 checkpoint。

session.world 是 getter，不是旧引用。持久重开从存档读取 current，不重新采用或把迁移锚点移动到现在。规则计划身份包含世界 id、提交 revision、actor 与会话 serial，重开 serial 归零不会复用已提交身份。decisions 数是会话级诊断，不是跨重启累计账本。移动流是既有会话级观察旁路，保留每次 draft 的连续性，重开建立新 epoch，不冒称持久轨迹账本。

## 写前边界

save-preflight 逐个 world row 验证精确气候状态；默认 WorldStore 在任何可写 SQLite 打开前拒绝气候数据库（包括非最后行），commit 也拒绝。唯有明确 `allowMvpClimate:true` 才允许已校验气候。规则入口另逐行要求 MVP 范围，且拒绝未结模型请求、模型历史/配置证据及同路径 .self-hosted-session（不删除）。生产模型 journalPath 可独立配置，不能从世界路径可靠定位，因此本入口仅支持无模型历史的纯规则旧档，不自动转换模型存档。旧档资源/库存/田地/动作/legacy 天气不被气候 adoption 改写；原有旧 MVP 升级仍按既有迁移执行，完整旧档的 early-return 不跳过气候采用。

ValleyRuntime 无条件拒绝此气候能力，模型 MVP 在 Store 之前拒绝，self-hosted 在 session 标记之前拒绝。其他生产/验收入口受 Store 默认拒绝保护。该片不会向模型发送双天气，不执行真实模型。

## 使用

默认 `npm run dev` 仍是退出重置的规则演示。独立 opt-in：

```
VALLEY_MVP_RULES_DB=/absolute/path/to/dedicated-rule.sqlite npm run dev:web:rules:persistent
```

仅 loopback，默认端口 3416（VALLEY_MVP_RULES_PORT 可改），GET 只读观察及已有静态 Web 服务。数据库路径必须显式给出；不加载 .env，不读模型配置，不作为模型失败 fallback。需预先导出 Web。原生产启动命令未改变。

内部 startPersistentRulesMvp 提供 autoStart:false 和 session.advance 供确定性验收。先拥有数据库锁、只读兼容检查并绑定端口，之后才可写开库/采用。并发 close 合并，存储未确认关闭不释放所有权，失败可重试。

## 双轨与非目标

Godot 和新观察读取提交 state.current；当前气候雨/雪/混相与旧田的 legacy 雨日明确分开。旧种子/芜菁/灌溉/生长/野食恢复不读取新气候。formal 牧草/鱼/灾害等仍旧规则，不自动开启。没有 PAW、新作物、气候需求、种源发放、雨事件账/谷灵事件、模型适应或真实模型验证。

临时验证在 ignored output/climate-persistence-verification，非新增测试套件。通过范围以该批冻结后的实际报告为准；30 分钟规则运行与实际画面另外记录，不由短脚本替代。

本批临时验证：11项核心检查、5项入口/恢复检查及2项 marker/模型历史拒绝检查；未调用模型。旧规则基线在 0/10/60/480/1440/3595 ticks 对照通过，物理/居民状态与 outdoor movement lastSeq 一致。比较排除了新气候、合法迁移 revision 偏移、计划/event/offer 身份及 events/processed/memories/relation evidence；**不是全事件轨迹逐字一致证明**。记录：legacy-comparison.json、results.json、gates-results.json。移动流可能因既有未观察重定位重开 epoch，因此不承诺 lastSeq 永不归零。

## 冻结检查点

2026-11-18：独立Spec/Standards均无P0/P1，TypeScript/build、18项短验证、两次完整服务重启的smoke通过。实际30分钟持久规则运行于13:21:16 UTC启动，预计13:51:17结束；本提交是进行中备份，不算持续验收已通过。每tick实际提交SQLite，每120tick读回并核对快照/current同源，每600tick关闭服务/释放锁/重新启动并核对完整世界。源冻结期间不改代码；真实浏览器与农业影响仍未验收。
