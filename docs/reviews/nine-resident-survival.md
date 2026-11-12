# 九人合成长期生存门槛：独立审查

## 结论

本次审查通过修正后的独立判定实现。新增 `syntheticLongTermSurvivalPassed` 不以终点九人存活代替健康、饥饿与实际供食证据，也不改旧的 `scriptedSurvivalPassed`、默认 v4 策略或生产规则。

独立审查新增 [14 项反例测试](../../tests/nine-resident-survival-review.test.ts)，离线守卫下 **14/14 通过**；同样受守卫保护的 `tsc --noEmit` 通过。这里的正向输入是人为构造的判定器夹具，不是十五日引擎模拟，更不是实际模型自主验收。本审查未单独重跑十五日引擎、全仓测试或构建；主实现者的真实合成长跑应另行报告，不能把本文件的夹具通过当作世界生存通过。

## 发现及修正

前两项在首次独立 14 项复验前修正。第三项随后以 `evaluatorRevision:2` 调整报告语义；冻结的 v1 门槛常量没有改变。

1. **累计营养溢出曾导致误通过。** 单笔有限的 `1e308` 营养可通过原收据数值校验，多笔相加成为 `Infinity`；旧实现将其当成超过供食门槛，完整夹具误报通过。独立反例实际失败，原始失败输出保留。主实现者增加单餐与累计有限性检查，累计溢出现在产生 `nutrition_overflow`、`intake_unknown`，完整营养及末窗营养保持 `null`，复验通过。
2. **复核入口曾先读取未检查的 artifact manifest。** 初稿检查了四个证据文件，却直接读取 `survival-artifact.json`。主实现者已将其读取前的普通文件、非符号链接、单硬链接、16 KiB 大小检查补齐。独立 CLI 短测使用仅指向仓库内无敏感合成 JSON 的符号链接，现以退出码 2 拒绝；没有读密钥、真实存档或敏感哨兵。

3. **无关的行为覆盖失败曾污染全部分项 gate。** 原实现中，缺少共屋领取覆盖等任意 coverage 失败会使 survival、health、hunger、food 全部为假，即便完整身体与供餐样本已证明这些分项满足门槛。revision 2 将身体采样完整性和供餐证据完整性分别检查：缺 `commonsTaken` 只使 coverage 失败；仅缺 `careMeals` 使 coverage、food 失败，存活、健康、饥饿仍按完整身体证据判定。最终总结果仍要求所有 gates 为真，未放松整体通过标准。主专项的这两项反例经独立受守卫复验通过，独立 14 项也在 revision 2 下重新通过。

本审查没有改动主源码；实现修正由主实现者完成，审查者只添加本测试和本审查文件。

## 独立验证覆盖

- 正向十五日判定输入完整通过，并保持 `realModelExecuted:false`、`modelAutonomyAcceptancePassed:null`。
- 健康先跌至 79 再恢复 100，仍因最低健康和峰值回撤失败；最终净健康变化为零不能抹去伤害。
- 饥饿恰好 95 不算 `>95` 暴露，95.001 算；连续 `>=80` 的 121 分钟失败，120 分钟边界允许。
- 最低健康 80、峰值回撤 20 的边界不被测试偷偷收紧。
- 八人正常进食而一人无食物，单独失败；不以全村总量平均覆盖。
- 全程摄入充足但最后三天断供，末窗摄入与含尾段最大餐间隔失败。
- 任一分钟缺少一个供餐渠道，完整摄入及餐间隔为未知，而非补零；未知原始营养不能由饥饿缓解量反推。
- 同一步重复收据被拒绝，不重复计营养；缺少状态区间、替换居民身份及死后复活均不能靠最终存活过关。
- 原生 .25/.75 分钟子步能保留整数终点看不到的健康下降与危险饥饿暴露。
- 八种供餐渠道逐一验证实际受益者归属；供者不同于受者时，供者不会得到该餐营养。
- 有限单笔营养累计溢出不能变成无限供给。

入口短测还验证了缺参数、未知参数和不在限定目录格式内的复核路径均退出 2。没有 guard marker 的分支用完整入口源码在隔离 VM 中验证：拒绝且没有动态载入判定器或控制器。外层 Node 始终预加载离线守卫；这不是一次无守卫物理模拟，也不声称测试了所有操作系统级绕过。

## 门槛与证据语义

