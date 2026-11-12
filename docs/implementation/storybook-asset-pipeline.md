# 绘本资产离线构建与验证管线

更新：两张参考 PNG 已恢复并实际查看；本页以下保留最初管线批次的历史范围与验证记录。后续新增的显式v2素材密度、逻辑尺寸及严格v1兼容规则见[高清素材与逻辑尺度](storybook-density.md)。参考板仍不是已授权的生产导出，工具不自动裁切或安装它们。

基线为本地 `8bf65bf`。本批新增可复用的**候选资产工具**，不制作正式人物或建筑，不替换默认视图，不安装生产图集。两张参考 PNG 仍未取得和检查像素；没有裁切概念板，没有声称首批 80 帧已绘制或通过视觉验收。

原严格 v1 图集、动画 companion、渲染与世界模块均不修改。五项用户设计文本和五项赠食候选不属本批，保持原状。没有暂存、提交、推送、联网、读取 key/真实存档、运行模型、重试 bwrap 或浏览器 IPC。

## 工具组成

- `src/tools/storybook-png.ts`：有界 PNG 编解码、真实字节 SHA256、CRC、RGBA 与透明度证据。
- `src/tools/storybook-asset-pipeline.ts`：严格 recipe 解析、源裁切检查、确定性排布、复用 v1/动画解析器、来源与分层报告。
- `src/tools/storybook-asset-files.ts`：仓库内显式路径 I/O、许可清单 hash pin、候选目录写入和重建核验。
- `scripts/storybook-assets.mjs`：`check` / `build` / `verify` 命令行入口，无环境文件、网络、图片搜索或自动安装。
- `src/tools/storybook-synthetic-input.ts` 与 `scripts/generate-storybook-pipeline-fixture.mjs`：唯一测试图来源。只生成带 S 标记、方向线和编号的合成箭头，以及四个层注册标记。

没有新依赖，也没有修改 package.json。用仓库已经安装的 Node 与 tsx 运行，不需要联网安装。

## 输入与授权边界

输入是调用者**明确授权用于 atlas 组装的本地 PNG**和一份 JSON recipe。调用者应先审核完整 recipe、源图用途和逐项授权，再传入 recipe 原始字节的 SHA256。工具不会自动计算一个未经审核的 pin 然后替用户接受。

`--approved-manifest-sha256=HEX` 固定的是完整 recipe 文件原始字节。pin 不匹配时，在读取任何 PNG 之前停止。每张 PNG 又有独立原始字节 hash、宽高、来源角色、作者、许可证和授权记录。授权声明只是记录证据，不能自行授予权限，也不等于工具验证了法律权利。

- `purpose` 为 `production-candidate` 或 `synthetic-diagnostic`。后者 pack ID 必须以 `synthetic-` 开头，来源描述必须含 `SYNTHETIC`。
- source `role` 分别必须是 `production-export` 或 `synthetic-diagnostic`。概念图、参考板角色无法通过，`docs/design/` 输入路径也被禁止。
- 禁止自动扫描文件夹、猜测帧格、镜像、缩放、旋转、补帧、去背景或将整张参考板自动切成角色。裁切矩形必须逐帧明确声明。
- PNG 路径相对 recipe 所在目录，只允许普通相对路径和 `.png` 后缀；禁止 `..`、绝对路径、URL、隐藏路径段、符号链接及链接祖先。recipe 必须是仓库内的 `.json`。
- 不接受 production resident bindings。角色 ID 只是资产内部 ID；成人/少年与真实居民、appearance 的对应仍需另外审核。

这能阻止错误角色声明、受保护设计路径及意外源文件替换，但**无法从文件名或像素自动判断一个被冒称为 production-export 的文件是否其实是复制出去的概念板**。真实许可和源图用途必须由已授权的人工审核确认。CLI hash pin 是对选定文件的约束，不是防御恶意调用者的权限沙箱；纯内存 API 也假设调用方诚实地传入该 pin。

## Recipe v1

所有列出的字段必须出现；额外字段、缺项、特殊原型、访问器与稀疏数组被拒绝。完整可运行示例由合成输入生成器产生，不能将它的测试脚点、尺寸、楼层或身份当成正式规格。

顶层字段：

