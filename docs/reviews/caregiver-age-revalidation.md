# 普通 care 施助者年龄持续资格：独立复核

## 结论

本次限定范围通过。`src/world/social.ts` 对 `careAuthority` 和 `careActionReason` 的施助者成年检查，以及 `timelyProxy` 对代理的成年检查，覆盖普通 care 的菜单、排队开始、逐步执行与原子完成。无需修改引擎或新增持久授权字段。

本复核只新增独立测试与本文档，没有修改生产代码。未访问真实存档、密钥、浏览器或模型，未运行 npm、提交或推送。

## 验证路径与结果

独立 fixture 来自 `createWorld(741)`，只保留三位居民，清除建筑、资源与耕地，把双方放在同一室外位置。目标出生日期明确为 2 岁，`guardianIds` 包含施助者。正常动作经真实 `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorldWithFoodEvidence` 执行；观察包装实际调用世界推进，不使用手动伪造完成状态代替运行链。

修改前，最初 58 项测试为 8 通过、50 失败。失败集中于施助者失去年龄资格后仍有权限，以及无效代理仍阻断其他成年人的救助；已有撤回与具体同意绑定测试通过。

修改后扩充独立专项至 81 项，另与两个既有独立回归文件合跑：

```
node --import tsx --test tests/caregiver-age-revalidation-review.test.ts tests/care-withdrawal-review.test.ts tests/adult-emergency-care-review.test.ts
```

结果：116 项通过，0 失败。未声称运行全量测试或构建。

## 反例矩阵

- 施助者出生日期变为 null、undefined、NaN、正负 Infinity、超过安全整数范围的值、布尔值、数字字符串、未来时间，或明确 2 岁。
- 每种变化均覆盖合法提交后尚未开始、执行 5 分钟、完成前最后 0.25 分钟，并反转居民排列。
- 所有失败路径不扣自有餐食/清水，不生成 care meal 观察或 basic-care 事件，不修改受助者财产、监护、亲属及住所。失败后恢复成人出生日期并继续推进，不自动恢复旧行动。
- 内存 SQLite 往返验证 null/NaN 旧无 proposalId 活动；加载后最后一步仍取消，修复出生日期不能复活活动。JSON 持久化中的 NaN 正常成为 null，测试验证这一实际载入结果的拒绝行为。
- 正常成年监护者对真实 0 岁、2 岁受助者仍只扣一餐一水并完成 guardian 供餐。
- 目标 health=15、不能完整决定表达时，历史监护者年龄未知/NaN/明确 2 岁，不阻断另一位已知成年人从真实菜单完成严格 emergency care。存在有效成年代理时仍阻断替代紧急依据。
- 成人受助者已接受提议，不能使未知年龄、2 岁或17岁的施助者取得供餐权限。consent 与 emergency 活动末 0.25 分钟也重验施助者。
- 2 岁、成人、年龄未知但能表达的受助者，在施助者年龄损坏后仍能从真实菜单立即停止具体提议；不因此获得向其他人施助的权限。

## 跨授权依据与撤回

1. 绑定具体 `proposalId` 的行动在最后 0.25 分钟被本人撤回后，不能退回幼儿 guardian 或新 emergency 依据。
2. 后来另一个 accepted proposal 不能替代已撤回的原提议；原绑定及旧无绑定动作都不会消费资源。
3. 原无绑定 guardian 活动遇到后来 accepted proposal，不能偷偷接纳它作为授权。
4. guardian 关系撤销并发生危急健康时，明确拒绝仍阻断 emergency。
5. 有效的新独立提议保持既有语义：撤回一份提议不等于永久拒绝所有以后独立同意。既有回归对此通过。

因此，本范围的撤回绕过已有 proposalId 精确绑定、declined 和 refusesCare 检查充分封堵。没有证据支持为了此次修复增加新的持久 authority 标记。无本人拒绝、无具体提议绑定且真实重新符合紧急条件的情形，不在本次被扩大禁止。

## 成年判断说明

复用现有 `adult(w,r)` 合理：`ageYears` 调用 `knownAgeYears`，仅在未知时返回 0；`>=18` 对未知年龄恒为假，和显式非 null 的成年判断等价。底层已拒绝非 number、非有限值、未来出生日期、不可安全解析时间。此复用只用于成人门槛，不能反过来以未知返回的 0 推断幼儿权限；目标的幼儿判断仍使用 `knownAgeYears` 显式非 null 条件。

## 范围限制

这是普通 `care` 的针对性复核，并非长期照护、医疗运输或所有年龄授权系统的全量审计。测试使用合成世界与内存 SQLite，没有真实用户存档迁移结论。
