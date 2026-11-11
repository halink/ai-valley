# 绘本等距贴图的最小技术基础

本批只提供未接线的纯模块、离线测试与接口约定。方向是东方山居手绘绘本、固定 2:1 Phaser 贴图；尚未取得并检查两张参考图的实际像素，因此没有正式美术、素材包、人物造型或视觉验收结果。现有默认 2D、旧等距观察试验及 `ObserverNavigation` 均未修改。

本地基线为 `d305264`。本批不合并、不覆盖远程设计，不提交、不推送；已有五个赠食候选不属于本批。

## 坐标与四向

`src/client/storybook-geometry.ts` 使用已有世界网格约定：`+x` 是 east，`+y` 是 south。地图位置是格子角点，不自动加半格。投影固定为：

- 像素 x = `(world.x - world.y) * 16`。
- 像素 y = `(world.x + world.y) * 8 - elevation`。
- 逆变换使用同一已知 elevation；仅凭屏幕点无法还原未知高度。
- north `(0,-1)` → northeast `(16,-8)`。
- east `(1,0)` → southeast `(16,8)`。
- south `(0,1)` → southwest `(-16,8)`。
- west `(-1,0)` → northwest `(-16,-8)`。

`storybookFacing` 直接映射真实方向。`storybookFacingFromOffset` 仅接受有明确单轴方向的位移；静止和非单轴位移返回 `null`，不捏造朝向。没有调用旧 `projectedFacing`，其屏幕主轴分类会把四个世界方向压为左右两向，不适用于四斜向贴图。只复用旧模块的浮点边界取整工具，不修改旧试验的方向语义。

`screenToStorybook` 先还原相机平移与缩放。`pickStorybookTile` 采用半开占地边界，只拾取地面格子，不把树冠、房檐或高贴图当成新增地块；建筑/人物像素级选择和室内切换尚未接线。

## 占地、脚点与深度

三个概念分开：

1. `StorybookFootprint` 是真实世界占地。`storybookBuildingFootprint` 只复制原 `Building.at/width/height`，不改建筑记录或碰撞。
2. `groundAnchor` 是素材在该占地内的局部地面锚点。相加得到 `worldFoot`；它用于投影位置及排序。
3. `frame.foot` 是未裁切贴图帧内部的像素脚点。`placeStorybookFrame` 给出 Phaser 可用的 position、归一化 origin，以及用于验证的 topLeft。贴图变高不会改变世界脚点或占地。

`placeStorybookAsset` 接收校验后的资产元数据，并要求资产占地尺寸与真实 footprint 完全相同。尺寸不符即报错，不为素材缩放、改写世界或随意换贴图。四向资产必须有明确四斜向 facing；没有默认镜像或静默回退。

纯函数仍可接收任意调用者提供的值，不负责证明实体属于当前世界。后续渲染适配器必须从现有 `Snapshot.world` 查找实体并保留 ID、室内坐标、实际位置与未知状态；不能把室内未知位置、镇外人物、搬运中身体等直接画到 `resident.at`，也不能用这些函数生成第二套模拟状态。当前只用既有合成世界工厂做只读接口测试，没有启动或推进任何存档、世界时钟或模型。

`orderStorybookObjects`：

- 按完整地面占地建立前后依赖，覆盖多格房屋的两侧，不仅比较贴图中心。
- 没有唯一占地约束时，使用投影脚点 y、x，再按唯一 key 排序。顺序是从后向前，可把下标交给 Phaser `setDepth`。
- 重叠占地列入 `overlaps`；遇到循环依赖，稳定打破一条或多条依赖，并在 `cycleBreaks` 逐次列出被迫提前的 key 与尚未绘制的前驱。结果不是“已解决遮挡”的承诺。
- 输入数组和实体不修改，输出顺序确定；循环报告并不声称列出了所有强连通分量。
- 复杂度为 O(n²)，只应在后续裁剪后的对象集合上使用。大屋、室内相交物件可能需要把墙、屋顶或家具分层。当前没有帧率、GPU、内存或大地图容量验收。

