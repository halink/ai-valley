> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 限时儿童照护的未知年龄权限审查

## 结论与范围

2026-11-07 独立审查 `src/world/emergency-care.ts` 的未知年龄修复、`care-withdrawal.ts` 的本人停止入口及 `engine.ts` 的即时分派。未发现本切片的阻塞问题。

未知年龄不能证明未成年资格或幼儿同意豁免。提供者与复核人仍须能证明成年；真实未满六岁孩子保留原独立复核后供餐流程，满六岁须本人接受。原协议在年龄失去有效依据后按既有条件变化规则失效，保留原 ID、期限、签署及已发生账目；之后日期变为有效也不复活原约。

新增的本人停止只允许在世、在地、能表达的原受益人停止自己那一份原期限内的约定，不要求重新证明年龄或完整决定能力。动作仅允许 `type`、`operation`、`agreementId`；不能夹带同意、复核、喂养、其他人或后续动作。`submitPlan` 接受时立即生效，不等待另一个人的最后供餐工时。未结束的无关本人计划不因这一次停止被替换。已经结束但尚未获知的原约可记录一次本人异议，不改写既有终态或延长期限。

`requestHelp` 等求助动作转交独立的 `child-help.ts`，不属于本次结论。本文也不证明其他监护、收养、财产代管或迁居入口已覆盖未知年龄。

## 独立反例与正向对照

新增 `tests/emergency-care-unknown-age-review.test.ts`，共 10 项：

- 真实编号菜单启动幼儿照护，最后 0.25 或 1.2 分钟恰逢已存分数出生日期定义的六岁生日。含内存 SQLite 重载：零供餐回执、零扣粮水、零收费，原期限与本人未同意状态保留。
- 已排队的原幼儿供餐经内存 SQLite 保存 null 或未来出生日期后停止。未来时钟后来达到该出生日期，或显式恢复有效日期，原失效协议仍不恢复服务。
- 年龄明确的十岁失能、严重衰弱儿童仍可经真实菜单接受一份当次救急。只扣提供者一餐一水，不形成持续协议、监护或现金变动。
- 实际完成四次供餐的旧约，出生日期后来未知时，仅表达的本人仍可记录异议。已消费物资、四份原回执、completed 终态及原期限不回滚；同一计划回执重放不重复写入。
- 远程、仅表达、仍有原 wait 计划的本人可以即时停止照护；不移动身体、不替换该计划，也不改变库存与财产权。附带 childId、reviewerId、step、noticeId、observedTarget 或改成同意/复核/喂养均不能利用这一入口。
- 原期限恰好届满时不再提供此停止入口，不为了接受停止而延长或改写原约；正常到期处理仍成为 expired。

实现者的 `tests/emergency-care-unknown-age.test.ts` 另覆盖 null、缺失、字符串、NaN、正负无穷、未来和不安全数值，新提议与救急拒绝、复核完成竞态、旧供餐最后一步、提供者/复核人资格变化、本人拒绝、SQLite、本人可表达与不可表达的区别，以及有效三岁、六岁和十岁对照。已有测试继续覆盖正常失能幼儿、未知监护缺席、真实危重条件、空间及物资限制、固定四餐额度和远程信息边界。

## 执行结果

以下八文件合跑 **168/168 通过，0 失败，0 跳过**：

```sh
node --import tsx --test \
  tests/emergency-care-unknown-age.test.ts \
  tests/emergency-care-unknown-age-review.test.ts \
  tests/emergency-care.test.ts \
  tests/emergency-care-meal-evidence.test.ts \
  tests/care-withdrawal.test.ts \
  tests/care-withdrawal-review.test.ts \
  tests/fractional-birthday-consent.test.ts \
  tests/fractional-age-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

类型检查通过。该记录是针对所列文件的局部验证，不代替全量测试、构建或真实模型验收。

全部证据来自离线合成世界、实际菜单与引擎、内存 SQLite。审查仅新增本文件与独立 review 测试，未修改生产代码，未读取密钥或真实存档，未调用模型、浏览器或 npm，未提交或推送。坏日期是显式构造的异常前提，不据此推断正常存档的发生率。
