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
