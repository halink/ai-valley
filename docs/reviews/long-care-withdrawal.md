# 长期照护本人停止：独立反例审查

范围：只审查本人停止原长期照护合约的有限表达权，以及立即停止、结算复验和远方原承诺菜单的接入。不新增监护、成人代签或医疗权限。

独立测试文件：`tests/long-care-withdrawal-review.test.ts`。仅使用生成的隔离世界及 `WorldStore(':memory:')`；未访问密钥、环境配置、真实存档、模型或浏览器，未安装依赖或提交推送。

## 已覆盖的反例

- 完整决定能力和仅表达能力分别通过直接 cancel、原 promise.withdraw，在 provider 剩余 0.25 分钟时立即停止；验证未扣餐食、未收费、预付款退回原付款人和总钱守恒。
- 伪造 targetId、providerId、fee、replacementId、agreementId、promiseId 和操作混合字段；不能把其他约定当成本人的原约。
- provider、guardian 的仅表达能力不能继承 beneficiary 权限；表达能力不授予新照护、同意、交接和其他成人权限。
- 禁止把停止和等待、吃饭等动作组合成多动作决定；不能重复退款或影响另一份约定。
- 陈旧选择在表达能力消失、离谷、死亡或约定结束后重验。
- 真实远方最终菜单经 parseChoice 进入原 promise.withdraw；远方内部已结算但本人未获知的合约与仍有效合约呈现相同停止选项；停止已结算原承诺不重复结算。
- 扣料前重新检查受照护者拒绝和 provider 能力变化。
- 在停止前保存重载临近完成的服务，仍能及时阻止扣料；停止后保存重载及能力恢复不会重新开启持续分支。

## 审查中发现并交回实现方的问题

1. 初版 supplemental direct selfStop 让远方表达-only 最终菜单丢失原 promise.withdraw，并可能暴露内部状态。已调整为复用原已知承诺 alias，成对菜单测试已通过。
2. 完整能力本人提交混合字段的 promise.withdraw 时，helper 拒绝后仍可能落入普通 promise 路径；普通路径忽略多余 agreementId 并取消原约。已提交独立失败反例给实现方；实现方在 promiseTarget 和 completePromise 两处加入形状复验，最终反例转绿。

## 验证命令

`node --import tsx --test tests/long-care-withdrawal-review.test.ts`

`node node_modules/typescript/bin/tsc --noEmit`

最终独立回归：30/30 通过，TypeScript 无输出成功。红绿过程：初跑 24 项中远方真实 alias 缺失 1 项失败；补充后 28 项中混合 alias 绕行 1 项失败；修复后新增重载临界时刻及失能成人权限反例，30 项全部通过。只运行本独立测试及类型检查，完整回归由主执行者统一运行。本审查不替代真实模型长期验收。
