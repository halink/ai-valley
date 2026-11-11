# 共屋室内与普通烹饪独立审查

基线：`8d1afc1` 上的未提交候选；2026-11-11。只审查本批客户端扩展、合成引擎路线与测试。不修改客户端、main、赠食候选，不暂存或提交。

## 结论

在本次源码、CPU、DOM/Canvas/Phaser替身范围内，没有发现阻止这项**可选2.5D**扩展的已确认问题。正式默认仍应为原2D。不能据此宣称完整2.5D、浏览器验收或全仓回归完成。

新增独立测试 `tests/isometric-lodge-review.test.ts`：**8/8通过**。与 `isometric-lodge.test.ts`、`isometric-interior.test.ts`、`isometric-interior-review.test.ts` 合跑：**44/44通过**，0失败、取消、跳过。合跑包含修正后朝厨房方向的手臂绘制。

## 已验证范围

- 使用 `createFrontierWorld(5401)` 与明确提交的普通cook/move计划，由 `submitPlan`/`stepWorld` 产生共屋进入、室内走位、厨房工时、完成与离开。没有模型自主选择证据，也没有打开真实存档。路线只主动解除合成时钟暂停，不植入厨房坐标、库存或完成状态。
- 原 `personVisual` 继续返回work；新手势只在真实home/lodge厨房、精确roomAt、建筑门与活动target一致、剩余工时有效、无未完成路径且不是退出时采用。不会把绘图坐标重定位当作活动已到场的证据。未到达、已完成、不合条件和未知姿态保留原语义或明确fallback。
- 共屋直接复用导航的 `roomLayout`。床、桌、厨房的身份与坐标一致；care/bodyBay属于导航目标，不捏造成额外设施。其它已记录但未实现外观的对象仍走原marker/未知位置机制。
- 冻结快照不会被渲染修改；动画不消费或生产库存。图形与说明不主张已有火焰、锅、食材、成品或已结算。路线测试对比到达前、工时中及完成后的库存，生产行为来自引擎而非画图。
- 独立适配器运行实际main receive与原click处理源码、实际ValleyScene方法和共享observer。验证连续跟随穿过户外、共屋、cook、完成、离开；边界切换取消旧坐标空间的拖动。手动进入、退出、建筑定位仍走原路由。
- 初始保持2D；2D交还保留当前房间，室内局部中心不交给世界镜头。未知位置与未绘制婴儿姿态会明确返回原2D，并保留跟随身份。原室内review还覆盖非支持房间、睡眠、其它未知对象与相机边界。
- 点选使用实际绘制相机，能命中烹饪居民且保留person ID；家具点选由lodge套件核对。坏快照接受是原子操作；旧房间快照不能继续动画；替换世界清除旧跟随和房间身份。
- 暂停、断线、页面隐藏冻结显示相位；**已有interval仍保留，只是tick不推进**，不应写成停止/移除了计时器。切回2D或dispose才清理计时器。
- 240位合成烹饪居民压力测试验证对象、marks与地板缓存预算；打乱居民数组后确定性对象选择保持；动画不重建pose、bucket或floor。新snapshot仍需扫描源集合，不代表全页CPU成本已消除。

## 图像检查与限制

独立查看了 `output/isometric-lodge-cooking/synthetic-lodge-cook-1.png` 的实际像素：人物在厨房前，手朝厨房侧，未出现火、锅或食物。图片是父任务CPU栅格脚本的合成输出，不是浏览器截图，也不证明真实页面CSS、字体、触摸、Phaser/GPU或帧率表现。

未执行联网、模型、正式服务、真实存档、浏览器、bwrap或IPC尝试。未完成真实浏览器/触控往返、真实SSE断线重连、全页CPU/GPU性能测量、生产构建或全量套件。本批应继续作为有明确fallback的可选观察入口。

## 可复现命令

```sh
mkdir -p output/test-tmp/lodge-review
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/lodge-review" TMPDIR="$PWD/output/test-tmp/lodge-review" TSX_DISABLE_CACHE=1 node --import ./scripts/acceptance-offline-guard.mjs --import tsx --test tests/isometric-lodge-review.test.ts tests/isometric-lodge.test.ts tests/isometric-interior-review.test.ts tests/isometric-interior.test.ts
```

实际日志：`output/test-tmp/lodge-review/independent.log`（8项）与 `combined.log`（44项）。离线guard、空环境及隔离HOME/TMPDIR用于本批测试；没有绕过任何拒绝。

另以相同隔离环境运行 `node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc --noEmit`，退出码0；日志 `output/test-tmp/lodge-review/typecheck.log` 为空。类型检查包含当前共享工作树，不等于生产构建或全量运行测试。
