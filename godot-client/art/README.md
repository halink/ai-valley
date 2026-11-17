> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# MVP-0 painted material slice v1

Two project-bound original PNG textures generated with the built-in image generation tool on 2026-11-12. Not downloaded from a third-party asset store. Preserve source bytes (including metadata); no claim of verified provenance signature. These are actual albedo materials used by `valley_3d.gd`, not a concept image shown instead of the game.

- `meadow-gouache-v1.png`: requested square seamless flat diffuse sage/olive gouache turf, broad low-contrast brush marks, ochre grass flecks; no scene, horizon, text, shadows or central composition.
- `plaster-gouache-v1.png`: requested square seamless ivory lime plaster, cream/pale-grey broad gouache strokes and subtle pigment flecks; flat diffuse lighting, no objects, seams, text or preview ball.

Both generated originals are 1254×1254; requested 1024 was not enforced by the generator. No raster postprocessing. The plaster texture is tinted for wood, roof, skin and cloth in this first slice; these are not yet bespoke authored materials. World-space triplanar mapping avoids restarting UVs on each terrain tile. Seamlessness and final appearance still require rendered visual review. Geometry is code-authored, low-complexity initial modelling; no imported rig or action animation.

## Resident 3D samples v1

`painterly_resident.gd` builds original low-poly geometry directly as Godot
`ArrayMesh` resources, not 2D billboards or a concept image. No downloaded model,
third-party texture, font, rig or material is used by this sample. The source code
and generated geometry follow the repository's license. The ten-sided ring lofts
have flat normals and small deterministic vertex-color pigment variation, with
rough non-metallic surfaces. This is an initial painted-color treatment, **not** a
claim that bespoke hand-painted texture artwork has been completed.

The two MVP residents (`lin`, `qiao`) have different stable silhouette variants:
soft cap/flared tunic and tied hair/collar respectively. These visual variants are
identity-derived design choices, not inferred gender, occupation or behavior.
Snapshot shirt color remains authoritative and updates on the existing actor.
Geometry is cached across residents; no skeletal rig or invented work animation.
Feet anchor at the same cell center as before; height is at most 1.74 world units,
width below one tile. Actual meshes participate in existing occlusion/picking.
Both outdoor and authoritative indoor views use the same character constructor.

Validation: clean Godot import and offline headless geometry/material tests,
including the real MVP IDs, outward normals, bounds, cache reuse and appearance
updates. Movement, picking and interior regressions are included in the same
runner. No GPU/window render or aesthetic acceptance is claimed. Browser-rendered
review remains required for palette, facial readability and camera-distance scale.

## Original procedural painted surfaces v2

`painted_surfaces.gdshader` is the complete original procedural source; recipes
live in `painted_surfaces.gd`. Both are MIT licensed under this repository's
LICENSE (2026 AI Valley contributors). No asset-store images, downloaded shaders,
or modified reference images are included. The earlier generated PNG originals
and design references remain byte-for-byte unchanged. This is a code-authored
painted-color treatment, not a claim of an artist-painted raster texture pack.

The restrained slate grey / ochre timber / river blue / warm stone palette takes
inspiration from the existing art-direction sheet, without baking its lighting or
2D perspective into 3D. Four cached opaque rough materials are actually wired:

- slate: both exterior roof slopes, staggered rows and broad pigment variation;
- timber: entrance door, bridge tiles and cutaway room floor, directional grain;
- water: water tiles and the authoritative spring marker, static painted ripples;
- stone: cliff tiles, home foundation and entrance step, irregular pigment wash.

World-space triplanar blending keeps adjacent tiles continuous and avoids UV
stretching. There is no normal/displacement map, time animation, reflection,
transparency or geometry alteration. This preserves existing CPU triangle
occlusion and snapshot positions; painted ripples do not imply simulated flow.
Grass, plaster, foliage and residents keep their previous materials. Water stays
opaque and distinct from walkable ground, with subdued contrast to preserve
resident/selection readability. Historical material checks used offline synthetic snapshots only; they were not
browser or model acceptance. There is no maintained test runner for these assets.