```json
{
  "buildSchemaVersion": 1,
  "packId": "example-pack",
  "packVersion": "1.0.0",
  "purpose": "production-candidate",
  "profile": "custom",
  "atlas": {"width": 1024, "maxHeight": 2048, "padding": 2},
  "provenance": {"source": "明确来源", "author": "作者", "license": "许可证声明"},
  "sources": [],
  "assets": [],
  "characters": [],
  "buildings": []
}
```

此处空 sources/assets 仅说明字段结构，不能直接通过。实际至少需要一张已授权 PNG 和一个 asset。

每项 source 必须是：

```json
{
  "id": "source-id",
  "path": "exports/character.png",
  "sha256": "实际PNG原始字节的64位小写SHA256",
  "width": 512,
  "height": 512,
  "role": "production-export",
  "authorization": {
    "purpose": "atlas-assembly",
    "reference": "能追溯到明确授权的记录说明",
    "author": "源图作者",
    "license": "该源图的许可证与限制"
  }
}
```

每个 asset 包含 `id, kind, footprint, groundAnchor`，再加 static 的 `frame` 或 directional 的 `frames`。`footprint` 是世界占地，不能从 PNG 像素尺寸推算或改动；`groundAnchor` 是占地内地面锚点。

frame 精确字段：

```json
{
  "sourceId": "source-id",
  "rect": {"x": 0, "y": 0, "width": 64, "height": 96},
  "foot": {"x": 32, "y": 96},
  "transparency": "required"
}
```

这里只是坐标格式示例，**64×96 和 `(32,96)` 不是已确认制作规格**。sourceRect 是原 PNG 像素坐标；foot 是该完整、未裁紧画布的局部像素坐标，允许落在画布边缘。`transparency` 可为 `required` 或 static 用的 `opaque-allowed`，人物与共屋层必须为 required。每帧必须至少有非透明内容，required 还需至少一个完全透明像素；报告同时计数透明、半透明和不透明像素。这并不证明轮廓去底正确或脚底与锚点相吻合。

directional 的 frames 精确使用四个**世界方向** `north,east,south,west`，输出通过原映射转成 `northeast,southeast,southwest,northwest`。禁止屏幕 left/right 替代、缺向或镜像指令。

characters 元素是 `id,clips`；clips 必须含 `idle,walk,pick`。非空 clip 只有 `cels`，cel 只有 `assetId,durationMs`。每条 cel 引用一个四向 asset。idle 恰为 2，walk 恰为 6，pick 恰为 4 或显式 null。所有 directional assets 必须各被引用一次，不能借用其他角色的帧引用。时长、1×1 占地、(.5,.5) 地面锚点、整个人物跨动作/朝向的画布与脚点一致性，继续交给原动画 companion 契约验证。工具不推断成人、少年或性别。

`profile:first-batch` 要求恰有两组人物、恰有一组非 null pick，总计 80 个方向帧，并有一组建筑分层；`custom` 支持独立子包或只有静态素材的阶段性包，不能把它称为首批交付。

buildings 元素精确包含：

```json
{
  "id": "building-asset-group",
  "layers": {"contact": "ground-contact", "body": "body", "roof": "roof", "foreground": []},
  "points": {"door": {"x": 32, "y": 96}, "operations": []}
}
```

contact/body/roof 必须各引用一个不同 static asset；foreground 必须显式列出，可以为空。所有层的完整画布宽高、foot、占地、groundAnchor 必须一致；源图位置可以不同，输出图集位置可以不同。door/operations 是这份共同画布内的局部像素点，operations 每项是唯一 `id,x,y`。它们保留在构建报告中，不塞进严格 v1 清单，也没有伪装成真实建筑入口、家具或导航槽位。将来运行时仍需独立映射真实共屋布局。

## PNG 与排布

