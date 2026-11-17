extends RefCounted

const Craft = preload("res://valley_craft.gd")
const Snapshot = preload("res://snapshot.gd")
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
			elif tile in ["grass", "sand"] and x + 1 < map.width and map.tiles[y * map.width + x + 1] == "water":
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

func hamlet(terrain: Node3D, world: Dictionary) -> void:
	var decor := Node3D.new()
	terrain.add_child(decor)
	for center: Vector3 in [Vector3(4,0,0), Vector3(11,0,0), Vector3(19,0,0), Vector3(30.85,0,9)]:
		for i in range(4):
			var at := center + Vector3((i - 1.5) * .48, .24, .12 * sin(i * 2.8))
			var boulder := craft.stone(decor, at, Vector3(1.21, .73 + sin(i * 2.1) * .29, .72),
				craft.mat("9b917c" if i % 2 == 0 else "7d8172"), int(center.x) + i)
			boulder.rotation.y = i * .66
	for at: Vector3 in [Vector3(21.0,.04,.20), Vector3(26.15,.04,.24), Vector3(30.95,.04,6.36)]:
		_plum(decor, at, .79 if at.x > 30 else .98)
	for x in range(3, 11):
		for i in range(2):
			var at := Vector3(x + .12 * cos(x + i), .08 + i * .16, 22.91 - .16 * i)
			craft.stone(decor, at, Vector3(.83, .25, .52), craft.mat("a2947c" if x % 2 == 0 else "8a8473"), x + i * 12)
	var map: Dictionary = world.map
	for cell: Vector2i in [Vector2i(2,10),Vector2i(8,12),Vector2i(12,17),Vector2i(16,20),Vector2i(20,16),Vector2i(24,11),Vector2i(10,21),Vector2i(5,21),Vector2i(2,19),Vector2i(19,3)]:
		if map.tiles[cell.y * int(map.width) + cell.x] != "grass" or _occupied(world, cell): continue
		_wildflowers(decor, cell)
	craft.batch(decor)

func long_valley(terrain: Node3D, world: Dictionary) -> void:
	var landscape := Node3D.new()
	landscape.name = "LongCreekLandscape"
	terrain.add_child(landscape)
	# Form a few groups behind places of interest and leave views down the creek.
	for cell: Vector2i in [Vector2i(3,0), Vector2i(5,0), Vector2i(7,0), Vector2i(16,0),
		Vector2i(18,0), Vector2i(24,0), Vector2i(26,0), Vector2i(43,0), Vector2i(46,0),
		Vector2i(0,5), Vector2i(0,8), Vector2i(0,21), Vector2i(47,31)]:
		var seed := cell.x * 7 + cell.y * 11
		_pine(landscape, Vector3(cell.x, .14, cell.y), .97 + .058 * (seed % 7), seed)
	for cell: Vector2i in [Vector2i(9,0), Vector2i(20,0), Vector2i(40,0), Vector2i(0,17), Vector2i(47,4)]:
		_deciduous(landscape, Vector3(cell.x, .07, cell.y), 1.03, cell.x * 3 + cell.y)
	for at: Vector3 in [Vector3(0,.04,3), Vector3(47,.04,9), Vector3(47,.04,14.9)]:
		_plum(landscape, at, .96 + .13 * cos(at.z * 1.3))
	for at: Vector3 in [Vector3(5,.01,0), Vector3(17,.01,0), Vector3(25,.01,0), Vector3(44,.01,0),
		Vector3(0,.01,7), Vector3(0,.01,20), Vector3(2,.01,35), Vector3(9,.01,35),
		Vector3(17,.01,35), Vector3(25,.01,35), Vector3(41,.01,35), Vector3(47,.01,28)]:
		_rim_stones(landscape, at, .83 if at.z > 30 else 1.10)
	var map: Dictionary = world.map
	var layout := Snapshot.garden_layout(map)
	_groves(landscape, map, layout.get("trees", []))
	_creek_banks(landscape, world, not layout.is_empty())
	for cell: Vector2i in [Vector2i(3,10), Vector2i(4,12), Vector2i(4,18), Vector2i(6,20),
		Vector2i(7,30), Vector2i(8,31), Vector2i(13,32), Vector2i(14,31), Vector2i(19,33),
		Vector2i(25,30), Vector2i(27,31), Vector2i(38,23), Vector2i(39,25), Vector2i(45,28), Vector2i(46,29)]:
		if map.tiles[cell.y * int(map.width) + cell.x] != "grass" or _occupied(world, cell): continue
		_wildflowers(landscape, cell)
		_grass(landscape, Vector3(cell.x + .34, .03, cell.y - .15), .27, cell.y)
	craft.batch(landscape)

