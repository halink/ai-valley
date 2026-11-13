> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 未知出生记录：剩余幼儿代理路径

## 已复现的具体缺口

本切片只核查 `protected-custody.ts`、`child-help.ts`、`guardian-evacuation.ts` 与 `social.ts` 的普通 `care`。先通过合成世界的 `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorld` 复现，再修改生产代码。初始四条测试均失败，失败点是实际世界结果，不是缺少菜单或夹具初始化失败：

1. `custodyOffer → custodyAccept → custodyReview` 把未知出生受益人当幼儿，成人单独签署便成为 `active`；孩子没有独立接受。未知年龄也可让旧委托继续劳动、处置产物与报销。
2. `emergencyCare.requestHelp` 经独立 `child-help` 路径，把未知出生对象当幼儿，允许旁人为其记录拟公开的照护需要。原四测中实际生成一份求助记录，预期应为零。
3. 普通 `care` 从未知出生记录得到幼儿监护依据，实际扣一餐一水。修复前 `{meal:10, water:9}` 变为 `{meal:9, water:8}`。
4. 已经正常接出的监护灾害床位护送，在对象出生变未知、健康转为15时仍保持 `carrying`。原监护灾害边界把未知当幼儿，后续通用救护检查又回落为紧急依据，实际延续了原先的监护护送。这不等于健康的未知年龄者原本就能发起新护送：后者已被此前的医疗授权检查挡住。

独立审查继续发现当前监护人自身生日损坏的代管漏洞：已生效委托仍能从真实菜单修缮并报销3钱。另行的正常菜单签署在最后0.25分钟损坏监护人生日，仍会把其记入 `acceptedBy`。这两条补充测试修复前均失败。已损坏监护人重新从最终菜单发起签署本来会被上层过滤，不能混为同一漏洞。

## 实现

统一复用 `knownAgeYears`，不改动兼容显示用的 `ageYears`：

- 财产代管要求受益人当前有可核实的未成年年龄；幼儿豁免只适用于已知小于六岁。待签、执行、完成、原址进入与逐步终止检查共用同一条件。提供者、复核人及原监护人须维持原要求的成年与决定能力，不新增远程共处要求。未知时旧委托按既有终止机制成为 `invalid`，取消其未成交报价，保留原签署、创建/截止时点、已发生收支和受保护份额；不会因日后年龄恢复自动复活。
- 求助记录的创建和完成必须核实目标未成年身份；代为公开求助的豁免必须核实目标未满六岁。已经合法创建的历史消息仍可按原规则张贴、读取、撤回或旧址探访，不因远处出生记录变化改写原观察、地址和期限，也不转化为照护、进屋、住房或监护权。
- 监护灾害护送在新选择、接出、已启动搬运和重载后都核实幼儿年龄；未知不会继续原床位、干地或室内已知地址路径，也不能把原监护行动自动改成另一项紧急行动。停止于真实位置，已花掉的接出布水不退款，也不再扣一次物资。
- 普通照护的幼儿监护依据只接受已知年龄。真实本人接受的一次照护仍是独立依据；未知年龄不撤销它。危急照护仍可使用原本与年龄无关的严格条件；未知本身不证明失能或危急，历史监护ID也不能充作未知年龄者的有效代理来阻止该严格救急。明确拒绝、完整能力恢复和已拒绝的具体提议继续阻止绕行。

不修补或猜测出生记录，不赋予成人身份，不改生命周期和表达/决定能力，不改变产权、监护关系、住房、原期限或已发生资源记录。有效0岁、2岁与正常孩子的本人选择路径保持。

## 本人停止与过时测试

`medical-transport.ts` 的本人停止契约和此前 [未知年龄医疗边界](unknown-age-care.md) 明确允许具表达能力者立即停止自己的当前护送，包括原干地撤险。年龄授权决定能否继续搬运，不决定本人能否拒绝。

邻接回归发现 `safe-ground-evacuation-review.test.ts` 一条旧断言仍期望满六岁即不能表达停止。隔离复制源码并反向还原本切片四个文件后，同一断言仍为 `actual:true / expected:false`，确认是既存测试契约冲突。经独立审查规则与父任务确认后，删除这一过时年龄断言；保留混合动作、附加目标、无表达能力、伪改 `known-address` 范围及终态拒绝断言。另加6岁、18岁、未知三例真实编号停止，确认停止成功且不授予移动、接受同意、照护、混合计划或一般决定能力，位置、物资、监护和住所不变。没有为使旧测试通过而限制本人停止或放松生产权限。

## 验证范围

主测试 `tests/unknown-age-residual-authority.test.ts` 使用七类非法出生值：null、缺失、NaN、Infinity、字符串、未来时间和不安全整数。覆盖最终菜单与直接完成、最后0.25分钟、两种居民顺序、实际库存/现金/产权、原签署和时间证据、内存SQLite待执行及旧约重载、已开始搬运、重复重验和停止回执重放。独立反例和最终检查见 [审查记录](../reviews/unknown-age-residual-authority.md)。

最终主专项54项、独立审查17项；包含这些测试的20文件邻接回归 **411/411通过，0失败、0跳过**。独立审查另合跑主专项、审查专项与干地审查三文件 **97/97通过**。直接 TypeScript 类型检查和修改文件差异/空白检查通过。

```sh
node --import tsx --test \
  tests/unknown-age-residual-authority.test.ts tests/unknown-age-residual-authority-review.test.ts \
  tests/protected-custody.test.ts tests/child-help.test.ts \
  tests/guardian-evacuation.test.ts tests/guardian-evacuation-review.test.ts \
  tests/indoor-guardian-evacuation.test.ts tests/indoor-guardian-evacuation-review.test.ts \
  tests/safe-ground-evacuation.test.ts tests/safe-ground-evacuation-review.test.ts \
  tests/injured-child-evacuation.test.ts tests/injured-child-evacuation-review.test.ts \
  tests/care-meal-evidence.test.ts tests/care-meal-evidence-review.test.ts \
  tests/care-withdrawal.test.ts tests/care-withdrawal-review.test.ts \
  tests/adult-emergency-care.test.ts tests/adult-emergency-care-review.test.ts \
  tests/unknown-age-care.test.ts tests/emergency-care-unknown-age.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

本轮只运行以上离线专项与邻接回归。没有运行全量测试、启动真实时钟或模型、浏览器、npm、读取密钥或真实存档，也没有提交或推送。

## 未覆盖和刻意保留的路径

- 不重新修改此前已冻结的 `family`/`guardian-consent`/`life`、长照、医疗代理同意、`emergency-care`限时喂养、`adoption` 或 `family-relocation`；有关文件只在必要的显式邻接测试中使用。本页不是全仓未知年龄全部修复的声明。
- 不新增未知年龄者的儿童公开求助或代理授权流程。旧记录里的成年资格、出生或合法监护证据缺失，需要另行核实，不由本切片生成事实。
- `custodyInspect` 的旧址走访不因原委托终止而消失；进入他人室内和任何劳动仍须在实际到场时通过当前权限检查。历史求助信同样只提供旧址，不自动刷新位置。
- 求助撤回仍沿用原有能力、知情、公示处到场和期限要求；财产异议仍沿用原有当事人表达检查。本切片没有把这些操作扩展为新的全局即时表达入口。
- 没有对其他年龄显示、教育、就业、继承领取、一般成年权限或全仓全部 `ageYears` 消费者作完整独立审计；也不证明真实模型长期运行或完整接应已实现。
