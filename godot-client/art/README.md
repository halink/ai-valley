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
runner. No GPU/window render or aesthetic acceptance is claimed. Native rendered
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
resident/selection readability. `npm run test:godot` checks real scene material
assignments and cache reuse, using offline synthetic snapshots only.

Native GPU review is still required: inspect roof seam aliasing at far zoom,
timber direction on all door faces, water/grass separation, lighting and CJK
labels on macOS. Headless import/structure checks do not establish rendered
quality or GPU shader compilation. No real-model or long-run acceptance claimed.