func _groves(root: Node3D, map: Dictionary, trees: Variant) -> void:
	if not trees is Array or trees.size() > 32: return
	for tree in trees:
		if not tree is Dictionary or not Snapshot.valid_position(tree.get("at")): continue
		var cell := Vector2i(tree.at.x, tree.at.y)
		if not Rect2i(0, 0, map.width, map.height).has_point(cell): continue
		if map.tiles[cell.y * int(map.width) + cell.x] != "cliff": continue
		var seed := cell.x * 13 + cell.y * 7
		var at := Vector3(cell.x, .02, cell.y)
		var scale := .82 + .055 * (seed % 5)
		match tree.get("kind"):
			"pine": _pine(root, at, scale * 1.12, seed)
			"deciduous": _deciduous(root, at, scale, seed)
			"plum": _plum(root, at, scale)
		for i in range(3):
			var angle := seed + i * 2.42
			var base := at + Vector3(cos(angle) * .35, .06, sin(angle) * .32)
			craft.stone(root, base, Vector3(.29, .21, .33), craft.mat("92917c" if i % 2 else "a8a28b"), seed + i)
			_grass(root, base - Vector3.UP * .04, .28 + .07 * i, angle)
		# The seat and its legs stay within the planted tile, off the footpath.
		if tree.get("kind") == "plum" and seed % 2 == 1:
			for side in [-.25, .25]:
				craft.stone(root, at + Vector3(side, .11, .33), Vector3(.15, .24, .21), craft.mat("898b7c"), seed)
			craft.stone(root, at + Vector3(0, .255, .33), Vector3(.75, .16, .28), craft.mat("b1a692"), seed)

func _creek_banks(root: Node3D, world: Dictionary, planned: bool) -> void:
	var map: Dictionary = world.map
	var width := int(map.width)
	for z in range(1, int(map.height) - 1):
		for x in range(1, width - 1):
			var tile: String = map.tiles[z * width + x]
			if tile != "sand" or _occupied(world, Vector2i(x, z)): continue
			var side := -1.0 if map.tiles[z * width + x - 1] == "water" else 1.0
			if planned:
				var reach := z + (3 if side < 0 else 0)
				if reach not in [5, 6, 7, 8, 9, 12, 13, 14, 15, 24, 25, 26, 27, 28, 31, 32, 33]: continue
			var seed := z * 3 + x * 5
			var reed := Vector3(x + side * .28, .027, z + .20 * cos(seed))
			if seed % 7 < 5: _grass(root, reed, .39 + .21 * absf(sin(seed * .78)), seed)
			if seed % 6 in [0, 2]:
				var pebble := reed + Vector3(side * .22, .045, -.18)
				craft.stone(root, pebble, Vector3(.52, .19, .62), craft.mat("a4a994" if seed % 4 == 0 else "838e82"), seed)
				craft.stone(root, pebble + Vector3(.24, -.025, .33), Vector3(.24, .10, .29), craft.mat("b2aa8d"), seed + 4)

func _rim_stones(root: Node3D, at: Vector3, size: float) -> void:
	var seed := int(at.x + at.z * 3.0)
	var palette := [craft.mat("a49b86"), craft.mat("878979"), craft.mat("6e7c70")]
	var edge := Vector3.RIGHT if at.z == 0 or at.z >= 35 else Vector3.BACK
	for i in range(5):
		var stride := ((i - 2) * .53 + sin(seed + i) * .12) * size
		var height := (.30 + .79 * sin((i + 1) * PI / 6.0)) * size
		var stone := craft.stone(root, at + edge * stride + Vector3.UP * height * .32,
			Vector3(1.12 * size, height, .86 * size), palette[(seed + i) % palette.size()], seed + i)
		stone.rotation.y = sin(seed + i * 1.7) * .52
		if i % 2 == 0: _grass(root, at + edge * (stride + .24), .21 * size, seed + i)

func _wildflowers(root: Node3D, cell: Vector2i) -> void:
	for i in range(6):
		var angle := i * 2.4 + cell.x * .21
		var stem := Vector3(cell.x + cos(angle) * .40, .025, cell.y + sin(angle) * .42)
		var top := stem + Vector3(.031, .21 + .055 * sin(angle * 3.0), -.04)
		craft.rod(root, stem, top, .012, .52, craft.mat("777d56"), 5)
		craft.orb(root, top, Vector3(.092, .044, .087), craft.mat("dbbe91" if i % 2 else "c799a0"))

func _plum(root: Node3D, at: Vector3, size: float) -> void:
	var elbow := at + Vector3(-.18, 1.24, .24) * size
	var bark := craft.painted.get_material("timber")
	craft.rod(root, at - Vector3.UP * .08, elbow, .16 * size, .64, bark)
	var tint := ["b98982", "deb2a1", "c79395", "e3bbac", "bd9296"]
	for i in range(5):
		var angle := i * 2.4 + at.x * .91
		var bough := at + Vector3(cos(angle) * (.58 + i * .12), 1.79 + .16 * i, sin(angle) * .71) * size
		craft.rod(root, elbow, bough, .067 * size, .32, bark)
		_crown(root, bough + Vector3(0, .16, 0), (1.41 + .1 * i) * size, (.79 + .04 * i) * size,
			BROADLEAF, tint[i], sin(angle) * .26, i % 2 == 0)
		for bloom in range(5):
			var ray := bloom * 2.6 + angle
			var knot := bough + Vector3(cos(ray) * .46, .17 + sin(ray) * .19, sin(ray) * .41) * size
			craft.orb(root, knot, Vector3(.22, .11, .18) * size, craft.mat("c49794" if bloom % 2 else "edc3ae"))

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

