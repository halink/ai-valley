# 正式可选 2.5D 入口独立审查

日期：2026-11-10。基线为 `388c230c81af42b42cc7813e9ddb36c99bb5e369`，审查其后的未提交客户端入口候选。范围为正式入口、共享安装器、HUD 样式、只读适配器及受影响测试。审查没有改业务代码或仓库测试，没有提交。独立反例仅写入 `output/review-formal-entry/`。

## 结论

**报告的四项问题均已修复并独立复验，当前审查范围没有剩余阻断。最终定向 75/75、10 组独立组合/故障反例、18 组最终构建 CSS 层叠/几何检查全部通过。** 这是允许保留默认 2D 的可选试用入口结论，不是切换正式默认、浏览器/GPU/触控或全量验收。

## 发现与修复

1. **常驻试用托盘遮住原状态和房间导航。** 初版固定 top106/112 与原状态条、手机房间 banner 重叠；即使默认 2D 也存在。修复将状态、房间导航、试用托盘放入同一正常流 HUD，纵向 8px 间隔、子项不收缩、超高区域可滚动，不隐藏状态内容。
2. **默认 2D 的“回到住宅”看似可用但没有动作。** 初版按钮未禁用，而点击只在 2.5D active 时执行。现在默认/退出/异常时禁用，启用 2.5D 后才开启。
3. **安装中途失败留下半安装实例。** 独立合成适配器让第三项 subscribeFollow 在取得订阅前抛错：初版主入口 catch 后仍残留 DOM、文档监听、前两订阅；重试再卸载也不能清除第一次残留。安装器现用逆序资源清理栈，失败回滚，单个清理失败不阻止后续清理。该反例是故障注入，并非声称正常真实适配器会抛错。
4. **共享 HUD 修复后，手机长状态会遮住右上世界版本按钮。** `.observer-hud > .world-state` 的 max-width:100% 比原手机专属预留宽度优先，状态与 sample-badge 在同一 top80，HUD 层级更高。390px 宽时长状态可到 x374，badge 也右止 x374。现以手机专属、同特异性的 `max-width:min(100%,calc(100vw - 125px))` 恢复留白，且不超过 HUD 本身。独立解析最终构建 CSS，而非只匹配源码字符串：320/390/480/600/700/701/844/1280/1920 宽 × 390/844 高共 18 组层叠正确。390px 时长状态右止 x281，80px badge 左始 x294，保留 13px；桌面不采用手机限制。这是源码/产物几何核对，不是浏览器截图结论。

## 已独立核对的行为

- 真实 `main.ts` 和真实 `mountIsometricObserver` 同时执行，而非只替换安装器：默认 2D、一次初始 GET、一条 SSE；连续 12 次重复安装和后续快照更新仍共用同一安装句柄、原接收对象和传输，不产生索引或动画定时器。
- main 继续独占原 world/events 传输、合并及重连。共享安装器没有网络所有者、模拟时钟控制、计划提交、模型/存档写入或开发测试驱动。`observer-map.ts` 只有呈现与观察路由能力，没有模拟控制方法。既有历史读取不应误算为重复世界传输。
- 16 轮启用/退出中计时器始终至多一个，Escape 解除覆盖、指针捕获和计时器。次指针及非左键不会夺取拖动；取消与窗口变化结束捕获。隐藏、断线时显示相位冻结。触摸缩放仍依赖原有按钮，不宣称支持双指缩放。
- 初始 Canvas2D 获取抛错、离屏静态 Canvas 返回 null、帧绘制 setTransform 抛错、pointer capture 抛错：均保留/恢复原 2D，显示明确原因并禁用试用；销毁后无订阅和事件残留。坏快照不会污染此前有效模型，下一有效快照仅恢复可重试，不自动切换。
- 晚期订阅失败、文档监听安装中途失败均回滚。三个 unsubscribe 全部在移除订阅后抛错时，仍清除所有其他订阅、DOM、文档/窗口/画布/托盘监听、覆盖和计时器。旧句柄不能复活，重新安装得到新实例。无法替第三方释放其“先注册再抛错且未返回解除函数”的不可见资源，当前真实适配器不采用该行为。
- 既有真实 main/ValleyScene/ResidentFollow 路由测试通过，保留普通 2D、住宅往返、临时 resolver 解除后按旧规则重验、世界替换、未知/死亡/出谷停止等边界。全图、区域、工程、贸易站和不支持的房间仍明确降级，不把未支持内容伪装完成。
- 所有独立反例前后的合成路线快照 SHA-256 保持 `ca046739cff25834bdd33f6a546db42f2c26e272a8b8e2a8ea6f0b7ccff5e608`，没有写回坐标、暂停标志或世界状态。

