> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 未知年龄展示：独立审查

## 结论与范围

本次限定审查未发现可复现的新增年龄误标、幼儿喂养提示误推断或人物信息边界放宽。出生资料未知仍保留登记监护关系，但不据此推断幼儿；正式输入明确显示年龄未知，真实零岁仍显示零岁。人口簿将未知年龄单列，不把未知算入未成年人，也不改变常住/访客人数。

独立检查了 `personal-observations.ts`、`decisions.ts`、`observer-feed.ts`、`shared/types.ts` 与客户端 `main.ts`、`community.ts`、`history.ts` 的相关路径，并阅读 `time.ts`、身体观察和 observer 合并实现。工作树含大量其他任务改动，本次不对所有差异背书。审查者只新增本报告与 `tests/unknown-age-display-review.test.ts`，未改生产代码或既有测试。

发现并报告的类型检查问题：observer 字段消失判断直接转换 `Record<string, unknown>`，以及主测模型数组被推断为 `string[]`。这些是静态类型问题，已由实现者修正；修正后的类型检查通过。

## 独立反例（12 项）

- null、NaN、undefined、未来出生各两项：保留旧 `lifeStage='infant'` 的远方被监护人，真实 context 和三个模型的准备 prompt 均显示未知，无幼儿喂养文案。使用独立身体数值和餐食/水库存哨兵，验证不泄露精确值；远方人物不进入实时可见人物列表。
- 同四种资料逐次从已知三十岁变未知，再恢复真实零岁和三十岁。服务端基线保留原始 NaN/undefined，JSON 编解码 delta 后经真实 `applyObserverUpdate` 合并，并与独立重连基线及目标 JSON 快照比较；undefined 必须生成 full upsert 且真正删除出生字段。
- 把上述合并结果送入真实 `main.ts` harness，检查已经打开的人物档案、跟随浮层、名册反复更新。此处验证真实渲染与 receive 路径，但 harness 注入的是合并后的完整更新；不是浏览器或真实 SSE 服务器端到端测试。
- 现代 context 的显式 null/undefined/NaN/Infinity/负数展示字段优先于旧正年龄，缺失字段才回退兼容年龄。三模型准备 prompt 全部验证；只改变展示字段，最终编号菜单和睡眠恢复值不变，Resident 不新增持久 knownAge 属性。
- 人口簿混合真实零岁、十八岁、六十五岁、未知常住、未知访客、迁出和死亡人物，未知单列；headcount、人口簿及其他世界字段不变。
- 分数分钟六岁生日前和生日当刻，过时 infant 阶段不能替代真实年龄：真实零岁/五岁保留近身喂养提示，六岁移除。
- 已故人物档案按死亡时刻保留六十四岁；若出生晚于死亡、但早于当前世界时刻，人物档案和生平出生登记仍显示未知。

主测试另覆盖字符串、无穷、不安全时间、正常成年/老年、十八岁生日、旧 context 与内存 SQLite 重载。联合执行包括这些主测，不把独立测试描述为自行覆盖完整持久化链。

## 权限、持久化与兼容边界

`formal.knownAge` 仅是决策输入展示元数据。既有 `formal.age` 与 `ageYears` 的兼容值未替换，未向菜单授予成年人或幼儿权限。既有生理计算仍读取原年龄路径；独立测试没有推进模拟时钟或证明所有生理模块行为，只验证展示输入不会修改这些数据，具体生理/授权回归由相关专项与整仓测试承担。

个人登记说明继续调用既有 `observeBody`，远方登记不新增身体或库存观察。observer 修复采用已有字段消失的实体替换机制，将显式 undefined 也视为 JSON 字段消失；没有改顺序、版本匹配或权限。

保留原有显示口径：名册与人物档案使用死亡时刻，跟随浮层仍使用当前世界时刻。本次没有统一已故人物各入口的年龄时点，也没有更改生平 reader 缓存策略。未知出生资料不会修补、补造或写回年龄。

## 验证记录与局限

```sh
node --import tsx --test tests/unknown-age-display-review.test.ts tests/unknown-age-display.test.ts tests/unknown-age-display-client.test.ts
# 37/37 通过（独立 12，服务端主测 21，客户端主测 4）
node node_modules/typescript/bin/tsc --noEmit
# 修正静态类型问题后通过
git diff --check -- tests/unknown-age-display-review.test.ts docs/reviews/unknown-age-display.md
# 通过
```

独立首次运行 11/12：失败来自测试构造没有近身身体迹象，却期待喂养说明。补充饥饿迹象和同位置后联合 37/37 通过，无生产修复用于掩盖此失败。首次类型检查发现上述静态错误并已报告。

以上均为离线合成世界验证。不推断真实坏档发生率、不证明真实模型决策效果，也不是全仓库或长期运行验收。未读取 `.env`、密钥或真实 runtime 存档，未调用模型、浏览器、npm，未安装依赖、提交或推送。未做桌面/手机真实视觉截图；DOM harness 不是视觉验收。全量离线验证由实现者后续执行。
