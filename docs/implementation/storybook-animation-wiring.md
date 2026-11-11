# 绘本贴图原型的有限动画接线

后续[开发专用诊断预览](storybook-development-preview.md)仅在已有开发服务器的显式 URL 开关与用户点击后调用本接口。以下“不接默认入口”描述的是本批动画桥基线；正式默认2D仍未改变，也没有正式美术或浏览器验收。

基线为本地 `c17f0e2`。本批把已提交的静态贴图原型和动画契约接成**显式开发/测试接口**，不是正式默认视图。依据是现有绘本方案文字；两张用户参考 PNG 仍未取得并检查像素，没有据此制作正式人物、建筑或最终美术。

默认 `main`、`development-preview`、原 2D、旧等距视图、唯一观察 feed、ObserverMap 接口与世界规则均未改。没有新增 GET、SSE、Game、Scene、RAF、定时器、模型调用、存档读写或完成提示。原五项设计文本、五项赠食候选不属本批，没有修改、暂存、提交或推送。

## 真实数据与诊断素材分开

- `storybook-synthetic-animation-atlas.ts` 和三份 `assets/storybook/synthetic-animation-prototype.*` 是生成器制作的合成技术素材。384×544 RGBA PNG，保留原地表、位置标记、路线箭头与共屋三层的像素/几何；新增 48 个带 S 标记的诊断箭头帧：四向待机 2 帧、行走 6 帧、采摘 4 帧。它不是人体，不代表成人、少年、衣装、头像或规范板质感，也不是方案要求的双角色 80 帧交付。
- 每帧画布 32×40、脚点 `(16,40)`，世界占地仍为 1×1、地面锚点 `(0.5,0.5)`。四向分别绘制箭头而不是镜像；不同源矩形、真实像素、独立 cel 标记与统一脚边在离线测试中分别验证。
- PNG、内嵌字节、JSON 元数据和 SHA256 一致。测试实际检查 PNG CRC、解压 IDAT 并核对 RGBA，不把一个返回预期像素的假 decoder 当作图像校验。浏览器调用仍应使用原 `prepareStorybookAtlas` 默认 decoder；未在本次运行真实浏览器。
- 默认 `bindings` 为空。`bindSyntheticAnimationResident(residentId)` 只显式绑定一个原居民 ID 到诊断箭头，不按数组顺序、姓名、性别或职业猜测，不写回 appearance，不宣称这就是该居民的外观。
- 图集由仓库生成器制作，许可证声明为本仓库 MIT。没有使用或裁切尚缺的两张用户参考 PNG。

生成命令是 `node --import tsx scripts/generate-storybook-synthetic-animation-atlas.mjs`。生成器只写本批 PNG、两份 JSON 和嵌入模块，不运行世界。完全相同输入的再次生成结果已核对一致。

## 显式调用方式

调用方必须已有一个准备完成的专用 Phaser 3.90 Scene，以及原观察入口提供的 ObserverMap。以下仅是开发接线示例，不是默认客户端改动，也不创建新的观察连接：

```ts
import {
  syntheticAnimationManifest, syntheticAnimationPin,
  syntheticAnimationAtlasBytes, bindSyntheticAnimationResident,
} from './storybook-synthetic-animation-atlas.js';
import {prepareStorybookAtlas} from './storybook-texture.js';
import {mountStorybookAnimationPrototype} from './storybook-animation-phaser.js';

// observedResidentId is explicitly chosen from the already accepted observation snapshot.
const bundle = bindSyntheticAnimationResident(observedResidentId);
const texture = await prepareStorybookAtlas(
  syntheticAnimationManifest, syntheticAnimationPin, syntheticAnimationAtlasBytes(),
);
// existingDedicatedScene and existingObserverMap are owned by the caller.
const view = mountStorybookAnimationPrototype(
  existingDedicatedScene, existingObserverMap, texture, bundle,
  {x: 0, y: 0, width: 1280, height: 720},
);
view.activate();
// view.setWindow({x: ..., y: ..., width: 24, height: 24});
// view.plan exposes drawing, fallback and scope diagnostics.
// view.playback exposes the latest sampled action/phase/freeze reasons.
// view.deactivate() clears this surface without covering/destroying the original view.
// view.dispose() releases every resource owned by this prototype.
```

`mountStorybookPrototype` 仍是原静态接口，保留“无动画”的原说明。新增 `mountStorybookAnimationPrototype` 才使用动画说明与播放器。相同 Scene/Observer/模式重复 mount 返回原句柄，不重复订阅；不同模式或观察源拒绝占用。换图集、身份绑定、environment 或 viewport 时先 dispose 再 mount，不把重复 mount 当作热更配置。

Scene 仍必须只有一台无平移、旋转或缩放的相机；使用原型窗口与内部 fit 取景。安装、绘制、点击及 preupdate 都保持原相机边界。相机变化清空本原型与点击目标，原视图不受接管。没有实现自动跟随、揭顶室内或原视图切换 UI。

## 接线与冻结

`createStorybookAnimatedObserver` 只订阅原 ObserverMap 的快照/连接和房间通知。播放器接收原 feed 已接受的不可变快照，不读取事件推演成果。计划复用原地表、共屋、占地排序、对象预算和透明像素拾取，但人物位置、动作与回退以播放器记录为准，不能先画旧路线箭头再覆盖为动画。

