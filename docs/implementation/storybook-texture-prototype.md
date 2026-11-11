# 绘本贴图：默认不接线的技术原型

本批沿用 `docs/design/storybook-valley.md` 的 32×16、2∶1 坐标方向，新增可显式调用的 Phaser 3.90 贴图适配器。**这是合成素材的技术原型，不是 Phase 1 美术或可运行样板验收完成。** 两张用户参考 PNG 仍未收到；未将提示词或概念示意冒充已检视的参考像素，未裁切或生成正式人物、建筑素材。

默认 `main.ts`、原 2D、旧等距入口、世界规则、模型、存档和观察导航没有修改。所有新模块均须由调用方显式使用；仓库当前界面不会自动出现新的绘本切换按钮。

## 已实现

- `storybook-texture.ts`：保持原 v1 清单不变，核对显式 pack/version pin、PNG 头与 IHDR、实际声明尺寸、20 MiB 字节上限、2048 单边上限和 SHA256，再解码并核对 RGBA 长度。浏览器默认从已有内存字节创建 Bitmap，用 Canvas2D 读取像素，并在成功/失败后关闭 Bitmap。没有 URL、请求或 Phaser Loader。来源/许可仍是制作者声明，不由 hash 证明。
- `storybook-synthetic-atlas.ts` 与 `assets/storybook/synthetic-prototype.png`：明确标注 SYNTHETIC 的自制诊断图集，MIT，256×544。包含八种地表、问号脚点标记、四张不同斜向箭头、8×6 共屋的 contact/body/roof 线框。箭头不是人物外观，线框不是房屋美术。内嵌 PNG 字节避免额外素材请求；PNG 与内嵌字节、独立 CRC/解压像素测试一致。
- `storybook-render-plan.ts`：纯只读、最多 32×32 格的窗口计划。地表逐格读同一份 Snapshot；居民位置复用现有校验，包括携运、镇外、室内、死亡、异常路径与未知位置。不调用旧的屏幕主轴归并朝向；确认相邻路线分别映射 northeast/southeast/southwest/northwest。只使用已记录第一步与 fraction，不用墙钟外推位置。
- `storybook-observer.ts`：接收原 ObserverMap 的快照与房间通知，默认未启用，点选回传原 person/building ID。它不注册 GET/SSE、不管理世界或动画时钟、不覆盖原视图、不修改跟随 resolver。错误清空本原型可选目标；断线与停表分别说明。
- `storybook-phaser.ts`：接收调用方已有的专用 Scene，不新建 Game。安装已校验 RGBA、帧 rect/origin；按照有界占地深度计划建立 Image，屋基在主体下，主体和屋顶随各自对象排序。拾取按前到后的非零 alpha 像素，与实际源帧、偏移和展示缩放对应。

世界占地、地面锚点、源帧脚点分离。共屋只有真实类型 lodge、占地8×6、完整 condition=100、三层素材锚点一致时才用三层诊断图；不支持类型/尺寸或受损建筑退为原位置标记，不缩放占地、不抹掉损坏事实。正常人物静止朝向未知、睡眠、劳动、携运、重伤病等均保留原因及位置标记；位置未知不摆到门口。没有待机替身、成果、烟火、道具或库存装饰。

遮挡排序保留原纯几何模块的 overlap/cycleBreaks 诊断，没有承诺解决交叠建筑或室内前墙。对象上限192，优先准入居民；超过预算明确计数。居民超过512或建筑超过8192拒绝本原型。没有大地图性能承诺。

## 调用契约

仅在调用方已经有单独的、准备完成的 Phaser Scene 时调用。该 Scene 必须只有一台相机：x/y、scrollX/Y、rotation 为0，zoomX/Y为1。安装时及后续绘制、输入、preupdate 都检查此边界；变换后清空绘制和点击目标，不误用屏幕坐标。需要平移/缩放样区时用窗口选择和本适配器内部 fit，不去改该 Scene 的相机。resize 后当前原型需要 dispose 并以新 viewport 重装。

示意接线（不是默认入口改动）：

```ts
const texture = await prepareStorybookAtlas(
  syntheticManifest, syntheticPin, syntheticAtlasBytes(),
);
// scene is an existing, dedicated, ready Phaser 3.90 Scene.
// observerMap is the existing observation feed, not a new source.
const view = mountStorybookPrototype(scene, observerMap, texture,
  {x: 0, y: 0, width: 1280, height: 720});
view.activate();
// view.setWindow({x: ..., y: ..., width: 24, height: 24});
// view.plan exposes full per-object reasons and unknown-position entries.
// view.deactivate() empties this display while keeping the source subscribed.
// view.dispose() releases this display and its subscriptions.
```

`prepareStorybookAtlas` 的注入 decoder 仅用于明确标注的离线测试；生产字节应走默认真实解码器，不以伪 decoder 代替校验。安装会复制像素证据，防止调用方后来修改数组而让图像与点击不一致。重复安装同一 Scene/ObserverMap 返回原句柄；同 Scene 不接受另一个观察源。换素材、换 viewport 应先 dispose。

本适配器只拥有自己的 texture、container、images、notice、输入/场景事件和观察订阅。deactivate 不销毁调用方 Scene，dispose 幂等；Scene shutdown/destroy 也会清理。发生晚期事件注册失败时会释放已经取得的观察控制器，不留下订阅。没有额外 RAF 或 interval。

## 明确不覆盖

- 没有正式手绘画稿、成人/少年造型、头像、四向待机/行走/采摘动画；v1 元数据仍只有静态或四向单帧。
- 室内一律提示使用原视图；没有揭顶切换、室内家具、自动跟随、遮挡淡化或特殊姿态。
- 不绘制资源、作物、设施、动物、项目、库存与其他物资；空白不表示它们不存在。
- 这是开发接口，不是完整六入口 UI。画面显示合成/暂停/断线/范围摘要；点选下方说明显示地图坐标与所点对象的素材/姿态回退原因，完整原因也保留在绘制计划，选择可进入原档案。
- 没有浏览器/真实 Phaser GPU 截图、中文排版、三个画幅视觉验收或帧率/内存测量。模拟 Phaser API 测试不是浏览器验收。此前被拒绝的浏览器操作未重试或绕过。

## 验证

直接新增测试及独立审查共26项通过：纹理字节与尺寸、四向独立像素、anchor、实际记录映射、透明像素点击、断线/暂停、错误与重复生命周期、晚期订阅清理、相机边界等。独立六项覆盖陈旧携运坐标、损坏关系账本、192对象预算、方向/非法进度、透明前景穿透、换世界/销毁后旧回调。详见 [独立审查](../reviews/storybook-texture-prototype.md)。

生成诊断图集：`node scripts/generate-storybook-synthetic-atlas.mjs`，只写本批 PNG 与内嵌素材模块；不运行世界。测试使用合成内存世界/模拟 Canvas 与 Phaser API，不打开存档，不推进模型或联网。

新旧绘本基础、观察导航、人物位置/状态/跟随、旧观察入口相关回归共220项通过。类型检查、服务端编译、现有客户端与独立原型模块构建通过。构建使用清空环境和 Vite API 的 `configFile:false, envFile:false, envDir:false`，输出到 `output/storybook-prototype/`，不读取环境文件/密钥或覆盖正式产物。原客户端的大分块警告仍存在。未运行全仓 `npm test`；未提交或推送。
