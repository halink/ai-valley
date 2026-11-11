# 未知年龄剩余授权独立审查

## 结论

发现并独立复现一项高严重度剩余授权问题（下节），实现方已补充修复并通过验收。最终 17 条独立反例、54 条主专项、26 条 safe-ground 审查测试合计 **97/97 通过**。TypeScript 最终检查结果见末节。这不是全仓回归结论。

仅新增本报告和 `tests/unknown-age-residual-authority-review.test.ts`，未修改生产实现、主测试、其他冻结模块，也未提交或推送。

## 高严重度发现：监护签署人资格失效未终止财产委托

`protected-custody.ts:99-108` 的 `consentProblem()` 重新检查 provider 和 reviewer 的成年资格，但 guardian 集合只匹配身份，未重新检查其成年/能力。已知 2 岁孩子正常激活委托后，将其签署监护人的出生改为 null，代管人仍能从最终编号菜单选择修护，真实执行后委托仍 active、spent 增加 3。独立新增第 17 条红测固定了该路径。实现方随后在 `consentProblem()` 增加 `c.guardianIds.some(id=>!adult(w,person(w,id)))` 检查（现第 106 行），同时阻断待签和 active 委托，不增加远程共处要求、不删除历史签署；独立复测已转绿。日志：`/tmp/unknown-age-residual-review-guardian-red.log`。此问题由实现方提出角色覆盖疑问后，审查方独立复现；不能让目标年龄检查掩盖签署人资格中途失效。

另尝试 offer 后损坏监护人出生再从最终菜单 accept，菜单未提供该动作，因此未将其记为已复现的菜单漏洞。

## 审查依据和边界

审阅 `protected-custody.ts`、`child-help.ts`、`guardian-evacuation.ts`、`social.ts`，以及专项测试和 helper。为确认真实调用边界，阅读 `medical-transport.ts` 的护送校验调用点，以及 `time.ts` 的年龄定义；未改动它们。

实现方提供的修复前日志 `/tmp/unknown-age-residual-red.log` 经阅读确认是 4 条真实菜单/引擎复现全部失败，而不是仅直接调用 reason 函数的红测。本审查未独立恢复旧生产实现重跑红测。

四项原漏洞的影响分别为：受保护财产权限由成人签署后错误激活、第三人代替未知年龄对象记录公开求助、普通照护实扣餐水、已开始的监护灾害床位运输在年龄未知且健康降至 15 时转换为紧急权限继续运送。第四项是**运输中的权限延续**，不能写成“健康未知年龄目标此前可以从菜单新发起护送”；新发起路径已有医疗门槛。

## 关键检查

- `protected-custody.ts:26,99-110,119-127`：未成年资格要求已知年龄；历史 active/offered 委托重新检验年龄。未知年龄不能依靠 `required()` 的签名集合绕过 `consentProblem()`。终止是保存原历史的权限终止，恢复出生日期也不会复活已终止委托。
- `protected-custody.ts:137`：本人表达异议/结束的入口先于普通能力与年龄授权检查，未因为年龄未知而删除停止权。
- `child-help.ts:12-13,21-30`：报告人能力与年龄、目标已知未成年、幼儿第三人豁免分别核实。历史通知不重新冒充当前观察，不延长原期限、不创造照护权限。
- `guardian-evacuation.ts:17-20`：目标未知年龄在 `requireThreat=false` 的继续运输检查中也拒绝；监护人未知年龄不能作为已成年护送人。`medical-transport.ts:98` 调用该检查，不能因患者危重改用紧急权限延续同一监护运输。
- `social.ts:70-81,84-100`：本人有效同意优先且绑定具体 proposal；未知年龄不获幼儿监护豁免，也不把历史 guardian ID 当成当前儿童代理。已拒绝、撤回、恢复完整能力的目标不能因此转为救急。

## 独立追加的 17 条验收

