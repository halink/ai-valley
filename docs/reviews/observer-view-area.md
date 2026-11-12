# UI 可视区取景：独立审查

日期：2026-11-12。只检查展示与相机状态，不读取 `.env`、真实存档或调用模型。

## 审查结论

- Phaser 3.90 的 `centerOn` 与 `preRender` 都会裁限相机。偏移按完整相机中心及 zoom 计算；测试包含四边界的真实 clamp 公式。外扩仅为展示相机边距，不修改地图格数。
- 由实际 DOM 矩形求剩余视区；窄于48px的碎片不作为可用观察区。完全遮挡用零尺寸标记暂停取景，非恢复全屏中点。
- 手动拖拽、无选择和未知室内位置不应被布局更新强制跟随。相机布局更新不执行 `watchTile`，不改变世界或房间。
- 2.5D 的 culling 使用偏移后的最终相机，并保留独立展示边界；不能先按旧相机裁剪再单独平移成图。
- DOM 观察器只读尺寸并更新相机；自身文字写入有同值检查，观察的 class 与 ARIA 更新分离，没有发现必然自触发循环。此项为源码审查，不是浏览器运行证据。

## 独立发现并修复

1. 点击空地后，在 MutationObserver 更新 UI 身份前，旧居民身份可能导致相机跳回。改为仅在此次 pick 的实际居民选择与当前UI身份一致时立即取景，其余等UI选择更新。
2. 选中居民坐标只检测下界，遗漏地图上界；另区域旅途可能带旧的谷内位置。已补上界及 `regionalLocation` 排除，不把它们作精确本地取景目标。
3. 等距 zoom 清理偏移锚点后未立即重新取景。已在非手动观察/有效跟随条件下重新取景，避免等待下一次快照。
4. 初版等距中心测试将 `centerPoint` 反投影后再投影，是恒等关系，不能证明居民位置。新增独立测试直接投影居民渲染锚点；主测试已同步改为真实居民锚点断言。

## 独立回归

`node --import tsx --test tests/observer-view-area-review.test.ts`

**5/5 通过**：点击空地异步选择、上界与区域旅途、无效/屏外遮挡与不可用碎片、室内手拖后resize、等距跟随缩放后的真实居民锚点。

这里只使用 Scene/DOM 替身及数值投影。没有真实浏览器截图、GPU、触控或可访问性树验收；没有验证长期运行稳定性。

## 可复现定向命令

最终代码相关集（限制并发以避免检查进程争用内存）：

```sh
node --import tsx --test --test-concurrency=2 --test-timeout=120000 tests/observer-view-area*.test.ts tests/storybook-ui-*.test.ts tests/client-*.test.ts tests/panel-positions*.test.ts tests/observer-navigation*.test.ts tests/resident-follow.test.ts tests/resident-status.test.ts tests/history-reader.test.ts tests/history-reading*.test.ts tests/isometric*.test.ts
npm run check
git diff --check
```

构建包含在 `client-bundle.test.ts` 中，明确禁用 Vite 环境文件加载。日志位于忽略的 `output/ui-viewarea-final.log` 与 `output/ui-viewarea-check.log`。最初高并发尝试出现类型检查被系统 `Killed`、单文件超过30秒和新增观察器API精确键值预期未更新，不能作为通过证据；补预期后采用上面的低并发集重验。

## 完成后的结果

- 上述低并发相关集 **414/414 通过**（146秒），失败/取消/跳过均0；包含隔离 Vite 生产构建。
- 最后补齐显式地图导航不回跳与区域旅途卡片说明后，重新运行 `observer-view-area*`、`storybook-ui-*`、`resident-follow`、`isometric-follow-route`、`isometric-ui-viewport`，**73/73 通过**；日志 `output/ui-viewarea-postreview.log`。
- 单独重跑 `npm run check` 返回0；`git diff --check` 通过。
- 2.5D 定向集 **79/79 通过**。旧的失败/资源受限尝试未掩盖为通过；最终结果来自后续明确结束的运行。
- 未读取 `.env`，追踪配置仍只有 `.env.example`。未更改世界模型、后端或真实存档；未push，未声称真实浏览器或真实模型验收。

## 后续独立复验：显式导航优先

完整性审查又复现：2.5D选中居民但不跟随时，从档案定位坐标，面板关闭后会被旧居民卡重新取景。本地 `f45cc97` 因此不能视为完成导航验收；尚未推送。

修复将所有显式观察导航（坐标、建筑、动物、室内进出、区域、工程、全图、商站、回家和停止跟随）统一记录为手动意图，仍由主入口执行原跟随/选择/房间路由。2D对清选择、建筑、退出室内及明确停止跟随也保留该意图。再次选中或明确跟随才恢复居民取景；普通打开档案不取消有效跟随。

进一步复验发现室内纯抽屉变化重复 resize，会因使用新可见中心重算与裁限镜头而跳动。模型现保存固定展示偏移；手动模式在画布像素尺寸不变时不重新裁限，后续 tick、快照和 rebuild 仍保留实际镜头。真正 resize 保留全屏中央世界坐标并遵循边界，不回旧居民。

新增测试曾误将 `centerPoint` 当成恒定世界点，但它定义为“当前可见区中心的逆投影”，布局变化后自然改变。现改用实际相机、固定坐标/建筑锚点投影及真实resize前后的全屏中央世界坐标；没有仅删除失败断言。覆盖坐标、建筑、动物、回家、室内进出和区域/工程/全图/商站回退，并复验抽屉变化后的 tick、快照、缩放与跟随恢复。

### 导航修复最终复验

- 使用上方低并发命令的扩大相关集 **420/420 通过**（146秒），失败、取消、跳过均0，日志 `output/ui-navigation-final.log`。包含隔离生产构建。
- 完整性审查者独立复验修复相关 **25/25 通过**，并确认坐标与室内真实相机在布局变更及后续rebuild保持，不再回旧居民。
- 修后独立 `npm run check` 返回0，日志副本 `output/ui-navigation-check.log`；`git diff --check` 通过。其间发现的测试TS控制流窄化已改为读取导航当前状态，保留运行时“再次跟随成功”断言。
- 两项导航阻断已关闭。真实浏览器、GPU、触控和可访问性树仍未验收，不把本次模拟回归描述成视觉验收。
