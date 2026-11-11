# 继承空屋出租独立复核

日期：2026-11-07。仅使用隔离生成世界、内存 SQLite 与已有本地工具。未读取密钥、真实存档或运行日志，未调用模型、浏览器、npm，未提交或推送。

## 结论

本轮未发现阻塞问题。`src/world/premises.ts` 的空置判断将人物 `homeId` 占用限定为 `status === 'alive'`，与 `recordDeath` 保留最后住所历史、移除实际住户登记的设计一致。死者历史记录未清除，也没有把死亡自动等同于继承或清空场所。

核验了报价与接受均经 `siteError`：产权、建筑状态、登记住户、床位与实际室内在场者等仍独立判断。`inside` 判断没有增加存活筛选，因此室内遗体仍阻止出租。实际在途签约、家庭迁居、照护、临时床、共同财物与保护代管边界保持有效。

## 主动寻找的反例

新增 [独立回归](../../tests/inherited-residential-review.test.ts) 4 项：

1. 真实死亡后、继承前，潜在继承人不能报价，死者也不能报价；真实继承完成后才允许，死者 `homeId` 保留。
2. 即使登记名单中残留的是死者，报价和接受仍拒绝，不静默清理 `building.residents`。
3. 报价之后遗体进入室内，接受必须失败且不改变世界或预付钱款；只解除实际室内存在之后才接受，仍保留死者历史住所。
4. 使用与双方独立的在世镇外人物持有同址 `homeId`，精确断言报价/接受均因既有住户拒绝，避免签约人自身资格先失败而掩盖占用校验。

复核曾指出实现者 `outside-homeId` 案例以承租人本人作为障碍，接受阶段可能被身份资格提前挡住，不能隔离证明空置校验。实现者已改为独立活人，并增加船上登记占用；独立测试保留精确错误断言作为补充。此项是测试覆盖问题，不是发现了实现缺陷。

## 验证结果

最终独立运行以下 5 文件，**59/59 通过**：

- `tests/inherited-residential-leases.test.ts`：6 项，包含实际死亡证据、真实继承、最终正常菜单、计时睡眠；死亡/继承/报价/接受/到期 SQLite 重载及重复结算；两阶段活人占用、在途签约与其他权利冲突。
- `tests/inherited-residential-review.test.ts`：4 项独立反例。
- `tests/residential-leases.test.ts`：17 项。
- `tests/premises.test.ts`：24 项。
- `tests/residential-social-integration.test.ts`：8 项。

命令：`node --import tsx --test tests/inherited-residential-review.test.ts tests/inherited-residential-leases.test.ts tests/residential-leases.test.ts tests/premises.test.ts tests/residential-social-integration.test.ts`。

共财边界测试最初缺少 `HouseholdState.nextSerial/totals`，实现者已改成完整类型记录；独立复跑上述 5 文件仍为 **59/59 通过**。随后执行 `node node_modules/typescript/bin/tsc --noEmit`，继承住宅测试类型错误已消失，但全仓检查仍以退出码 2 结束：并行任务的 `tests/closed-shop-estate.test.ts:92:98` 出现 TS2339（`wood` 不存在于 `{}`）。此项已报告协调修复，不能把此次全仓类型检查标为通过。新增文件差异空白检查无诊断。

## 边界与不足

- 本复核没有改动生产实现或实现者测试；只新增独立测试和本报告。工作区已有大量其他变更，结论针对所检视逻辑与上述测试，不宣称全仓差异审查。
- 原实现红测由实现者执行并报告；独立复核没有在共享工作区回滚生产文件再重复红测，以免干扰并行任务。
- 到期测试直接推进世界分钟并结算，不等于多年逐分钟运行。部分阻塞权利以类型化测试记录注入，验证已有承诺的保护，不声称逐个完整照护/运输业务链验收。
- 未运行浏览器视觉、真实模型或真实存档迁移；未执行全量测试、服务器编译或前端生产构建。本专项通过不替代这些独立验收。