- 计划检查 world ID、revision、完整唯一居民集合与空间 ID。动画帧必须对应已安装图集的真实方向帧。整个 atlas manifest 必须与 bundle 一致，不能仅凭同一哈希字段混用改过的脚点/矩形。这些检查用于可信内部调用链，不是任意 JavaScript 对象的安全沙箱。
- 行走只用已确认相邻路径和 travelProgress。显示时钟不会移动脚点；阻路回退采用播放器确认的原位，不保留旧静态路径插值。停步、换向、异常姿态和未知位置直接更新，不等完整循环。
- 仅真实有量灌木旁的 active gather 才显示 pick。等待、其他工作、伤病、睡眠、携运、未知朝向/身份等沿用原契约的 marker/hidden 回退；不生成工具、产量或劳动成果。
- 世界停表来自 accepted snapshot；连接状态来自同一源的状态回调。页面 `visibilitychange`、系统减少动态 `matchMedia` change 直接采样，不等待下一次快照或 Scene tick，因此后台停渲染仍能冻结。
- 时间统一来自注入 environment 的单调 `now()`；浏览器适配使用 `performance.now()`。正常刷新仅借用调用方现有 Scene 的 `preupdate`，没有第二条循环。恢复首段不累计；超过 250 ms 的间隔不补播。暂停、断线、隐藏和减少动态分别保留原因，不相互冒充。
- 显式 deactivate 也冻结。播放器新增可选 viewBounds，按与绘制相同的半开窗口判断脚点；屏外居民保持相位，重新入窗第一段不补播。显示签名包括窗口本身、冻结原因和窗内帧；窗外相位不会触发重画，自动窗口平移即使没有换帧也会重建正确计划。

室内继续失败关闭并提示原视图，不把室内居民放到户外门口；回到户外、换 world、丢失快照后重新建立相位/朝向。尚未提供共屋室内贴图、家具或室内动画画面。

## 生命周期与边界

共享 Phaser surface 按 draw key 复用 Image，只在帧变化时 setTexture，不每帧重新分配地表和对象。对象离开计划即销毁。安装时复制像素证据，防止调用方修改 RGBA 后让显示与透明拾取不一致。每次帧选择同时更新计划与可见纹理，点击仍回传原 resident/building ID。

所有 texture、Image/container、文字、pointer、preupdate、shutdown/destroy、观察订阅、visibility/media 监听均由句柄释放。dispose 幂等，迟到回调不能复活对象；晚期注册失败释放之前已取得的资源。绘制异常停用可选原型并清空可选点击目标，不抛出破坏原 feed。没有销毁调用方 Scene/Game、调用 cover 或替换 follow resolver。

保留原每边最多 32 格、最多 192 个对象、512 居民/8192 建筑记录约束；居民优先准入。占地重叠与排序环仍有诊断，不承诺遮挡视觉正确。地面尚未实现生产级块缓存；局部计划重建与对象复用不等于大地图性能达标。

## 验证与未验收

主测包括四向六帧逐帧纹理/脚点/alpha 拾取、各冻结原因无 Scene tick 的即时通知、停步/改向、坏路径/伤病/睡眠、未知位置、室内/换世界/空快照、非法时钟与边界、晚期监听失败、draw 错误、屏外相位和恢复。实际合成 submitPlan → stepWorld → 到场 gather → 真实结算逐步核对只读世界，不把预设输入称为自主生活。

Mock Phaser 测试覆盖 1440×900、1280×720、390×844 的接口参数、图像复用、frame 更新、拾取及销毁；mock 浏览器事件覆盖页面可见性和减少动态监听。这里的三个尺寸不是实际浏览器版式、中文可读性或帧率验收。

独立审查发现“自动窗口变动但 cel 未变时缓存签名漏掉窗口”的问题，原反例先失败，再把 viewBounds 纳入签名后通过。详见 [独立审查](../reviews/storybook-animation-wiring.md)。首次主测还有一个合成 wait 夹具没有把 target 改回人物原位，错误期待 idle；修正夹具实际条件后通过，没有放宽播放器对未到达目标的判定。早期类型检查发现 sleep 测试字段和审查测试类型问题，均已修复。

本批新增主测 27 项、独立反例 10 项，共 37/37 通过；全部绘本基础/原型/动画共 206/206，加入等距室内外、观察导航、跟随、人物状态与成果提示的选定回归共 **545/545 通过，0 跳过**。全项目 TypeScript 无输出检查、服务端编译、默认客户端与独立动画原型 Vite 构建全部退出 0。Vite 仍报告原默认客户端大分块警告，不是性能验收。最终日志目录为 `output/storybook-animation-wiring-final-lhkCMt/`，`regression.txt`、`typecheck.txt`、`server-build.txt`、`vite-build.txt` 与 `status.txt` 分开记录结果。全部检查清空环境，HOME/TMP 放仓库 output 独占目录；Vite API 显式 `configFile:false,envFile:false,envDir:false`，客户端、服务端与独立原型输出均放本批目录，不读取环境文件或覆盖正式产物。

未运行全仓 npm test、真实模型/真实存档、浏览器/真实 GPU、字体版式、手机设备、遮挡观感、内存/帧率或十五日自主生活验收。未联网、读取 key，未重试 bwrap 或浏览器 IPC。静态原型与新接线均不是正式美术或最终默认画面。
