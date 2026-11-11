# 跨观察入口保留阅读位置

本项接续[年表阅读保持](history-reading.md)，修复年表中途打开人物生平，再从入口回到年表时滚动归零。新事件仍只提示，世界继续运行。

## 返回规则

- 在离开或关闭面板前保存该视图的阅读位置。返回年表、人物生平、交谈或其他已保留的观察视图时恢复它自己的位置，不套用刚离开的面板位置。
- 身份由世界、面板及相应人物、动物、交谈或名单范围组成。档案还核对当前阅读内容版本。明确改筛选、换页、换人物或成功回到最新会开始新位置；旧位置不能覆盖新结果。
- 滚动至顶部也是有效选择，之后返回仍保持顶部。关闭再打开与直接点击另一入口返回采用同一规则。
- 已有事件锚点按事件身份和可见偏移恢复；供水详情展开状态随该位置保存。没有可见事件时使用像素位置。缓存只保存值，不保留旧DOM节点，最多40个视图。
- 人物摘要重新加载时，页面可能暂时变短。返回位置被暂时夹到顶部附近后，原目标会保留到内容加载完成。加载期间主动滚动、滚轮、触摸、指针操作或阅读导航键会取消这一延迟恢复，避免完成时抢回读者位置。
- 晚到的后台摘要或历史请求只能促使当前视图重绘，不能重新打开已离开的面板或应用另一视图的位置。隐藏时完成的明确“回到最新”会使旧阅读版本失效；失败则保留原版本的位置。
- 世界替换清空所有返回位置和延迟恢复，不因新世界复用人物或事件身份而错误恢复。

## 边界

这是同一次页面会话内的返回位置，不新增浏览器历史栈、返回按钮、跨页面刷新书签或永久存储。缓存淘汰后从顶部开始。

档案仍使用原有每类一个 `HistoryReader`。例如从人物A切到B，再重新取A的记录时，A属于新内容版本，会保守归顶；不为了恢复旧像素而把它套到另一批记录。已保留内容版本内的年表与当前人物生平往返则分别恢复。

人物摘要、名单和其他实时概览不是完整历史快照。页面内容变化、浏览器尺寸变化或目标事件不存在时只能按现有锚点与可用像素范围恢复，不宣称完整视觉或像素一致性。

本项不改变居民知识、权限、模拟时钟、服务器、模型或真实存档。

## 离线验证

`tests/panel-positions.test.ts` 包含真实转译入口的成功加载、双向返回、关闭/重新打开、主动归顶、切换人物、筛选和翻页、摘要晚到、高度夹断、用户接管、隐藏请求成功/失败、世界替换，以及值式缓存边界。

原 `tests/history-reading.test.ts` 的已确认失败入口已改为成功返回600位置的回归。独立反例和最终结果见[审查记录](../reviews/panel-positions.md)。

```sh
node --import tsx --test tests/panel-positions.test.ts tests/panel-positions-review.test.ts tests/history-reading.test.ts tests/history-reading-review.test.ts tests/history-reader.test.ts tests/history-pages.test.ts tests/water-history.test.ts tests/animal-history.test.ts tests/client-loading.test.ts tests/client-loading-review.test.ts tests/resident-follow.test.ts tests/resident-follow-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({configFile:false,envFile:false,base:'/ai-town/',build:{outDir:'dist'}})"
```

只使用离线合成世界、模拟请求、DOM尺寸夹具和隔离测试数据库；没有运行浏览器或模型，没有读取密钥或真实存档。真实浏览器桌面/手机布局、触屏和滚动视觉验收仍未完成，离线入口执行不能替代这些验收。

## 本轮结果

2026-11-08：上述97条离线关联测试全部通过，其中本轮主测试10条、独立反例6条。差异空白检查通过，未执行全项目测试。独立复核未发现本轮阻断性反例。

类型检查通过 `npm run check` 启动后，仅取得启动信息；后续取结果被执行审核拒绝，理由涉及禁止的npm registry网络访问。没有实际网络日志可验证该理由，进程状态和完成结果保持未知，不宣称类型检查通过。未重试或改用其他命令绕过；后续类型检查及服务端/Vite构建本轮未执行。上面的类型与构建命令是复现说明，不是本轮成功证据。