func well(root: Node3D, rim: Vector3, apron: Vector3, amount: float) -> void:
	var wood := craft.painted.get_material("timber")
	var masonry := [craft.mat("9d9784"), craft.mat("afa48d"), craft.mat("827d70")]
	craft.rod(root, rim + Vector3.UP * .025, rim + Vector3.UP * .103, .46, 1.0, masonry[2], 10)
	for course in range(3):
		var radius := .354 + .022 * (course % 2)
		for i in range(10):
			var angle := (i + .5 * (course % 2)) * TAU / 10.0
			var block := rim + Vector3(cos(angle) * radius, .15 + .134 * course, sin(angle) * radius)
			var masonry_block := craft.box(root, block, Vector3(.213, .13, .18), masonry[(i + course) % 3])
			masonry_block.rotation.y = -angle - PI * .5
	var water: Material = craft.painted.get_material("water") if amount > 0 else masonry[2]
	craft.rod(root, rim + Vector3.UP * .16, rim + Vector3.UP * .24, .27, 1.0, water, 14)
	for side in [-.39, .39]:
		craft.box(root, rim + Vector3(side, .59, -.10), Vector3(.095, 1.12, .11), wood)
		craft.beam(root, rim + Vector3(side, .87, -.10), rim + Vector3(side * .55, 1.14, -.10), .072, wood)
	craft.box(root, rim + Vector3(0, 1.14, -.10), Vector3(.92, .10, .13), wood)
	craft.rod(root, rim + Vector3(.06, 1.13, -.10), rim + Vector3(.06, .56, -.10), .018, 1.0, craft.mat("593e2a"), 7)
	craft.rod(root, rim + Vector3(.06, .47, -.10), rim + Vector3(.06, .59, -.10), .075, 1.15, craft.mat("a1794d"), 9)
	for x in [-.22, .22]:
		for z in [-.22, .22]:
			var flag := craft.box(root, apron + Vector3(x, .024, z), Vector3(.416, .037, .41), masonry[0 if x * z > 0 else 1])
			flag.rotation.y = x * z * .24

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

func garden(root: Node3D, at: Vector3, wet: bool, growth: float, planned := false) -> void:
	var soil_material := craft.painted.get_material("wet_soil" if wet else "soil")
	var soil_height := .092 if planned else .132
	var soil := PlaneMesh.new()
	soil.size = Vector2(1.88, 1.88)
	craft.mesh(root, soil, at + Vector3.UP * soil_height, soil_material)
	if planned:
		_stone_edging(root, at)
		for row in [-.55, 0.0, .55]:
			craft.box(root, at + Vector3(row, soil_height, 0), Vector3(.225, .036, 1.63), soil_material)
	else:
		var timber := craft.painted.get_material("wood")
		for side in [-.94, .94]:
			craft.box(root, at + Vector3(side, .112, 0), Vector3(.11, .19, 2.0), timber)
			craft.box(root, at + Vector3(0, .112, side), Vector3(2.0, .19, .11), timber)
			for corner in [-.94, .94]:
				craft.box(root, at + Vector3(side, .17, corner), Vector3(.16, .27, .16), timber)
	if growth < 0: return
	for row in [-.55, 0.0, .55]:
		for column in [-.54, .0, .54]:
			var crown := at + Vector3(row + cos(column * 6.0) * .03, soil_height + .028, column)
			if growth >= 1:
				craft.orb(root, crown + Vector3.UP * .045, Vector3(.22, .20, .22), craft.mat("decbb2"))
			for i in range(4):
				var angle: float = i * 2.39 + row * 2.5
				var spread := .06 + growth * .12
				var leaf := craft.orb(root, crown + Vector3(cos(angle) * spread, .08 + growth * .11, sin(angle) * spread),
					Vector3(.16 + growth * .24, .044, .09 + growth * .07), craft.mat("75894f" if i % 2 == 0 else "9a9f5b"))
				leaf.rotation = Vector3(0, angle, .57 - i * .22)

func _stone_edging(root: Node3D, at: Vector3) -> void:
	var slate := [craft.mat("a1977d"), craft.mat("b5a68a"), craft.mat("898576")]
	for side in [-.93, .93]:
		for i in range(5):
			var step := (i - 2) * .37
			var height := .142 + .026 * cos(i * 3.14 + side)
			craft.stone(root, at + Vector3(side, height * .48, step), Vector3(.22, height, .44), slate[i % 3], i)
			craft.stone(root, at + Vector3(step, height * .48, side), Vector3(.44, height, .22), slate[(i + 1) % 3], i + 2)
		for corner in [-.93, .93]:
			craft.stone(root, at + Vector3(side, .072, corner), Vector3(.27, .155, .27), slate[0], 3)