1. 七种损坏出生值分别作用于已签署委托的复核人以及灾害护送人，均不得获得成年资格，且失败不改委托记录。
2. 委托因未知出生终止后恢复原出生值，SQLite 重载也不复活、不报销材料。
3. 普通照护最后 0.25 分钟跨满 6 岁，失去幼儿豁免且不扣餐水、无消费凭证。
4. 第三方求助最后 0.25 分钟跨满 6 岁，不生成通知。
5. 已选求助动作的报告人出生损坏，完成调用不能生成记录。
6. 本人已经拒绝的照护不能通过未知年龄和健康 15 转成紧急照护。
7. 真正本人同意的普通照护排队至最后 0.25 分钟，再损坏出生并 SQLite 重载，仍只发生一次餐水扣减，出生仍为 null。
8. 床位灾害护送中护送人出生损坏，即使患者危重也停止；恢复出生不会重启运输，位置和剩余材料不变。

直接完成调用用于补充防绕过；正常动作选择使用 helper 的最终编号菜单 → `parseChoice` → `submitPlan` → `stepWorld`。主测试另外覆盖目标损坏、多居民顺序、SQLite 队列重载、有效 0 岁、普通儿童、即时表达停止和财产权/签署/期限保留。

生日测试初稿使用 helper 的 600.001 钟点，浮点相减产生的实际生日为 603.0010000000475，而引擎只走到 603.001；此时仍未满 6 岁，允许第三人求助正确。测试改用整数钟点以真正命中生日，未更改生产年龄语义。

9. safe-ground 和室内 known-address 两条额外运输路径，均通过真实菜单接出到 carrying 后损坏出生为 NaN，SQLite 重载并推进 0.25 分钟，立即终止于实际室内/室外位置；不额外扣料、不更改住所/监护、不另建运输。

10. 已正常签署的监护人出生损坏后，原active委托不能继续从菜单执行修护、扣材料或报销；复核人和目标均正常，防止目标年龄守卫掩盖代理资格缺口。

## 实际执行

工作目录：`/workspace/scratch/720f9c66585b/ai-valley`

```sh
node --import tsx --test tests/unknown-age-residual-authority-review.test.ts
# 初稿 13/14；修正测试钟点并增加两条运输路径后，独立16/16通过。
node --import tsx --test tests/unknown-age-residual-authority.test.ts tests/unknown-age-residual-authority-review.test.ts
# 68 tests, 68 pass, 0 fail, 0 skipped
node --import tsx --test tests/unknown-age-residual-authority.test.ts tests/unknown-age-residual-authority-review.test.ts tests/safe-ground-evacuation-review.test.ts
# 修复监护人资格缺口和旧停止断言后：97 tests, 97 pass, 0 fail, 0 skipped
node node_modules/typescript/bin/tsc --noEmit
# exit 0, no diagnostics
```

最终三文件合跑日志：`/tmp/unknown-age-residual-final-review.log`；早期两文件合跑日志：`/tmp/unknown-age-residual-combined-review.log`；类型检查日志：`/tmp/unknown-age-residual-review-tsc.log`。

未执行全量测试、安装依赖、浏览器或模型调用，未读取真实 runtime 存档、密钥或 .env。实现方另在隔离副本反向还原本轮四文件后，复现 `safe-ground-evacuation-review.test.ts:157` 的既存“满 6 岁不得表达停止护送”旧断言失败，日志 `/tmp/unknown-age-residual-baseline-regression.log`。独立审阅 `medical-transport.ts:19-30` 确认本人停止只依赖当前运输与表达能力，不依赖幼儿年龄，且仅允许短 wait 或本人 cancel/decline，不授予一般行动能力。因此更正旧断言符合既定生产语义，不应修改生产逻辑去取消满 6 岁本人的停止权。邻接整体结果由实现方另行报告。

独立核对了旧 safe-ground 测试修改：只移除过时的满 6 岁拒绝本人停止断言，保留混合计划、额外字段、伪 known-address 等负向检查，并增加 6 岁、18 岁、未知年龄三条正向停止及 move/acceptRescue/care/mixed 禁止验证。此次 26/26 通过，不是以取消负向权限检查代替修复。