Browser visual review is required for material changes: inspect roof seam aliasing
at far zoom, timber direction on all door faces, water/grass separation, lighting
and CJK labels in the Web export. No native-client delivery is intended. Headless import/structure checks do not establish rendered
quality or GPU shader compilation. No real-model or long-run acceptance claimed.


## Visible food and water actions

Residents now show the existing server-authoritative provision loop in the scene:

- A small basket and up to three berry markers reflect whole carried berry portions.
- A pottery flask is visible when carrying water. At an active spring-gather action,
  the empty vessel is used as a presentation prop before the server credits water.
- Onsite gather actions turn toward their actual resource. Berry picking and spring
  scooping have distinct repeating hand motions; travel remains separate.
- Eating a carried berry brings a berry to the hand; drinking brings the flask.
  Finishing uses the existing server inventory deduction, not a visual callback.
- Active conversation gestures toward the actual partner, using room coordinates
  indoors. Indoor animation phase survives snapshot redraws.

These are original low-poly, pigment-colored geometry, not a finished hand-painted
character/animation pack. The basket/flask are presentation vessels, not additional
owned equipment, craft recipes, or proof of successful collection. Berry markers cap
at three and do not replace exact inventory data. Props disappear when the relevant
stock is depleted. Actions stop on pause/disconnect; no local action completion,
resource credit, speech, social result, or model choice is invented by animation.

This increment changes presentation only. The default browser demo still uses
explicit local rules, not AI; existing real-model mode remains separate. A short
rule-driven run can validate only the exercised rule/state/presentation paths, not
real-model autonomy, broad gameplay completeness, or long-term stability.

- 2026-11-16：床位显示使用代码生成的木床架、床垫、薄毯与枕头；实际睡眠在已锁定床位上显示仰卧几何。无新增外部素材或许可证依赖，所有床面位置来自权威房间布局，人物根节点仍为床旁交互格。

- 2026-11-16：共屋餐桌/木凳为代码生成几何，沿用已有木材质和权威桌面阻挡范围。餐位吃饭姿态不改变居民根节点，不新增外部素材或许可。

- 2026-11-16：小菜园木框、土壤、幼苗与成熟根菜均为代码生成几何，复用现有材质。湿度与生长形态取田地快照；无新增外部素材、许可证或伪造产出。

- 2026-11-16：厨房灶台、锅、蒸汽和餐碗为代码生成几何，沿用既有材质。蒸汽只在到达厨房实际做饭时显示；不代表另有燃料或共享物资系统，无外部素材依赖。

- 2026-11-16：整体基线采用低频程序颜料草地替代原草地贴图（原素材来源记录保留），木纹/水面降低对比，夜间冷色补光提高可读性；所有变更仍为现有代码材质，无新增外部素材。镜头和纸色/绿按钮界面同步整理，不以新增物件冒充整体视觉改进。

- 2026-11-16：标记统一暗绿字/浅米描边，资源/菜园详情改为可选标注层；墙路降低亮度。居民原帽型/发髻轮廓加宽檐领巾、发束和麻布前襟，补近景脸部几何；不改变已有动作轴心或实际装备，不新增外部素材/许可依赖。

## 山谷观察界面与地表

2026-11-16。两张 PNG 由内置图像生成工具制作，作为 Godot 实际渲染素材。保留生成原文件，无第三方素材包。远山属于背景画，不表示可访问地形。草地笔触只提供地表颜色，道路、河水、岸线及建筑位置仍由真实地格和快照决定。

