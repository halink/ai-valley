extends RefCounted

const Craft = preload("res://valley_craft.gd")
const PINE = preload("res://art/pine-needles-v1.png")
const BROADLEAF = preload("res://art/broadleaf-v1.png")
const ALPHA_CUTOFF := .42

var craft: Craft
var facing: Basis
var leaf_materials := {}
var leaf_images := {}
var leaf_plane := QuadMesh.new()

func _init(palette: Craft, camera_boom: Vector3) -> void:
	craft = palette
	facing = Basis.looking_at(-camera_boom.normalized())
	leaf_plane.size = Vector2.ONE

func build_rim(terrain: Node3D, map: Dictionary) -> void:
	var rim := Node3D.new()
	terrain.add_child(rim)
	for y in range(map.height):
		for x in range(map.width):
			var tile: String = map.tiles[y * map.width + x]
			var at := Vector3(x, .035, y)
			if tile == "cliff":
				_edge(rim, at, map.width, map.height)
			elif tile == "grass" and x + 1 < map.width and map.tiles[y * map.width + x + 1] == "water":
				_bank(rim, at, y)
	# Bark and rocks share meshes. Alpha-cut crowns remain separate picking surfaces.
	craft.batch(rim)

func courtyard(root: Node3D, world: Dictionary) -> void:
	var map: Dictionary = world.map
	for building in world.get("buildings", []):
		var corners := [
			Vector2i(building.at.x - 1, building.at.y + 1),
			Vector2i(building.at.x + building.width, building.at.y + building.height - 2)
		]
		for cell: Vector2i in corners:
			if not Rect2i(0, 0, map.width, map.height).has_point(cell): continue
			if map.tiles[cell.y * int(map.width) + cell.x] != "grass": continue
			if _occupied(world, cell): continue
			var at := Vector3(cell.x, .04, cell.y)
			_crown(root, at + Vector3(0, .26, 0), .95, .47, BROADLEAF, "9da77b", .12, cell.x % 2 == 0)
			_grass(root, at + Vector3(.32, 0, -.18), .29, cell.y)

func _occupied(world: Dictionary, cell: Vector2i) -> bool:
	for building in world.get("buildings", []):
		if Rect2i(building.at.x, building.at.y, building.width, building.height).has_point(cell):
			return true
		if cell == Vector2i(building.door.x, building.door.y): return true
	for item in world.get("resources", []) + world.get("plots", []):
		if cell == Vector2i(item.at.x, item.at.y): return true
	return false

func _edge(rim: Node3D, at: Vector3, width: int, height: int) -> void:
	var x := int(at.x)
	var z := int(at.z)
	var seed := x * 7 + z * 11
	var pine := (z == 0 and x in [3, 6, 11, 19, 23]) or (x == 0 and z in [5, 16, 19])
	var leaf_tree := (z == 0 and x in [8, 17, 25]) or (x == 0 and z in [2, 13, 22] and z < height - 1)
	if pine:
		_pine(rim, at, .83 + float(seed % 6) * .10, seed)
	elif leaf_tree:
		_deciduous(rim, at, .91 + float(seed % 4) * .08, seed)
	if cos(x * .81 + z * .62) + .34 * cos(seed * 1.51) > -.34 and x != width - 1:
		var variation := cos(float(seed) * 1.813)
		var rock := craft.stone(rim, at + Vector3(variation * .17, .06, .09),
			Vector3(.74 + absf(variation) * .24, .26 + absf(variation) * .26, .63), craft.mat("969486" if seed % 2 == 0 else "898b78"), seed)
		rock.rotation.y = variation * 2
		if (x == 0 or z == 0) and seed % 5 in [1, 2]:
			_crown(rim, at + Vector3(.09, .21, .10), .86, .36, BROADLEAF, "999f76", variation * .27, seed % 2 == 0)
		_grass(rim, at + Vector3(-.29, 0, .21), .32 + absf(variation) * .20, float(seed))
	if (z == 0 and x in [4, 12, 20]) or (x == 0 and z in [6, 15, 20]):
		var cliff := craft.stone(rim, at + Vector3(.10, .23, .06), Vector3(1.22, .69, .92), craft.mat("939689"), seed + 3)
		cliff.rotation.y = seed * .17