1. 首先对源文件真实字节验证 SHA256，再解析所有 chunk、CRC、完整 IEND、连续 IDAT、zlib 消耗长度及精确 scanline 大小。
2. 当前明确支持 **8-bit RGBA、非交错 PNG**及全部五种 scanline filter。拒绝 RGB/索引色/16-bit、APNG、交错、调色板与颜色配置 chunk，不进行隐式色彩转换。允许剥离文字、物理尺寸和时间等非颜色元数据。实际导出若含 sRGB/gAMA/iCCP，当前会明确拒绝；需先在明确授权的制作流程中得到合适 RGBA 导出，不能静默丢弃色彩配置后称为相同视觉结果。
3. 单图每边最多 4096，最多 16,777,216 像素、72,000,000 字节；一次最多 128 源图、总计 96,000,000 源字节和 24,000,000 声明源像素。recipe 文件最多 4,000,000 字节。限制用于本工具稳定性，不是设备性能承诺。
4. 每帧必须在真实源尺寸内，同一源的裁切矩形不能重叠。矩形不复用和不同像素 hash 不能证明真正四向解剖或非镜像美术。重复像素内容单独报告在 duplicatePixels，不能据此称为独立绘制。
5. 按 recipe assets 的给定顺序，四向按 north/east/south/west 作确定性 shelf 排布。`atlas.width,maxHeight` 必须显式提供且不超过 2048，padding 为 1–16。超出容量直接拒绝，不暗中缩图、拆包或旋转。此上限沿用当前设计参考，后续生产校准可另行版本化调整。
6. 每个 RGBA 字节（包括 alpha=0 时的 RGB）原样复制；无裁紧、预乘 alpha、描边扩展、插值或挤边。新 PNG 无附带元数据。报告记录 sourceId/sourceRect、atlasRect、foot、内容 hash 和 alpha 计数。
7. 编码后重新用实际 PNG 字节验证 hash、尺寸、RGBA、矩形不重叠、帧非空，再重新解析严格 v1 与动画 companion。PNG 输出和 runtime 元数据共享同一个真实 SHA256。

## 命令行

从 ai-valley 根目录运行：

```sh
# 只生成合成的输入 recipe/PNG，返回它们的路径与 hash。不会生成正式图稿。
node --import tsx scripts/generate-storybook-pipeline-fixture.mjs

# 将 INPUT.json 与 HASH 替换为已审核的实际输入，不使用通配符或自动发现。
node --import tsx scripts/storybook-assets.mjs check INPUT.json --approved-manifest-sha256=HASH
node --import tsx scripts/storybook-assets.mjs build INPUT.json output/storybook-assets/NEW_NAME --approved-manifest-sha256=HASH
node --import tsx scripts/storybook-assets.mjs verify INPUT.json output/storybook-assets/NEW_NAME --approved-manifest-sha256=HASH
```

- `check` 完成全套内存构建/验证，只返回摘要，不创建输出目录。
- `build` 只接受新目录 `output/storybook-assets/<名称>`，不会覆盖已有目录或写入 `assets/`、设计稿、生成模块与生产入口。全部验证成功后才创建目录，写文件时排他创建，最后写报告；写失败只清理自己本次创建的目录。
- 四份输出为 `atlas.png`、`atlas.manifest.json`、`atlas.animation.json`（静态包为 null）和 `asset-build.json`。manifest 的 `assets/storybook/<packId>.png` 是将来安装时的逻辑路径，不表示已经安装。
- `verify` 重新检查同一已授权源 recipe/PNG，从头确定性构建，并逐字节比较四个文件；源 PNG/recipe 需保留。这样也核对许可元数据、版本、源偏移与分层报告，而不是只比较 PNG。它不会改变任何输出。
- 输出总是 `validated-candidate-only`、`visualApproval:false`、`productionInstalled:false`。不自动给居民绑定、不修改世界与时间、不写存档、不影响现有资源加载。

同一工具版本、Node/zlib 实现和输入产生相同字节。本次在同一环境中实测重复构建相同；不承诺不同 zlib 版本永远产生相同压缩字节。发布流程需要固定工具链，并保留 source/recipe hash 和 pipelineVersion。

路径检查避免意外越界和符号链接，不是面对另一个同时恶意改换目录的 OS 沙箱。内存 API 接受可信内部调用者的 JSON-like 对象，不是 JavaScript Proxy 沙箱。未执行代码、读取 key 或执行 PNG 附带文本。

## 未定规格与后续门槛

本批不替用户决定正式源画布尺寸、分辨率缩放、角色具体身份/年龄造型、共屋各层画布与落点、门点/操作点、参考色彩管理或具体许可证。需要实际参考 PNG 和获授权生产导出后再校准并填入 recipe。当前完整层注册规则不支持不同尺寸的裁紧图层；若制作方需要裁紧图，应先设计独立版本的 source-size/offset 契约，不能绕过本版同画布检查。