## v1 资产清单

`src/client/storybook-assets.ts` 导出 `STORYBOOK_SCHEMA_VERSION = 1`、`parseStorybookManifest(input, expected)` 及只读类型。`expected` 必须显式提供 `packId` 与 `packVersion`，输入必须精确匹配，不自动采用“最新”版本。版本采用无前导零的三段稳定版本号，不接受预发布、范围或省略字段。

清单的精确字段：

- `schemaVersion`：只能为 1。
- `packId`、`packVersion`：与调用方固定值匹配。
- `projection`：只能为 `{tileWidth:32, tileHeight:16}`。
- `atlas`：`path, width, height, sha256`。单个 PNG 图集，路径必须是 `assets/storybook/` 下的简单相对路径；拒绝 URL、绝对路径、反斜线、`.`/`..`、查询串及编码绕行。尺寸为正安全整数，sha256 为 64 位小写十六进制。
- `provenance`：非空的 `source, author, license` 声明。
- `assets`：非空数组，资产 ID 唯一。

资产条目共用 `id, kind, footprint, groundAnchor`。`footprint` 是正整数的 `width,height`；`groundAnchor` 是占地范围内的有限 x/y，允许小数和边界。`kind:'static'` 只包含一个 `frame`；`kind:'directional'` 只包含 `frames`，且必须恰有 northeast、southeast、southwest、northwest 四帧。

每帧恰含 `rect` 与 `foot`。`rect` 的 x/y/width/height 必须是安全整数、尺寸非零并完全落在图集内；`foot` 是帧范围内的有限像素坐标，允许小数和包含底边的边界。v1 只支持未旋转、未裁切帧，不支持自动 trim、旋转图集或动画。这些需要将来显式扩展版本，不能通过额外字段混入 v1。

校验器拒绝每层多余字段、非普通对象、访问器、隐藏字段、符号字段、稀疏/带额外属性数组。输出是与输入分离的深冻结副本。该接口面向 JSON 一类数据，并不是执行恶意 JavaScript Proxy 的沙箱。

这是元数据校验，不会加载文件或发请求，不验证实际 PNG 尺寸/内容/哈希，也不核实来源和使用许可。路径形状限制不等于文件系统符号链接防护。图集的 GPU 可用性仍取决于实际设备；安全整数不代表可加载的硬件尺寸。后续加载器必须核对真实字节、尺寸、摘要与来源授权，并决定缺失资产的诚实呈现方式。本批没有真实资产清单，测试中的全零 hash 与图集路径明确只是假元数据，不能作为生产素材。

## 验证与下一步

基础测试 84/84 通过，独立审查另有 5 项，见 [独立审查](../reviews/storybook-render-foundation.md)。旧观察/等距相关 77 项回归通过；最终三者一起重跑为 166/166，不是全仓套件。独立审查覆盖四对象遮挡环的全部 24 种输入排列，以及所有被打破前后依赖的准确报告。

执行了全项目 TypeScript 无输出检查、服务端 TypeScript 编译、Vite 构建。为遵守不读环境文件和密钥的边界，使用清空后的进程环境，并以 Vite API 的 `configFile:false, envFile:false, envDir:false` 显式构建；保留 `/ai-town/` base，输出到仓库内 `output/storybook-render-foundation/`，不覆盖正式产物。Vite 仍有原大分块警告。这不是运行 `npm run build` 的原命令，也不是浏览器或视觉验收。

未执行全仓 `npm test`、浏览器/Phaser 像素验证、移动端验收、性能测试、真实图片检测、真实世界运行、模型联网或存档读取。下一步应先取得参考图并逐张检查像素、与尚未本地整合的远程设计核对，再确定资产包的实际规格、来源、分层和加载器，最后沿现有观察端口接入真实 world。没有这些输入前不制作或宣称最终美术。
