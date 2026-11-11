# 实际发言语气：独立审查

## 范围与结论

审查普通 `talk` 的实际完工事件、本人/现场见证者记忆、决策输入和持久化。语气是本人选择的表达方式，不是听者感受，也不证明话语内容真实。没有修改生产代码、原有听觉/可观察规则或关系分值规则。

独立测试：`tests/dialogue-tone-review.test.ts`。复现命令：

```sh
node --import tsx --test tests/dialogue-tone-review.test.ts tests/dialogue-tone.test.ts tests/dialogue-content.test.ts
```

## 发现与红绿证据

事件入口原来仅对传入记忆的语气/原话做校验，事件本身仍展开 `...input`：非法 `FRIENDLY` 和超过240 UTF-16单元的原话会保留在事件，非 conversation 也可能保留语音字段。`emitLedgerEvent` 的校验变量同样未用于事件构造。

独立反例先红：新增最后一项入口测试后，独立专项 6 通过、1 失败；`emitEvent conversation tone` 实际 `FRIENDLY`，预期 `undefined`。负责人修正后，两个入口先剔除原字段，再仅为 conversation 写入有效语气及非空白、最多240单元原话；事件与既有见证者记忆使用同一过滤值。原独立反例转绿，独立专项7/7通过。witnesses 的计算条件与关系处理未改变。

中间联合复测曾为三份专项23项、22通过、1失败：新增 `dialogue-content.test.ts` 的饱和议程/五条完整记忆触发 `model_context_limit`。原话负责人随后按真实JSON字节在超限时裁剪旧综合摘要，并明确标记省略，保留完整原话和编号，不扩大模型输入限制；独立最坏混合记录预算测试随后转绿。最终冻结版完整验证见下文。

## 独立覆盖

- 仅接受 neutral/friendly/hostile 精确值，不根据情绪词、旧文本或名字推断；240单元边界明确。
- 旧事件及记忆的缺失字段保持未知，内存 SQLite 往返不补造。
- ledger-only 事件不分发给任何居民。
- 仅复制到既有 witnesses；actors 中远方或不同房间的人不会因此收到信息。显式 witnesses 限制仍生效。
- 本人/在场对方可以保存实际语气，后来到达者不会通过决策构建追补。
- 已提交且开始执行后失去表达能力，不形成发言事件或相关记忆。
- 包含真实换行、引号、反斜杠、伪角色标签和关系指令的原话原样保存；决策引用可 JSON 还原、HTML式角色标签转义；选择的 hostile 不被话语里的 friendly 覆写；关系分值/最后理解不自动改变。
- 室内使用 roomAt 区分距离，不能把同一建筑门口坐标当作现场。

配合主链测试核对正式 seed5401 分钟481的三个语气使用同一句话，经最终编号菜单、解析、执行、听者三种模型模板、内存 SQLite 重载仍保持差异。相反的240字尾句在听者最终输入中完整保存，解释由听者另外选择。

## 明确限制

- `emitEvent` 沿用 canObserve + nearLocation 的六格见证范围及同室条件，不新增真实声学或视线 raycast。室内家具阻挡格位于两人之间时，原范围检查仍可把对方列入 witnesses；独立测试刻意固定此既有行为，不能声称新增了墙体/家具隔音或遮挡过滤。
- 普通编号话语上限为240 UTF-16单元；历史不完整文本不反推为完整原话。
- 引用/转义测试证明输入的数据边界，不证明真实模型永远不会受提示注入影响。
- 全部离线，合成/正式生成seed与 `:memory:` 数据库；不读取密钥或真实存档，不调用真实模型、浏览器、npm，不提交或推送。
- 专项测试不等于全量回归、真实模型长期验收或产品上线验收。


## 共同冻结版最终验证

语气与完整原话两项代码、测试及独立审查全部冻结后，统一执行：

- `node --import tsx --test tests/*.test.ts`：3280/3280通过，0失败、取消或跳过（约179秒）。
- `node node_modules/typescript/bin/tsc --noEmit` 与 `node node_modules/typescript/bin/tsc -p tsconfig.server.json`：均通过。
- 通过Vite API，以 `configFile:false, envFile:false, base:'/ai-town/', build:{outDir:'dist'}` 构建：通过。仍有既有主包超过500kB的提示，无构建错误。
- `git diff --check`：通过。
- `node --import tsx scripts/acceptance-nine-food-chain.mjs --offline`：229次明确脚本选择全部完成，0失败/待执行；seed5401分钟480→6722，期末9/9存活，芜菁收获12，灌溉用水4−3=1，现金1295守恒。

九人链仍是正常菜单脚本规则回归，`realModelExecuted:false`；模型自主和长期全人口生存验收均保持未知。未读取密钥/真实存档、调用模型/浏览器/npm或提交推送。