- `valley-mists-v1.png`，1672×941。提示词：Production backdrop texture for a live 3D Chinese storybook village game called 栖谷. Generate a single landscape-format approximately 16:9 hand-painted environment illustration, designed as the distant backdrop to a separate rendered 3D isometric settlement that sits in front of it. The medium is refined Chinese ink wash with opaque gouache accents and natural fine ivory rice-paper tooth. Depict ONLY distant atmospheric wooded mountain ridges and low cloud haze: several painterly silvery sage and blue-gray ridge silhouettes clustered in the upper third and softly bleeding in from the far left and right edges. Use subtle tree-crown brush dabs on the ridges. Midday warm mist; low contrast, preserve creamy unpainted paper at top left for dark title text. Most of the center, the entire lower center, and the lower third should be virtually empty smooth warm pale parchment (#eee8d8), with only a gentle pale mist wash so a separate mid-ground object reads clearly. The mountains must stay distant and quiet. Restrained mature color and beautifully hand-painted detail, coherent Chinese mountain landscape, no Disney, no noisy yellow vintage sepia. Do not depict any foreground terrain, tabletop, pathways, water bodies, architecture, village, people, animals, sun disc, props, screens, graphic borders, letters, calligraphy, stamps, text, or watermarks. The output is JUST the distant mist mountain backdrop illustration for actual use in the game, no mockup, no collage.
- `courtyard-meadow-v1.png`，1448×1086。提示词：Generate an actual base-color texture for the ground plane of a 3D isometric Chinese mountain-village storybook. 4:3 landscape image, perfectly orthographic top-down, no perspective and no horizon. Uniform diffuse illumination, absolutely zero cast shadows. Fill the entire image with ONE continuous hand-painted meadow ground surface, matte opaque gouache on textured paper. In the central 65% keep the ground muted medium sage-olive grass with subtle warm creamy dry-grass pigment mottling and a clear large-scale quiet area for residents and buildings, smoothly becoming denser and cooler forest-edge moss greens around the north and west edges with a few understated little strokes of grass or minute blossoms embedded flat in the brushwork. South and east edges have a few soft straw-green clusters; avoid a vignette outline or solid borders. Keep the visible colors near #849471, #a1a67b, #75886d, #778a64, with only a little ochre in pigment variations. Thick subtle gouache brush strokes at a medium visual frequency, lovingly illustrated but restrained, non-repeating natural variation, intentionally painted rather than photoreal or a noise filter. No buildings, no trees, no bushes, no roads, no tracks, no garden beds, no water, no stones, no fences, no characters, no objects, no text, no lighting or shadows. Just the satellite-flat pigment and grass texture to be applied to actual geometry.

## 山居美术升级

2026-11-16。建筑、家具、人物衣装和岩石由 Godot 网格生成。屋顶瓦片沿坡面 UV 排列，木材、地板、布料和水面各有独立材质。屋顶、装饰和室内家具在布局变化时重建，室内烹饪根据实际活动呈现蒸汽。以下三张贴图和插画由内置图像生成功能制作。贴图保留透明通道，导入时限制树叶纹理长边为 1024 px。树冠的透明空隙也用于场景点选。

- `pine-needles-v1.png`，2022×778。提示词：Produce ONE transparent foliage decal texture for a 3D fixed-isometric fantasy East Asian mountain village, a serious illustrated storybook. One cohesive loose cluster of finely broken moss-green umbrella pine foliage, with smaller olive/sage leafy dabs around it, painted as the silhouette of a FLAT, SIDE-TO-THREE-QUARTER upper canopy pad. Make the pad wide (about 2.6× wider than tall), asymmetric, a gently arched wind-swept crown tapering into several irregular sprays. Foliage only, with no trunks, large branches, background, shadow, scenery, lettering or ground. Draw leaf groups as richly feathered hand-painted matte gouache marks, with dark moss green at the lower interior, desaturated sage at the shoulders, touches of yellow-green along the top, tiny open gaps and beautifully jagged delicate edges. The brush texture should hold up in a very small game sprite. Tones #435943, #617652, #839067, restrained highlights #a9a67a. Reference is East Asian book illustration and ink wash with opaque pigment, not synthetic 3D, not fluffy round balls, not a flat icon, not realistic photo, no outlines. Put just this one foliage cluster centered and occupying ~80% of width with transparent padding on all sides. The ONLY pixels outside the foliage are truly transparent alpha, including the leaf gaps. A single production PNG decal, no mockup or grid.
- `broadleaf-v1.png`，1634×962。提示词：A single isolated semi-circular cluster of overlapping broad leaves, crafted as a transparent decal for a 3D isometric East Asian mountain-village picture-book game. Full width to height ratio about 1.7:1. One low mound of individually suggested oval leaves arranged in loose asymmetric fan-shaped branches, with some silhouette gaps, little shoot tips and narrow torn edges. Same sophisticated matte East Asian gouache and dry ink brush painting as an old landscape folio. The lowest leaves are cool dull olive, main leaf masses pale olive green and moss, with a few dull wheaten gold tips and visible leaf facets. Compact dwarf plant canopy only, no visible stem below it, no branches or exposed roots, no berries, no flowers, no text. Flat studio diffuse illumination, painterly upper light and deeper underside, finished texture fit for a small isometric artwork, no drop shadow, no ground, no other foliage clusters or grid, no 3D rendered spheres, no vector shapes, no photograph. Preserve a genuinely transparent alpha background and negative spaces between leaf tips. Center the entire uncut cluster in a wide canvas with a little transparent margin.
- `journal-pine-v1.png`。山居手记左页插画。提示词：A single refined illustration asset for the left page of a Chinese mountain-village game's in-game journal, on a truly TRANSPARENT background. Small vertical/roughly square ink-and-gouache vignette of terraced dark sage hills washed into mist, with one asymmetric leaning mountain pine over a handful of slate river stones and quiet blue-green eddies. The lone pine sits off-center in the upper-left, broad branches extending right, loose pine needles painted in brush clusters. A few pale ochre grasses cling to the rocks. Paint with a quiet Southern Chinese landscape sensibility, controlled negative space, matte pigment, visually suitable for an artisan's handmade field notebook. Restrained olive (#596754), ink brown (#4d4537), subdued river blue-green, and straw ochre (#b3a078). All edges taper to actual transparent alpha like a brush illustration, with visible feathered paper-style wash at the edges. No paper background, no rectangular backdrop, no border, no text, no calligraphy, no seal, no buildings, no figures, no icons and no UI. No photographic realism, 3D render, plastic sheen, vector clip-art, over-ornament, loud color, or shadows outside the painted vignette.

## 册页与木牌界面

2026-11-17。以下原始透明 PNG 由内置图像生成功能制作。册页用于居民名录、人物详情、场所和设置。雪松木条用于导航、缩放和场景门牌。两幅肖像沿用居民在场景中的发型与衣装，按现有居民 ID 绑定。其他居民显示姓名首字。导入时限制册页长边 1024 px，木牌 768 px，肖像 320 px。

- `interface/cloth-bound-leaf-v1.png`，1145×1373。提示词：Production UI texture for a hand-painted East Asian mountain village PC game. One blank portrait-shaped leaf from a field register, viewed exactly square-on orthographic, the only object against genuine transparent alpha. It fills about ninety-six percent of the image width and height. Irregular, extremely subtle hand-cut rice-paper edges, slightly angled upper and lower corners with natural fiber fray, perfectly flat enough for readable ink text. Along ONLY its rightmost 4 percent, a narrow exposed dark clay-brown cloth binding strip and exactly two or three understated ochre thread stitches close to the upper edge. Main full face is warm straw ivory, washed with gentle muted sesame-grey pigment and real dry-paper fibers, balanced subtle texture and even tone so small text can be overlaid. Subtle warm patina on the outermost edge, absolutely no perimeter drawn line. No text, characters, grid, rules, pattern, seal, lettering, shading in the center, decorative label, UI layout, wallpaper, colored illustrations, shadows beyond the paper, glowing edges, metallic ornament, desk, strong stains, page curl, or additional objects. Beautiful restrained old folio craftsmanship, matte opaque gouache and understated paper texture. The main page must be front-facing with right angles and a large uniform clear writing area.
- `interface/cedar-slip-v1.png`，2172×724。提示词：One horizontal blank hand-cut cedar sign slip, production texture for an illustrated miniature East Asian mountain village game. A wide low plank with a roughly 5.5:1 width to height ratio, front-on, only object against genuine transparent alpha, entire rectangle visible, slight irregularly trimmed square corners and a softly chamfered bottom cut. Dark matte warm umber stained with ink, a muted charcoal-brown centre (#3e372a) and faint directional strokes of old timber grain. The grain is subtle enough to overlay cream ink text. Warm sienna wood showing through along a thin chipped bottom edge, tiny variations along the ends. Pigment looks like matte gouache on a book illustration, evenly lit, zero drop shadow or gloss. The blank continuous face fills almost the entire available width with small transparent margins. No text, marks, pictogram, bolts, knots, rope, picture frame, outlines, borders, props, lettering, panel mockup, or visual ornaments.
- `interface/lin-portrait-v1.png`，1199×1312。提示词：A single shoulder-up character vignette for a handwritten resident register in an East Asian mountain village storybook game. This is Lin He, a young adult aged 24 with a calm round face, warm wheat skin, dark chestnut hair just under a softly folded plain wheat-colored headwrap (a close-fitting tucked cloth cap, not a straw hat), rust-red cross-collar peasant cotton tunic, ivory inner collar and a dull brown seam. Three-quarter view looking just to the right of camera, expression quietly alert and kind, one ear partly visible. Preserve clarity at 72 pixels. Render as hand-painted dry gouache and thin brown ink strokes on the figure, slightly simplified animation-design eyes with natural proportions, subdued ochre and terracotta. Upper headwear and shoulders fully inside the crop, head larger than shoulders, naturally brush-faded bust edge. Single character, genuinely transparent alpha all around the bust, no background, no halo, no frame, no text, no objects, no fantasy ornaments, no photorealism, no pin-up, no plastic 3D, no heavy outlined chibi icon.
- `interface/qiao-portrait-v1.png`，1261×1247。提示词：A single shoulder-up character vignette for a handwritten resident register in an East Asian mountain village storybook game. This is Qiao Sheng, an adult aged 39 with a quietly composed narrow face, warm wheat skin, dark almost-black hair swept off the brow into a compact high tied knot with one small loose forelock, no facial hair. Muted river-blue cross-collar peasant cotton tunic with a silvery flax inner collar. Three-quarter view looking just to the left of camera, expression calm and attentive, head fully inside crop, shoulders and garment clearly visible. Preserve clarity at 72 pixels. Render as hand-painted dry gouache and thin brown ink strokes on the figure, slightly simplified animation-design eyes with natural proportions, restrained river blue and charcoal. Head larger than shoulders with a naturally brush-faded bust edge. Single character, genuinely transparent alpha all around the bust, no background, no halo, no frame, no text, no objects, no fantasy ornaments, no photorealism, no pin-up, no plastic 3D, no heavy outlined chibi icon.

## 居民近景模型

2026-11-17。林禾和乔笙的游戏内模型按册页肖像细化。林禾的圆脸、布巾、窄袖和短褂突出年轻的轮廓。乔笙的眉骨、额前发束、束带和较长衣摆形成另一种轮廓。脸部网格含鼻梁、眼窝和颧骨的连续起伏，眼睑、眉线和唇线贴合脸面。衣料采用弧形交领、褶皱、裹腿与布鞋，材质沿曲面显示织纹。

`resident_face.gd` 与 `resident_figure.gd` 定义原生网格，`resident_mesh.gd` 负责曲面生成，`resident_pigment.gdshader` 读取快照中的肤色、发色和衣色。模型每个造型共用网格缓存，每位居民单独着色。手肘和膝盖可弯曲，道具随动作对应的手部定位。世界坐标、通行、房间归属和实际库存仍读取原有快照。近景最大缩放增加，姓名标注维持可读字号。同格居民在格内错开站姿，点选各自的模型仍对应各自身份。此轮模型无新增外部素材。