通过工具只证明所列字节、元数据、透明度和排布约束。人体比例、方向真实性、衣装一致、像素脚底漂移、门槛比例、材质、遮挡、中文阅读、桌面/手机观感、帧率与自主生活仍需分别验收。报告保留元数据不是这些功能已接线。

## 本次验证

主测 38 项与独立审查 9 项均通过；包含它们的全部绘本相关回归 **290/290 通过，0 跳过**。全项目 TypeScript 无输出检查、服务端编译与 Vite 构建均退出 0。Vite 仍有原有大分块警告，不是运行时性能保证。日志在 `output/storybook-assets-verification-LrTWnU/`，分别为 `regression.txt,typecheck.txt,server-build.txt,vite-build.txt,cli-verify.txt,status.txt`。

检查时清空进程环境，最终完整复跑还将 HOME/USERPROFILE/TMPDIR/TMP/TEMP 固定到独占验证目录并禁用 tsx 缓存，服务端/Vite 产物也写入同目录；Vite API 显式 `configFile:false,envFile:false,envDir:false` 和原 `/ai-town/` base，没有运行会读取默认配置/环境的原 npm build 命令。所有测试图均来自上述合成程序，测试夹具临时目录只在本仓库 output 内。未运行全仓 npm test 或正式浏览器/GPU 验收。初次类型检查曾误用不存在的 `/usr/bin/node`，立即改为实际已安装 Node 路径；随后一次检查发现 source role 的 TypeScript 缩窄不足，补充明确类型后通过，没有跳过检查。

命令行生成→check→build→verify 实跑成功。合成 recipe 位于 `output/test-tmp/storybook-assets-synthetic-H1yO0I/recipe.json`，候选位于 `output/storybook-assets/synthetic-pipeline-verification/`。诊断图集 256×134，84 个图块中 80 个是编号方向箭头，另 4 个是注册层标记，**不是 80 张人物动画画稿**。PNG SHA256 为 `5a142387bb1a172067403ce3e4936ebfadf0fb81add7d56de1a4c4c3d73b1435`。

独立审查说明见 [资产管线审查](../reviews/storybook-asset-pipeline.md)。

## Content Credentials 原图保留导入

`caBX` 是 [C2PA 2.3 规范 A.3.2](https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf)
规定的 PNG ancillary/private/not-safe-to-copy 来源清单块；不是颜色或渲染指令。
存在此块**不证明**图像来自特定厂商，也不证明作者、许可、签名或内容真实。

离线源素材导入使用 `inspectRgbaPngSource`：维持 RGBA8 非交错、尺寸/总字节预算、完整 PNG 结构、所有 CRC、连续 IDAT、解压上限及尾部检查，只额外识别大小为 1–8,000,000 字节的单个 `caBX`。
块可在 IDAT 前或后，但不能打断 IDAT 序列。重复块、空块、超限块、坏 CRC、未知块、色彩配置和 APNG 块仍拒绝。
载荷作为 opaque 数据保留，不解析 JUMBF 内层、不执行、不联网、不验证签名或信任链；`opaque-unverified` 不能当作 C2PA 合规证明。
普通 `decodeRgbaPng` 仍拒绝 `caBX`，避免调用方不知情地丢弃来源。

含此块的构建输出额外包含 `source-<完整原图SHA256>.png`，逐字节保留原始 PNG；报告 `sources[].contentCredentials` 记录块大小/哈希、`retainedOriginal` 和 `retained-in-original-only` 策略，原有 source 路径/授权声明/完整哈希不变。
CLI `build` 写入原图后最后写报告；`verify` 同样逐字节验证原图。调用底层 inspection API 的工具也必须自行保留原文件。
衍生 atlas 的像素复制与以往一致，但不会把原图签名错误移植到改变了像素/布局的 atlas；原始来源可在伴随原图中审计。这不是静默删除或重新签名。
无 `caBX` 的旧构建输出保持不变。

该能力只解除**文件格式导入**阻塞，不改变授权、素材比例、透明边缘、方向/动作、视觉验收或生产安装门槛。未通过视觉审核的候选仍不能上线。
回归测试：`node --import tsx --test tests/storybook-provenance*.test.ts tests/storybook-asset-pipeline*.test.ts tests/storybook-density*.test.ts`。