门槛是预先固定的工程约定：15 日、九人、最长一步 1 分钟；最低健康 80，峰值回撤至多 20；饥饿 `>=80` 连续至多 120 分钟，`>95` 暴露为零；每人八种供餐渠道完整观察；首段、中段、尾段实际正营养进食间隔至多 1440 分钟；全程营养至少 820.8，末 72 小时至少 164.16。还要求原动作覆盖、支持覆盖、精确终点与重开覆盖。审查未调这些数值来迁就结果。

不完整采样时，`dangerousHungerMinutes`、`sustainedHungerMinutes`、`longestSustainedHungerMinutes` 为 `null`，`observed*` 保留已见值；未知区间不能被描述为零风险。健康最小值、峰值回撤和事件片段来自实际已接受样本，只是已见证据，不补造缺口中的连续极值。revision 2 的 `stateEvidenceComplete` 和 `intakeEvidenceComplete` 分别控制相应分项，整体 coverage gate 仍阻止总结果通过；无关行为覆盖缺失不再抹去已完整证明的身体结论。

营养是原食物营养，不是实际缓解饥饿，也不单独证明长期可得性。总摄入、终末窗口、餐间隔、健康和饥饿分别判定，避免用其中一个代替其余。库存、种植、送达与赠食提议都不能直接记作进食。饥饿暴露采用步末状态分类，不是连续时间积分；健康净变化不是完整毛伤害账。

最终源码另经独立守卫专项确认：以区间开始时仍存活为条件累计饥饿暴露，首次观察到死亡的区间照计，之后已死居民冻结的饥饿值不再累加为活体暴露；对应反例 1/1 通过，日志为 `output/test-tmp/survival-review-death-final.tap`。

生理参数边界也经最终独立守卫专项 2/2 验证（`output/test-tmp/survival-review-physiology-final.tap`）：初态增长率未知时，即使后续均为标准值仍保留 coverage/food 失败，不事后补默认；持续未知或不支持的增长率按居民及问题代码仅记录首次诊断，原始逐帧 journal 不删减，不能把诊断数量当作异常分钟数或不同异常增长率的数量。

观察挂钩读取每次真实引擎推进后的状态与收据，在 .25/.75 分享重开点分别观察；数据不会反馈给菜单策略。旧返回报告的通过公式保持独立。其非干预性除了源码审查，还应使用主专项中有/无观察的相同种子轨迹对比结果，不能仅靠函数名称证明。

证据哈希用于发现改变，不构成防伪签名；合成头部与覆盖声明也不是独立的引擎真实性证明。本判定只支持保留的合成观察，不支持直接把历史只有终点快照的档案补齐成完整证据。

## 复验与原始记录

从仓库根目录，在既有依赖下运行；不安装依赖、不联网：

```sh
mkdir -p output/test-tmp/survival-review-tools
NODE="$(command -v node)"
env -i HOME="$PWD/output/test-tmp/survival-review-tools" \
 TMPDIR="$PWD/output/test-tmp/survival-review-tools" \
 TMP="$PWD/output/test-tmp/survival-review-tools" \
 TEMP="$PWD/output/test-tmp/survival-review-tools" TSX_DISABLE_CACHE=1 \
 "$NODE" --import ./scripts/acceptance-offline-guard.mjs \
 --import ./node_modules/tsx/dist/loader.mjs \
 --test --test-reporter=tap tests/nine-resident-survival-review.test.ts
```

本次原始输出位于被忽略的 `output/test-tmp/`：

- `survival-review-final.tap`：前两项修正后独立 14/14。
- `survival-review-revision2.tap`：分项语义修正后再次独立 14/14。
- `survival-review-revision2-gates.tap`：独立重跑主专项两个证据依赖反例，2/2。
- `survival-review-overflow-first.tap`：营养溢出的原始失败，未删除。
- `survival-review-tsc.log`：类型检查输出，退出码 0。
- `survival-review-cli.log`：参数、路径与无 marker 隔离 VM 的拒绝验证。
- `survival-review-symlink.log`：无敏感符号链接哨兵拒绝，退出码 2。

revision 2 若用于已有十五日 journal，只能称重新判定同一轨迹，不能称重跑世界；原 journal、旧判定器和旧 verdict 应原样保留，新派生副本须另记录版本及来源哈希。本审查不据此声称已经验证该长跑归档的复制或重新判定过程。

这些日志没有随源码交付。可重跑仓库内测试，但不能把重跑结果说成这些历史日志。全程未读取 `.env`、真实 runtime 存档或密钥，未联网、调用真实模型、提交或推送。
