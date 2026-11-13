> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 离线九人旅途供餐核对

## 范围

`tests/helpers/nine-food-accounting.ts` 将已有的 `journeyMeals` 与 `familyJourneyMeals` 接入九人离线证据报告。前者只覆盖完成的 `visitorJourney.eat`、`visitorAid.eatMail`；后者只覆盖家庭迁居出发、符合间隔的恢复、行路中的真实逐成员口粮扣减。

没有新增模拟动作、供应、默认观测开关或存档字段。原 18 类实物容器、ID/库存对象别名去重、当前归属判断和只读实现保持原义；不调用 `foodContainers`、`initializeFood` 或世界修补器。快照新增 `worldId` 仅用于验证输入证据来自同一世界。

`foodProduction`、`foodConsumption` 保持 `null`，`completeFoodLedger` 恒为 `false`。本次旅途扩展时未接入的 `emergencyCare`、`publicDuty`，后续已在[公共与紧急供餐核对](nine-public-care-food-accounting.md)接入；本页验证数值保留为旅途扩展时的记录。边界转移、留种/播种、温室、外贸生产及其他未列使用/损失没有完整账本。

## 两种不可混淆的口径

每条回执原样保留，包括外人或跨边界供餐；禁止先过滤 provider 再保存家庭事务。

- `scopes` 按实际扣减容器的现有归属分类为 `nine-and-public`、`external`、`unknown`。兼容字段 `scopedTotals.inputs` 是固定九人和公共实物的实际扣减，不是“九人吃了多少”。加工、腐败、服务材料各留在原切片，不被解释为摄入。
- `beneficiaryScopes` 对进食/供餐回执按固定九个初始身份分类为 `nine`、`external`、`unknown`；食物流与腐败没有受益者，填 `null`。
- `nineIntakeTotals` 只计固定九个受益者收到的可食用食品及伴随水，与提供者或库存归属无关。它记录 `units`、原批次 `nutrition`、独立的 `hungerRelief` 和 `completedServings`。水营养为零；长期照护中的非食物服务材料不当作食物摄入。加工/腐败切片的此字段为 `null`，不是零摄入证据。

例如外人给九人一份餐：九人库存扣减为零，九人摄入为一份。九人给外人一份餐则相反。公共库存属于实物边界，但收餐人不一定是九人；公共实物扣减不能自动变成九人摄入。家庭每条回执只有该成员的一份 meal 和一份 water，不能为每个成员重新加整个供给者库存或整组营养。

两种总量独立判断未知。提供者容器缺失/归属变化可使库存总量未知，但不遮盖已知九人受益的回执。范围外食品营养未知只污染实际相关的总量。原批次营养未知始终为 `null`，不能用饥饿缓解、今天的配方或食品默认值代替。

## 区间、缺测与原子接收

收集器只接受连续的一分钟 `[before.at, after.at]` 快照，回执时间严格在 `(fromMinute, toMinute]`。世界 ID、观测端点及固定九人集合必须一致。午夜、分数分钟都按原真实时间处理，不取整、不回填。

新增两个字段不存在或观测整步缺失，分别增加该切片 `unobservedMinutes`。已有明细继续保留，但该切片两个总量均为 `null`。后续明确空数组不能修补以前缺测。仅明确空数组且整个已接收区间没有缺测时，才有已观察零份。零步报告总量也是 `null`。原 flow/loss 覆盖标记的严格要求保持不变。

在改变任何切片、游标和去重集合之前，先检查整个 observation 的纯数据结构、所有回执时间和身份，再校验旅途原有 schema 与家庭完整事务。数组 getter、稀疏数组和非纯数据拒绝且不执行 accessor；拒绝一条也不留下部分已收明细。输出和输入相互独立，修改原 observation 或之前的 `finish()` 报告不会改变收集器。

- 事件式回执的 `eventId` 在所收切片及已接收区间内唯一。
- 家庭回执没有虚构的 eventId，按 `relocationId / rationNumber / memberIndex` 保留身份。
- 同一口粮事务必须在同一步完整出现：成员序号连续、人数一致、受益者唯一，时间、定义、触发原因一致。
- `providerPortion` 按每个 provider 独立从零连续计数。不同 provider 的第零份不能互相覆盖，同一 provider 的后续份也不能复用第一份原批次。
- 已接收事务再出现、同一成员重复、成员缺失、受益者重复或 provider 次序错误均拒绝，不悄悄去掉一条后宣称完整。

此 helper 是离线证据收集器，不负责持久提交或崩溃恢复封存。运行时 durable commit、writer/hash/封存检查仍由原运行时证据层负责；不能把未提交尝试冒称已提交回执。世界 SQLite 重载可以继续同一个内存收集器，重启新收集器只声明新起点，旧区间不会自动恢复或补零。

## 回归

`tests/nine-journey-food-accounting.test.ts` 使用现有真实引擎与最终编号菜单，并显式构造合成九人身份范围，不修改主九人自然开局脚本：

- visitorJourney、捎信 eatMail 的固定九人/外人本人进食；中途 SQLite 保存加载、暂停和完成后不重放。
- 三成员、两 provider，外人供九人及九人供外人两种方向；逐条保留同一事务并分别核对库存差额和受益摄入。
- 长路中断、SQLite 恢复、符合口粮间隔的 resume、儿童撤回；不把无供餐动作记作摄入。
- 真实未知原营养、缺数组，以及真实多成员回执损坏后的原子拒绝。
- 每个真实分钟与无证据 `stepWorld` 的完整世界深度相等，审计字段不进入世界/存档。

独立边界反例与结论见 [review](../reviews/nine-journey-food-accounting.md)。原正常菜单九人链的八个切片均检查每分钟覆盖；两种新增旅途在该场景没有发生，明确为观测零，不冒充旅途正例或真实模型自治验收。

## 验证记录

- 最终全仓库 `node --import tsx --test tests/*.test.ts`：**2851/2851 通过**，0 失败、0 跳过，约 153 秒。包含新增 13 条真实引擎回归与 28 条独立 review 反例。
- `./node_modules/.bin/tsc --noEmit`、`./node_modules/.bin/tsc -p tsconfig.server.json`、`./node_modules/.bin/vite build` 通过。Vite 仅报告已有的大 chunk 提示。
- `node --import tsx scripts/acceptance-nine-food-chain.mjs --offline`：仍为 6242 分钟、229 个动作全部完成、0 失败/待处理；萝卜 45 + 12 − 1 − 48 = 8，种子 24、硬币 1295 不变。新增两个旅途切片各覆盖 6242 分钟、缺测 0、回执和本人供餐数 0；直接进食中的九人萝卜摄入为 48。四次真实 SQLite 关闭重开断言仍通过。
- `node scripts/acceptance-long-run.mjs 3`：三年通过，第三年累计 16478 计划，账户总和 1290，年度 SQLite 重载成功。这是既有独立合成生命周期场景，不是九人或模型自治验收。
- 聚焦九人 accounting、整链与新增实际旅途测试 33/33 通过；独立 review 最终 28/28 通过。最终全仓库结果包含最后的边界字段与守恒断言。
- 修改文件的 whitespace/diff 检查通过。全程不读取密钥/真实存档，不调用真实模型、浏览器、npm，不提交、不推送。
