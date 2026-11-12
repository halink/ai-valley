# 共屋几何纵切片独立审查

审查日期：2026-11-12。范围是独立开发页 `storybook-slice.html`，不是正式绘本美术或运行样板验收。

## 结论

离线几何、实际 PNG/manifest 一致性与默认生产构建隔离通过。发现的 bfcache 恢复缺口已由实现者修复并复核。尚未进行真实浏览器验收，不能将这份结果表述为手机布局、Canvas 实显、浏览器生命周期或美学验收通过。

已阅读 `docs/design/storybook-valley.md`，实际查看全景概念 PNG、美术规范板 PNG 和新图集 PNG。新图集是明确标注的平面色块几何标尺，与参考图的手绘材质、人物塑造、自然环境复杂度差距明显。这不是失败素材换名或正式美术替代品；网页文字正确限定了用途。参考板本身的四向、家具与人物关系也仍不能直接充当运行事实。

## 独立检查

新增 `tests/storybook-slice-review.test.ts`，不修改实现。

- 对硬编码期望值校验 8×6 地面四角 `(112,112)/(240,176)/(144,224)/(16,160)`，两轴斜率绝对值均为 0.5。
- 校验所有形状包围范围均在未裁切画布内。门洞净高 70，成人高 56，比例 1.25。
- 排除半透明脚下阴影后，分别量出成人 56、少年 47.6 的解剖包围高度；椭圆头高分别为总高除以 4.5 和 4.2。这个结果不代表角色年龄、外观身份或四向动作合格。
- 解码磁盘实际 RGBA PNG，验证 1728×672、2x 密度、SHA-256 和离线重新生成的逐字节一致性。五个 frame 不重叠，每项含非空像素，frame 外区域透明。单边不超过 2048。
- 三层共屋同为 288×256 逻辑画布，顶左位置一致为 `(-112,-112)`，世界锚点同为 `(4,6)`。两个人体标尺脚点与各站位吻合。
- 穷举三站位、屋顶开关及透视开关，检查屋后人体位于主体之前，透视只影响该站位建筑主体/屋顶。此显式排序仅覆盖这些静态样例，不证明通用占地排序或真实门槛移动。
- 真实执行 Vite 默认正式入口 `index.html` 的生产模块图构建（`write:false`），检查全部输出文件名及 chunk 模块图，不包含 `storybook-slice` 或 `geometry-slice`。没有改写 dist。最终构建测试显式设置 `configFile:false, envFile:false, envDir:false, root:repo, base:'/ai-town/'`，禁用配置及环境文件加载，不运行普通 `npm run build`。DEV 判定是开发隔离，不是访问控制或私密内容保护。
- 入口不接入世界快照、模拟服务或居民状态，单次 atlas fetch 为本地资源且不带凭据。无动画计时器、WebSocket、EventSource 或本地存档读写。
- 旧失败文件 `output/storybook-art-slice-v1` 下六张 PNG 仍存在，未被本次审查改动，也未加载进校准页。

## 生命周期发现与修复

初版 `pagehide` 无条件调用 dispose，清空两个 canvas 并禁用控件。若页面进入 bfcache，浏览器返回会恢复已销毁 DOM，而不会重新执行模块，导致空白且不可操作。已即时报告实现者。

复核最新代码：`pagehide(event)` 仅在 `!event.persisted` 时调用 dispose，保留 bfcache 页面；取消处理在 fetch 前注册，HMR 仍显式清理，异步纹理准备后检查 disposed，dispose 幂等且移除监听。独立测试记录这些源级约束。新增复核：首次加载失败、后续 change/resize 绘制异常，以及显示画布 contextlost 均进入统一 fail 路径，设置 alert 并调用幂等 dispose；后续绘制会受 disposed 守卫拦截，所有已注册监听被移除，控件禁用且画布释放。第八项独立源码约束覆盖这些连接，不冒充真实 Canvas 错误注入。真正的前进/后退、加载中导航、上下文丢失和 HMR 操作仍须浏览器复测。

## 验证与剩余边界

运行：`node --import tsx --test tests/storybook-slice-review.test.ts` 与 `npm run check`。独立测试 8/8 通过，类型检查通过；隔离修订后的完整 TAP 输出见 `output/storybook-geometry-slice/review-final-v2.tap`。测试含生产模块图构建，通常需要十余秒，不运行服务或真实模型。

环境已报告浏览器启动 `socket() Operation not permitted`。本审查未重试启动、未变更系统安全设置，也未将离线渲染或 API mock 当作浏览器证据。

仍需在可用浏览器检查：1440×900、1280×720、390×844；不同 DPR 与三档缩放下真实显示；键盘、滚动、长文字和状态播报；网络失败；加载中离开；bfcache 返回；HMR。正式美术、实际居民绑定、室内布局、真实运动遮挡、点击、运行性能和完整观察语义不在此纵切片完成范围内。


## 提交复核补充

后续独立提交审查实际重跑全部绘本专项 **350/350**，含本审查 8 项；类型检查及隔离服务端编译通过。8×6 地面四角、两轴 ±0.5 斜率、三层同点注册、门槛 `(4,6)`、源脚点 `(160,384)`、人物头身与门高比及完整 PNG 确定性均复核。没有改动生产源码、PNG、manifest 或已完成测试，仅在验证完成后补本报告与实现说明。

验证环境为 Linux / Node 24.22.1，清空继承环境、项目内临时路径和原离线守卫。第一次完整绘本运行 349 通过、1 失败，Vite 的错误为 `safeRealpathSync is not a function`：守卫包装 `fs.realpathSync` 后未保留其 `.native` 属性。输出目录的兼容适配仅把 `.native` 指回同一个受保护函数，并检查敏感路径与网络拒绝仍有效，随后 350 项全部通过；没有给 Vite 暴露未保护的原生 realpath。原失败保存为 `storybook-original-guard-failure.log`。

额外邻近 26 项在此严格守卫下只通过 21 项。四项在 `runtime/dev-preview` 临时位置的元数据检查处被守卫阻止，一项因 fetch 不可重定义而无法安装旧测试 mock；属于本次追加运行的限制，失败保留，未读取真实存档、未弱化守卫重跑，也不把实现者既有 26/26 结果替代本轮结果。

独立入口分别显式以 DEV=true/false 做内存构建。DEV=true 的 11 模块图不含 server、world 或原游戏入口；DEV=false 输出不含图集挂载逻辑。强行指定独立 HTML 为生产输入仍可输出静态 HTML、CSS 和 PNG，故不能把 DEV 判断当保密边界。正常默认生产图中完全不含纵切片模块、资源或页面。

提交审查还以实际入口代码、惰性依赖和 DOM/Canvas 模拟验证 8 个生命周期场景，结果均通过：DEV=false 不查询 DOM、不 fetch；没有匹配根节点时惰性；成功挂载与 DPR 上限；bfcache 保留及普通导航/HMR 幂等释放；加载中离开；fetch 失败；change/resize 绘制异常；contextlost 清理。场景分组详见 `lifecycle-mock.json`，这些模拟不替代实际浏览器、Canvas 或历史缓存行为测试。

最终证据位于 `output/storybook-slice-commit-review/`：`storybook-compatible.log`、`adjacent.log`、`typecheck.log`、`server-build.log`、`build-isolation.json`、`lifecycle-mock.json` 及各执行脚本。16 项旧探索 hash 未变，无密钥、真实存档或 output 加入提交；浏览器启动未重试，未 push。