func _bank(rim: Node3D, at: Vector3, seed: int) -> void:
	var bend := cos(seed * 2.06) * .21
	var bank := at + Vector3(.47 + bend * .73, 0, bend)
	if seed % 5 in [0, 1, 3]:
		var stone := craft.stone(rim, bank + Vector3(.06, .064, 0),
			Vector3(.63 + absf(bend), .27, .77), craft.mat("8c9183"), seed)
		stone.rotation.y = seed * 1.22
		craft.stone(rim, bank + Vector3(-.24, .04, .25), Vector3(.52, .15, .48), craft.mat("a8a38e"), seed + 1)
	if seed % 4 != 2:
		_grass(rim, bank + Vector3(-.32, 0, -.16), .55 + absf(bend), seed * .95)
	if seed % 7 == 3:
		_crown(rim, bank + Vector3(-.38, .16, .12), .75, .28, BROADLEAF, "809571", bend, seed % 2 == 0)

func _pine(root: Node3D, at: Vector3, size: float, seed: int) -> void:
	var bend := Basis(Vector3.UP, float(seed) * 1.13)
	var start := at - Vector3.UP * .12
	var heel := at + bend * Vector3(.13, .84, 0) * size
	var elbow := at + bend * Vector3(-.21, 1.68, .12) * size
	var stem := at + bend * Vector3(-.52, 2.52, .03) * size
	var tip := at + bend * Vector3(-.78, 3.48, -.12) * size
	var bark := craft.painted.get_material("timber")
	craft.rod(root, start, heel, .23 * size, .79, bark)
	craft.rod(root, heel, elbow, .183 * size, .77, bark)
	craft.rod(root, elbow, stem, .142 * size, .62, bark)
	craft.rod(root, stem, tip, .090 * size, .56, bark)
	for i in range(3):
		var angle := seed * .52 + i * TAU / 3.0
		var anchor := at + Vector3(cos(angle), -.04, sin(angle)) * .57 * size
		craft.rod(root, at + Vector3.UP * .29 * size, anchor, .105 * size, .22, bark)
	var limb_points := [Vector3(.89, 2.07, .39), Vector3(-1.19, 2.65, .34), Vector3(.67, 3.01, -.44), Vector3(-1.04, 3.29, -.61)]
	for i in range(limb_points.size()):
		var end: Vector3 = at + bend * limb_points[i] * size
		var fork := elbow if i < 2 else stem
		var joint := (end + fork) * .50 - Vector3.UP * .12 * size
		craft.rod(root, fork, joint, .10 * size, .71, bark)
		craft.rod(root, joint, end, .072 * size, .38, bark)
		var tint: String = ["a2ad89", "b9bf9d", "a6b59b", "c3c6a2"][i]
		_crown(root, end + Vector3.UP * .12 * size, (2.44 - i * .16) * size, (.77 - i * .04) * size,
			PINE, tint, sin(seed + i * 3.7) * .17, (i + seed) % 2 == 0)
	_crown(root, tip + Vector3.UP * .05 * size, 2.0 * size, .68 * size, PINE, "ccd0a7", -.06, seed % 2 == 0)

func _deciduous(root: Node3D, at: Vector3, size: float, seed: int) -> void:
	var elbow := at + Vector3(.14, 1.40, -.18) * size
	var bark := craft.painted.get_material("timber")
	craft.rod(root, at - Vector3.UP * .08, elbow, .17 * size, .63, bark)
	for i in range(4):
		var angle := seed * .21 + i * 2.33
		var offset := Vector3(cos(angle) * .57, 2.04 + i * .22, sin(angle) * .59)
		var end := at + offset * size
		craft.rod(root, elbow, end, .086 * size, .43, bark)
		var tint: String = ["b5a374", "c9b883", "bbae7c", "d1c294"][i]
		_crown(root, end + Vector3.UP * .22 * size, (1.65 + i * .07) * size, (1.06 - i * .07) * size,
			BROADLEAF, tint, cos(angle) * .16, i % 2 == 1)

func _crown(root: Node3D, at: Vector3, width: float, height: float, leaves: Texture2D, tint: String, tilt: float, mirrored: bool) -> void:
	var key := [leaves, tint, mirrored]
	if not leaf_materials.has(key):
		var material := StandardMaterial3D.new()
		material.albedo_texture = leaves
		material.albedo_color = Color(tint)
		material.roughness = 1
		material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		material.alpha_scissor_threshold = ALPHA_CUTOFF
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
		material.uv1_scale.x = -1.0 if mirrored else 1.0
		material.uv1_offset.x = 1.0 if mirrored else 0.0
		leaf_materials[key] = material
	if not leaf_images.has(leaves):
		var pixels := leaves.get_image()
		if pixels.is_compressed(): pixels.decompress()
		leaf_images[leaves] = pixels
	var item := craft.mesh(root, leaf_plane, at, leaf_materials[key])
	item.transform.basis = (facing * Basis(Vector3.BACK, tilt)).scaled_local(Vector3(width, height, 1))
	item.set_meta("foliage_pixels", leaf_images[leaves])
	item.set_meta("foliage_mirror", leaf_materials[key].uv1_scale.x < 0)

