> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 家庭食物菜单独立审查

## 范围与结论

审查本批 `src/world/household.ts` 的候选生成/预算，以及 `src/server/agency-opportunities.ts` 的家庭食品插槽。工作树存在大量既有改动；本审查不把整个 diff 归于本批。审查者仅新增本报告和 `tests/household-food-options-review.test.ts`，未改实现。

截至本次复核，没有发现本批轮换放宽双方独立同意、接收者本人接受、实物产权或完成时重验的漏洞；补充反例审查发现并确认修复了食品 withdraw 原控制项优先权被抽取破坏的问题，见下节。先验证再轮换，以及按完整候选身份轮换，可以消除固定 item slice 和独立嵌套轮换造成的永久遮蔽。最终菜单仅消耗空位或多余 reflect，保留最后一个反思与非反思行动。

## 发现并在本批处理：另一出资人独有食品的模板缺失

初审时所有 proposeGift 模板固定为 quantity=1、ownPercent=50。按既有取整规则，这要求提议者持有1份。若提议者份额没有根菜，而另一出资人份额有2份，ownPercent=0 的赠与合法，但默认模板被 householdReason 拒绝，任何时间轮换都不能显示根菜提议。

确切复现见测试 `partner-only food exposes a zero-percent proposal`：正式 seed 5401 初始化家庭池，两位成年人分别接受1钱初始出资；审查用合成库存把创建者根菜设为0、另一人设为2，儿童在池旁且为已知对象。quantity=1、ownPercent=0 的 householdReason 返回 null，而50返回拒绝。旧实现连续12个30分钟窗口没有根菜模板。

这是原有默认模板边界，不是本次轮换新引入。主工作者已补上本人无1份时使用 ownPercent=0 的合法模板。复核测试确认模板出现、比例为0、每个模板仍通过原校验，菜单生成没有扣物资、创建赠与或替任何人同意。执行时的独立批准仍使用原流程。

## 已修复的补充反例：食品 withdraw 的既有控制项优先权回归

初版把所有 household 食品 create/deposit/withdraw/proposeGift 从基线菜单抽出后再补空槽，误将既有 withdraw 控制项降级为“有余位才显示”。这不能仅解释为新功能在满菜单下的限制。

确切复现：`focusedChoices` 输入55个 move、1个 reflect，再加入一项 `{type:'household',operation:'withdraw',poolId:'review',amount:0,item:'turnip',quantity:1}`。初版56项结果不含根菜领取。仅把 item 改成 wood，同样的领取行动通过原 `control` 优先通路保留。原 `control` 分类包含 withdraw，食品此前也应获得相同优先权。

已新增第7项测试 `food withdrawal keeps the existing withdrawal control priority under saturation`，初版确认失败。最终实现已让食品 withdraw 保留在原 control 通路，并在末尾食品插入前通过 result.includes(c) 去重；其他食品模板仍绕过第二次领域轮换。审查者重新读取最终源码并实际重跑，7/7通过，包含8个轮换窗口中的食品领取优先权反例。已修复的取回优先权回归与下述新增非控制食品的无槽限制是两个不同问题。

## 明确保留的边界

1. **全部槽位被保护行动占满时，不保证新增非控制食品可见。** 用55个普通行动与1个 reflect 构造56项候选，再加一项家庭根菜存入。8个轮换窗口中最终菜单与未加根菜时完全一致。这符合“不驱逐非反思行动，保留最后一个 reflect”的明确约束，不应声称任意全关键饱和菜单都能显示食品。
2. **静态轮换公平不等于实际生存或时限内成功。** 多池、多接收者和多食品的完整候选有较长轮换周期；库存变化、到场、过期与已有提议数量会改变候选集合。本测试中的时间赋值只用于检查轮换数学，不模拟食物老化或居民自主行为。
3. **食品指 goods.food > 0。** 生猎肉等不可直接食用物资属于现金/材料预算。这与本批分类一致，不代表所有烹饪原料都有食品保留槽。

## 独立验证

新增7项离线定向测试：

- 验证后预算：不足1份的浆果不占槽，另一人的面包份额不会变成本人领取；餐食和根菜的存取仍能轮换出现。
- 2个池、全部已知在场接收者、3种食品组成的合法完整候选，在一个静态完整周期内全部出现。第二个池为显式合成选择器夹具，不用于经济执行证明。
- 44个普通行动与12个 reflect 的饱和候选加入根菜后仍为56项，改变的位置仅原 reflect，至少保留1个 reflect。
- 55个普通行动与1个 reflect 的非控制存入无可替换槽边界。
- 同样饱和情况下，食品 withdraw 必须保留既有 control 优先权，不能弱于材料 withdraw。
- 另一出资人独有食品的0%提议模板回归。
- 未改变居民关系/库存的正式九人 seed 5401，经 initializeHousehold 后，最终 create 菜单在12个轮换窗口内出现浆果、根菜和餐食。

运行命令：

```
node --import tsx --test tests/household-food-options-review.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

最终独立定向测试7/7通过（实际重跑，含修复后的第7项优先权回归）。最终本地 TypeScript 检查也已实际重跑，无输出并以0退出。主工作者另有正式seed的执行、竞争、过期和重载测试，本报告不将它们冒充独立审查结果。

没有调用模型、浏览器或 npm，没有读取 .env、密钥或运行时真实存档，没有提交或推送。上述结果仅为离线规则/菜单验证，不是九人模型自主生存验证。
