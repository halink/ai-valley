> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 本人持久关系记忆独立审查

仅使用合成世界与内存 SQLite；未访问密钥、真实运行存档、网络或模型。审查范围是新增关系摘要与最终模型输入，不代表真实模型一定遵守引用边界。

## 已修复：室外身体接触判断可绕过实际视线

`src/server/relationship-memory.ts` 的可见条件将 `canSeeOutdoorPoint(...)` 和 `canObserveBody(...)` 用 OR 连接。身体接触的室外分支允许距离两步以内的可通行路径，但不等价于无遮挡视线。

合成反例：本人坐标 `(20,20)`，已认识对象 `(21,21)`，`(21,20)` 是悬崖，另一侧可走。`canSeeOutdoorPoint` 正确返回 false，关系摘要仍包含该对象的姓名与本人理解，因为身体接触分支返回 true。这违反了“任何本次不可见对象不进入摘要”的限定；没有读取对方私密理解，但把被遮挡对象当作眼前对象。

独立测试 `diagonal corner occlusion must not be bypassed by body-contact fallback` 首次确实失败，未用 skip/todo 隐藏。实现已把身体接触回退限定为 `person.inside!==null`；室外必须通过视线判断，独立复验确认此反例转绿。

## 已验证边界

`tests/relationship-decision-memory-review.test.ts` 包含 8 个独立测试：

- 本人单向关系；不含对方理解、原事件 ID、库存或健康。修改快照不写回世界。
- 未认识、远方、outside 与直线实体遮挡均不进入摘要。
- 上述对角遮挡反例。
- 旧记录缺失及非法数值、未来时点、非法来源保持未知，不修补世界。
- Unicode 姓名 24 字、理解 120 字上限；引号、角色标签、控制符与 Markdown 标记不能打破引用布局。模型服从性未做实测。
- 最多 6 人；当前交谈目标优先；不修改 context；陈旧或缺失快照不显示。
- 三个模型的最终 prompt 在长 familyNotes 截断后仍保留关系；没有网络请求或世界写入。
- 内存 SQLite 重载保留方向性与旧记录缺失，不在读取时补造理解。

初次独立运行命令：

```sh
node --import tsx --test tests/relationship-decision-memory-review.test.ts
```

初次结果：7 通过、1 失败；失败仅为上述对角遮挡。

修复后独立复验命令：

```sh
node --import tsx --test tests/relationship-decision-memory-review.test.ts tests/relationship-decision-memory.test.ts
```

最终结果：16 通过、0 失败（独立测试 8 项、实现侧专项测试 8 项）。确认室外遮挡反例已修复；没有发现其他阻塞问题。仅验证离线代码与 prompt，不表示真实模型验收或全仓回归已经完成。