# Transparent leaf gaps must not occlude a wall or a resident in the CPU picker.
static func visible_texel(item: MeshInstance3D, point: Vector3) -> bool:
	var img: Image = item.get_meta("foliage_pixels")
	var u := point.x + .5
	if item.get_meta("foliage_mirror"): u = 1 - u
	var x := clampi(int(u * img.get_width()), 0, img.get_width() - 1)
	var y := clampi(int((.5 - point.y) * img.get_height()), 0, img.get_height() - 1)
	return img.get_pixel(x, y).a >= ALPHA_CUTOFF

func _grass(root: Node3D, at: Vector3, height: float, angle: float) -> void:
	for i in range(5):
		var direction := angle + i * 2.4
		var offset := Vector3(cos(direction), 0, sin(direction))
		var foot := at + offset * .12
		var tip := foot + offset * height * .41 + Vector3.UP * height * (.50 + (i % 4) * .15)
		craft.rod(root, foot, tip, .023, .06, craft.mat("777d50" if i % 2 == 0 else "9b9865"), 5)

func spring(root: Node3D, at: Vector3, amount: float) -> void:
	craft.orb(root, at + Vector3(0, .057, 0), Vector3(1.69, .15, 1.22),
		craft.painted.get_material("water") if amount > 0 else craft.mat("7e7a68"))
	for i in range(10):
		var angle := i * TAU / 10.0
		var edge := at + Vector3(cos(angle) * .85, .11, sin(angle) * .59)
		var color: String = ["a5a497", "898e80", "939889"][i % 3]
		var rock := craft.stone(root, edge, Vector3(.49, .27 + i % 3 * .035, .42), craft.mat(color), i)
		rock.rotation.y = angle + .65
	_grass(root, at + Vector3(-.84, 0, -.29), .48, at.x)

func berry_bush(root: Node3D, at: Vector3, amount: float) -> void:
	var form := fposmod(at.x * .21 + at.z * .37, 1.0)
	for i in range(3):
		var angle := i * 2.39 + form * TAU
		var at_leaf := at + Vector3(cos(angle) * .24, .36 + .12 * i, sin(angle) * .24)
		_crown(root, at_leaf, .92 + form * .22, .53, BROADLEAF, "b5c58d" if amount > 0 else "a7a283", cos(angle) * .25, i % 2 == 0)
	for i in range(mini(5, int(amount))):
		var point := at + facing * Vector3(-.35 + i * .16, .62 + cos(i * 2.5) * .11, .42)
		point.y -= .14
		craft.orb(root, point, Vector3(.13, .14, .13), craft.mat("a64e40"))
		craft.orb(root, point + Vector3(-.04, .026, .01), Vector3(.10, .11, .10), craft.mat("b96a4c"))

func garden(root: Node3D, at: Vector3, wet: bool, growth: float) -> void:
	var timber := craft.painted.get_material("wood")
	var soil := PlaneMesh.new()
	soil.size = Vector2(1.88, 1.88)
	craft.mesh(root, soil, at + Vector3.UP * .132, craft.painted.get_material("wet_soil" if wet else "soil"))
	for side in [-.94, .94]:
		craft.box(root, at + Vector3(side, .112, 0), Vector3(.11, .19, 2.0), timber)
		craft.box(root, at + Vector3(0, .112, side), Vector3(2.0, .19, .11), timber)
		for corner in [-.94, .94]:
			craft.box(root, at + Vector3(side, .17, corner), Vector3(.16, .27, .16), timber)
	if growth < 0: return
	for row in [-.55, 0.0, .55]:
		for column in [-.54, .0, .54]:
			var crown := at + Vector3(row + cos(column * 6.0) * .03, .16, column)
			if growth >= 1:
				craft.orb(root, crown + Vector3.UP * .045, Vector3(.22, .20, .22), craft.mat("decbb2"))
			for i in range(4):
				var angle: float = i * 2.39 + row * 2.5
				var spread := .06 + growth * .12
				var leaf := craft.orb(root, crown + Vector3(cos(angle) * spread, .08 + growth * .11, sin(angle) * spread),
					Vector3(.16 + growth * .24, .044, .09 + growth * .07), craft.mat("75894f" if i % 2 == 0 else "9a9f5b"))
				leaf.rotation = Vector3(0, angle, .57 - i * .22)
