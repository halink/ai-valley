# outsideAid.collect 食品转移证据独立审查

## 范围与结论

只审查真实完成的 `outsideAid.collect`：已经到达的 `aid:<deliveryId>` 实物转到领取者 `person:<recipientId>`。不把到站、预留、发运、取消或预测当作边界流入；不把领取当作进食或生产。固定九人的个人容器接收才计九人 scope inflow，其他人接收为 external → external。

本审查新增 `tests/food-transfer-aid-review.test.ts`。未改生产文件；未访问真实存档、密钥、模型或浏览器，未安装依赖、提交或推送。SQLite 检查仅用合成世界与内存数据库。独立检查发现两处问题，实现者修正后独立复测通过。完整边界账仍然**否**：贸易、遗产、所有权变更等未覆盖。

## 发现的问题

### 1. 跨步初始化可把未知批次变成已知原始营养

复现：真实 fixture 排队领取后删除 aid 批次；先执行一个捕获步骤，让既有 `initializeFood` 补账，再在后续步骤真正领取。初版回执把补造的当前 `food/life@1` 批次算作原批次，报告 80 nutrition；原来真实批次应为 28，而批次丢失后正确证据应为 `nutrition:null, lots:null`。欠账两份时同样错报 54。插入未捕获步骤或先 SQLite 保存/重载都不消除此问题。

原因：原有未证明批次标记仅在单次 capture 中存活，下一步不能证明批次来自此前初始化修补。修正建议是使用 delivery 创建时间作为原批次的保守上界：领取的全部原批次必须严格早于预留 delivery 的创建时间，后来产生或时间相同的批次均不证明营养。这无需扩展 World、存档字段或建立跨克隆传播的常驻观察状态。

限制：这不是通用历史真实性证明。若过量账被裁剪但留下同一原批次 metadata，后续保存状态与本来合法的同量原批次不可区分。不应声称已证明所有历史修补均可检测。相反，真正同分钟产生并预留的批次可能被保守标为未知；这比虚构已知营养安全。

### 2. 九人 helper 的 coverage/array 组合比正式 schema 宽松

带 `foodTransferCoverage` 却缺 `foodTransfers` 的 observation，在正式 schema/runtime 中被拒绝，但 helper 初版接受并推进 minute/coverage。之后同一分钟修正后重试会失败，破坏“接受前验证全部输入”的边界。

要求：声明 coverage 必须有对应数组；在任何身份、分钟、coverage 或 receipt 状态变化前拒绝。旧输入同时缺这两项仍合法地表示未知，不能变成已观察零值。

## 已核对的防线

- 真实领取在最终完成点重查资格、请求有效性、身份、谷口位置及真实剩余；腐败后的分数余量不是原承诺数量。
- 完成领取不减少饥饿，不产生 direct eating 或 source-added 事实，原营养按实际原批次定义计算。
- 严格 schema 拒绝额外字段、访问器、符号、稀疏数组、非标准原型、无效数量/时间/营养和伪容器。
- runtime 在第二条 transfer 出错时不发布第一条、不推进 throughMinute/sequence，不调用嵌套 getter。
- writer 在第二条 transfer 出错时不追加任何 journal 行或字节，不增加 durableRecords。
- helper 在稍后 slice 与 transfer 共用 eventId 时整体拒绝，修正后可以同分钟重试，且没有新增进食营养。
- daily 返回脱离输入的原始观察；稍后 event 无效时整次抛错而非返回前半结果；旧缺失输入不补造每日零行。daily 原始行不是已去重审计总量。
- 已有 schema/helper 回归覆盖跨步 eventId 与 deliveryId 去重；未知原营养保持 null，旧 coverage 缺失不推算总量。
- runtime durable commit / SQLite 失败后的发布顺序由同切片 `food-transfer-aid-commit.test.ts` 检查，本审查不改该文件。

## 验证记录

初版独立回归：9 tests，4 pass / 5 fail，失败均为上述两处问题（含跨 SQLite 重载）；`node node_modules/typescript/bin/tsc --noEmit` 通过。修正后独立回归增至 12 tests，12/12 通过，含预留同分钟及其后批次保守未知、跨 SQLite 重载，以及过量旧批次 metadata 的明确限制。

最终聚合命令：`node --import tsx --test tests/food-transfer-aid.test.ts tests/food-transfer-aid-schema.test.ts tests/food-transfer-aid-review.test.ts tests/nine-aid-food-accounting.test.ts`，72/72 通过。最终 `node node_modules/typescript/bin/tsc --noEmit` 通过。此记录不是全仓测试、完整财产边界账或真实模型验收通过的声明。

## 最终定向复核

复核新增 `food-transfer-aid-nine.test.ts` 与最终 daily/helper 修正，未发现新增阻塞问题。固定身份取自 seed 5401 的九人，并显式比对 `NINE_RESIDENT_PLAN.residentIds`；地图、谷口、库存、年龄等仍为隔离合成 fixture，不是未经改动的完整 seed 生存验收。领取走原编号菜单和真实行动完成流程，4 份腐败为 2.5 份后，在行动尚余两分钟时保存并 SQLite 重载，再验证仅一次 external → nine 流入，原营养 17.5。之后独立提交 eat，验证摄入 1 份/7 营养而转移仍为 2.5 份，不混计为生产或完整消费账。

最终 daily/helper 都在接收 transfer 前拒绝 coverage 声明下的缺数组、undefined 与 getter，失败后同分钟可正确重试；daily 的同一步与两个时间方向跨 slice eventId 碰撞、跨午夜 eventId/deliveryId 重复均在改变分钟/身份记录前被拒绝。旧输入同时缺两字段仍保持未知；daily 原有非 transfer slice 的重复处理不被这次修正扩大改变。

定向命令：`node --import tsx --test tests/food-transfer-aid-review.test.ts tests/food-transfer-aid-nine.test.ts tests/food-transfer-aid-daily.test.ts tests/nine-aid-food-accounting.test.ts`，**39/39 通过**。本次只补审查记录，没有修改实现或测试；全仓验证由主任务另行记录。