## 独立验证

最终冻结后定向串行执行的 9 个文件共 75/75 通过，0 失败、取消或跳过：

- `tests/isometric-formal-entry.test.ts`
- `tests/isometric-entry-layout.test.ts`
- `tests/isometric-observer.test.ts`
- `tests/isometric-observer-review.test.ts`
- `tests/isometric-interior-review.test.ts`
- `tests/isometric-follow-route.test.ts`
- `tests/client-loading.test.ts`
- `tests/client-loading-review.test.ts`
- `tests/history-reading-review.test.ts`

命令采用 `TMPDIR="$PWD/output/review-tools" node --import tsx --test --test-concurrency=1` 加上述文件。最终日志 `output/review-formal-entry/final-independent.log`；此前 74 项只是中间轮次。独立故障/组合脚本 `output/review-formal-entry/independent.ts`，10 组结果为 `independent-results.json`，全部通过。实际构建 CSS 的独立检查脚本为 `output/review-formal-entry/css-cascade.mjs`，日志为 `css-cascade.log`。`git diff --check` 通过。

## 包体与验收边界

- 等距模块是静态导入，随主包加载，不是按点击懒加载。默认 2D 没有等距索引或动画，但存在下载/解析和订阅成本；覆盖时原场景仍接收并准备快照，不是消除了双场景 CPU。
- 独立核对作者构建的 120 模块清单，未包含 scripts、tests、server 或 development-preview。构建不是本审查重新运行；作者使用 configFile:false、envFile:false，未加载环境文件。
- 对照已核实与基线客户端一致的前批构建，主 JS 从 1,438,064 B 增至 1,525,188 B，增加 87,124 B（6.0584%）。同用 gzip level9 得到 413,470 B 与 444,169 B，增加 30,699 B。与 Vite 输出的 gzip 数字压缩参数不同，不混为同一测量。超过 500 kB 的分包警告仍然存在。
- 本审查没有浏览器、GPU、真实触控、实时服务、真实网络生命周期或真实存档证据，也未运行全量套件/完整服务构建。DOM/Canvas/传输替身和 CSS 几何检查不能替代浏览器字体、滚动、焦点、设备丢失与实际触控验收。没有重试被拒的浏览器 IPC，也未使用绕过路径。

## 冻结版本与证据归属

独立逐项检查作者的 18 文件清单 `output/test-tmp/isometric-formal-entry/frozen-source.sha256`，全部匹配；清单 SHA-256 为 `09b016fe37562bb1e683026b140835ec28add0d1c7482f9cd1e316d4a5ff8a05`。本审查仅新增本独立文档，未修改上述清单中的文件。关键业务源码如下：

- `src/client/development-preview.css`: `bb6ccce86520f84feeadb590556cb462c6055e141894dcc85cce3507c03d876a`
- `src/client/development-preview.ts`: `d5a347f0bb1849239d0fc846973a7545c27540eedf06270700a6a336770a9c01`
- `src/client/isometric-preview.ts`: `6d8d032cd3dbf28ffd8507ff65dd7e4c09fe3a2da94919dff03bd18c97eb3bb6`
- `src/client/main.ts`: `a85ed9da4120b171937044bbf6e51f349d35c205cb2592c7c75104c1cb4c59c5`
- `src/client/isometric-observer.css`: `9bd2214be2a0e55c300abc90819ef45547b8fa22828f653732b459c535c2a88e`
- `src/client/isometric-observer.ts`: `816c71b9d95a6d49efa03e605935303e3c7d5bdfb8497ba943b59fc20f00e3e9`
- `src/client/observer-map.ts`: `4c90cb2bab5413443d4718000ae46aca2cd508b4778a4070fb19c25f3be90a62`

作者最终报告的受影响定向套件为 223/223、`tsc --noEmit` 及显式关闭环境文件的 Vite 生产构建通过。这些是作者运行结果，独立测试数量为上述 75 项，不将二者相加或冒充全量。作者日志 `output/test-tmp/isometric-formal-entry/combined-final.log`，实际模块清单 `bundle-modules.json`。

最终实际主 JS `index-B9SOGxpD.js` SHA-256 为 `956a9ec9dec917a09ef99b0a4cf7fc72e2b5a611c4b1246bf334de599301eac0`；CSS `index-DA4t3v4N.css` 为 `1b73bab27e9f89a63c283d9aa020828fc935dbf7cfbe38c994302fd50730ece4`。产物位于上述构建目录的 `dist/assets/`。
