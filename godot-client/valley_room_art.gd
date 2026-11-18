extends RefCounted

const Craft = preload("res://valley_craft.gd")
const Architecture = preload("res://valley_architecture.gd")
const SeedObservation = preload("res://seed_observation.gd")
const FONT = preload("res://art/fonts/ValleyCJK-Regular.otf")
const SHADOW = preload("res://art/courtyard_shadow.gdshader")

var craft: Craft
var architecture: Architecture

func _init(palette: Craft, buildings: Architecture) -> void:
	craft = palette
	architecture = buildings

func build(terrain: Node3D, room: Dictionary, shared: bool, dining: bool) -> void:
	var width := float(room.width)
	var depth := float(room.height) - 3.0
	var center := Vector3((width - 1.0) * .5, 0, (room.height + 2.0) * .5)
	var style := str(room.get("style", ""))
	if style not in ["grower", "craft", "family", "hall"]: style = ""
	var floor_key: String = {"craft":"smoke_floor", "family":"honey_floor"}.get(style, "floor" if shared else "light_floor")
	var planks := craft.painted.get_material(floor_key)
	var frame := craft.painted.get_material("timber")
	craft.box(terrain, center - Vector3.UP * .30, Vector3(width + .29, .31, depth + .27), craft.mat("938575"))
	craft.box(terrain, center - Vector3.UP * .097, Vector3(width, .19, depth), planks)
	craft.box(terrain, center - Vector3.UP * .42, Vector3(width + .42, .13, depth + .40), frame)
	var shadow := ShaderMaterial.new()
	shadow.shader = SHADOW
	shadow.set_shader_parameter("board_size", Vector2(width, depth))
	var sheet := PlaneMesh.new()
	sheet.size = Vector2(width + 8, depth + 8)
	var cast := craft.mesh(terrain, sheet, center - Vector3.UP * .5, shadow)
	cast.name = "PaperShadow"
	cast.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_walls(terrain, room, center, depth, frame, style)
	var furnished := {}
	for slot in room.slots:
		match slot.kind:
			"bed":
				if style == "family":
					if slot.key == "bed:0":
						var double_bed := Node3D.new()
						double_bed.name = "DoubleBed"
						double_bed.position = Vector3(slot.at.x + .5, 0, slot.at.y - 1.5)
						double_bed.scale.x = 2.0
						terrain.add_child(double_bed)
						_bed(double_bed, {"x":.5,"y":1.5}, width, false, style)
						craft.batch(double_bed)
				else:
					_bed(terrain, slot.at, width, shared, style)
				for x in range(int(slot.at.x) - 1, int(slot.at.x) + 1):
					for z in range(int(slot.at.y) - 2, int(slot.at.y)):
						furnished[Vector2i(x, z)] = true
			"kitchen":
				_stove(terrain, _hearth_position(slot.at))
			"table":
				if style in ["grower", "craft", "family"]:
					_private_table(terrain, slot.at, style)
					for x in [int(slot.at.x) - 1, int(slot.at.x)]:
						furnished[Vector2i(x, int(slot.at.y) - 1)] = true
				elif dining:
					_table(terrain, slot.at)
					for x in range(int(slot.at.x) - 2, int(slot.at.x) + 2):
						for z in range(int(slot.at.y) - 2, int(slot.at.y)):
							furnished[Vector2i(x, z)] = true
			"station":
				if slot.get("key") == "mvp-seed":
					_seed_bench(terrain, slot.at)
			"seat":
				if style == "hall" and slot.at.y != 8:
					_stool(terrain, Vector3(slot.at.x, 0, slot.at.y))
	for at in room.blocked:
		if not furnished.has(Vector2i(at.x, at.y)):
			craft.box(terrain, Vector3(at.x, .056, at.y), Vector3(.88, .11, .88), craft.mat("a3967e"))
	if shared and style.is_empty(): _entry_weave(terrain, room.entry)
	if not style.is_empty(): _furnish(terrain, room, style)
	craft.batch(terrain)

func _entry_weave(root: Node3D, entry: Dictionary) -> void:
	var at := Vector3(entry.x, .006, entry.y - 1.44)
	var edge := craft.mat("776b50")
	var reed := craft.painted.get_material("woven")
	craft.box(root, at, Vector3(1.48, .017, 1.80), edge)
	craft.box(root, at + Vector3.UP * .010, Vector3(1.38, .012, 1.66), reed)
	for x in [-.56, .56]:
		craft.box(root, at + Vector3(x, .018, 0), Vector3(.042, .004, 1.66), edge)
	for z in [-.74, .74]:
		craft.box(root, at + Vector3(0, .018, z), Vector3(1.38, .004, .038), edge)

func _walls(root: Node3D, room: Dictionary, center: Vector3, depth: float, frame: Material, style: String) -> void:
	var width := float(room.width)
	var back := center.z - depth * .5
	var front := center.z + depth * .5
	var plaster := craft.mat("c8baaa" if style == "craft" else "cfc6b6")
	var light_plaster := craft.mat("e0cbb9" if style == "family" else "dbd1c2")
	for x in [-.42, width - .58]:
		craft.box(root, Vector3(x, .13, center.z), Vector3(.22, .26, depth), frame)
	craft.box(root, Vector3(-.42, 1.28, center.z), Vector3(.24, 2.56, depth), plaster)
	craft.box(root, Vector3(center.x, 1.28, back), Vector3(width, 2.56, .23), light_plaster)
	craft.box(root, Vector3(-.40, 2.56, center.z), Vector3(.32, .21, depth + .10), frame)
	craft.box(root, Vector3(center.x, 2.56, back), Vector3(width + .23, .21, .33), frame)
	var skirting := craft.painted.get_material("wood")
	craft.box(root, Vector3(.0, .24, center.z), Vector3(.13, .47, depth - .20), skirting)
	craft.box(root, Vector3(center.x, .25, back + .19), Vector3(width - .30, .49, .16), skirting)
	for fraction in [.03, .32, .66, .97]:
		var post: float = width * fraction - .5
		craft.box(root, Vector3(post, 1.29, back + .16), Vector3(.20, 2.61, .21), frame)
		craft.box(root, Vector3(post, 2.34, back + .30), Vector3(.27, .19, .44), skirting)
	for fraction in [.21, .56, .93]:
		var post: float = back + depth * fraction
		craft.box(root, Vector3(-.22, 1.28, post), Vector3(.20, 2.56, .22), frame)
		craft.box(root, Vector3(-.08, 2.36, post), Vector3(.43, .21, .27), skirting)
	for fraction in [.187, .808]:
		var x: float = width * fraction - .5
		architecture.lattice(root, Vector3(x, 1.66, back + .13), 1.73, 1.11, 5, Color("dac8a6"))
	for fraction in [.39, .73]:
		var window := Node3D.new()
		window.transform = Transform3D(Basis(Vector3.UP, PI * .5), Vector3(-.28, 1.62, back + depth * fraction))
		root.add_child(window)
		architecture.lattice(window, Vector3.ZERO, 1.65, 1.06, 4, Color("d0c3a7"))
		craft.batch(window)
	var entry := float(room.entry.x)
	for interval in [Vector2(-.5, entry - .67), Vector2(entry + .67, width - .5)]:
		var span: float = interval.y - interval.x
		if span <= 0: continue
		var middle: float = (interval.x + interval.y) * .5
		craft.box(root, Vector3(middle, .22, front - .11), Vector3(span, .44, .26), plaster)
		craft.box(root, Vector3(middle, .465, front - .11), Vector3(span + .05, .105, .31), frame)
	for side in [-1, 1]:
		craft.box(root, Vector3(entry + side * .68, .38, front - .12), Vector3(.17, .75, .27), frame)
	craft.box(root, Vector3(entry, .035, room.entry.y + .21), Vector3(1.26, .07, 1.06), craft.painted.get_material("woven"))
	craft.box(root, Vector3(entry, .025, front + .17), Vector3(1.44, .16, .55), craft.mat("b4ac9b"))
	craft.box(root, Vector3(entry, -.119, front + .47), Vector3(1.61, .17, .53), craft.mat("a79e8e"))

func _bed(root: Node3D, slot: Dictionary, width: float, shared: bool, style: String) -> void:
	var at := Vector3(slot.x - .5, 0, slot.y - 1.5)
	var wood := craft.painted.get_material("wood")
	var frame := craft.painted.get_material("timber")
	for x in [-.83, .83]:
		for z in [-.84, .84]:
			var height := .88 if z > 0 else .59
			craft.box(root, at + Vector3(x, height * .5, z), Vector3(.16, height, .17), frame)
			craft.orb(root, at + Vector3(x, height + .025, z), Vector3(.18, .10, .18), wood)
		craft.box(root, at + Vector3(x, .34, 0), Vector3(.13, .24, 1.80), wood)
	for z in [-.86, .86]:
		craft.box(root, at + Vector3(0, .33, z), Vector3(1.79, .24, .13), frame)
	craft.box(root, at + Vector3(0, .75, .86), Vector3(1.80, .12, .11), wood)
	for x in [-.60, -.30, .0, .30, .60]:
		craft.box(root, at + Vector3(x, .59, .86), Vector3(.108, .30, .094), wood)
	craft.orb(root, at + Vector3(0, .482, 0), Vector3(2.06, .36, 2.09), craft.painted.get_material("cream_linen"))
	var dye: String = {"grower":"sage_linen","craft":"indigo","family":"rose_linen"}.get(style,
		"indigo" if float(slot.x) < width * .5 and shared else "dyed_linen")
	var quilt := craft.painted.get_material(dye)
	_quilt(root, at, quilt)
	for x in ([-.48,.48] if style == "family" else [0.0]):
		craft.orb(root, at + Vector3(x, .630, .58), Vector3(.80, .24, .43), craft.painted.get_material("cream_linen"))
		craft.orb(root, at + Vector3(x - .28, .636, .585), Vector3(.15, .20, .44), craft.painted.get_material("woven"))
	if style == "family":
		for x in [-.58,-.39,-.2,0,.20,.39,.58]:
			craft.box(root, at + Vector3(x, .713, -.39 + .052 * cos(x * 9)), Vector3(.054, .013, .13), craft.mat("d8ac8b")).rotation.y = PI * .25

func _quilt(root: Node3D, at: Vector3, color: Material) -> void:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var points: Array[Vector3] = []
	var edges := [-.99, -.91, -.8, -.61, -.37, -.12, .12, .37, .61, .81, .92, .99]
	for row in range(8):
		for x in edges:
			var z := lerpf(-.93, .30, row / 7.0)
			var overhang := smoothstep(.76, .99, absf(x)) * .143
			var tuck := smoothstep(.61, .93, -z) * .033
			var fold := cos(x * 17.0 + z * 5.7) * .010 + sin(z * 16.0 + x * 3.6) * .005
			points.append(at + Vector3(x, .705 - overhang - tuck + fold, z))
	for row in range(7):
		for column in range(edges.size() - 1):
			var i := row * edges.size() + column
			for index in [i, i + 1, i + edges.size() + 1, i, i + edges.size() + 1, i + edges.size()]:
				surface.add_vertex(points[index])
	surface.generate_normals()
	surface.index()
	craft.mesh(root, surface.commit(), Vector3.ZERO, color)
	var seam := craft.painted.get_material("cream_linen")
	for column in range(1, edges.size() - 2):
		var last_row := 7 * edges.size()
		craft.beam(root, points[last_row + column] + Vector3.UP * .012, points[last_row + column + 1] + Vector3.UP * .012, .035, seam)

func _table(root: Node3D, slot: Dictionary) -> void:
	var at := Vector3(slot.x - .5, 0, slot.y - 1.5)
	var timber := craft.painted.get_material("timber")
	var surface := craft.painted.get_material("light_wood")
	for i in range(5):
		craft.box(root, at + Vector3(0, .88, (i - 2) * .36), Vector3(3.91, .135, .352), surface)
	for side in [-1, 1]:
		craft.box(root, at + Vector3(side * 1.67, .35, 0), Vector3(.19, .17, 1.42), timber)
		craft.box(root, at + Vector3(0, .73, side * .63), Vector3(3.37, .17, .11), timber)
		for end in [-1, 1]:
			craft.beam(root, at + Vector3(side * 1.79, .028, end * .72), at + Vector3(side * 1.66, .835, end * .62), .17, timber)
	craft.box(root, at + Vector3(0, .31, 0), Vector3(3.15, .11, .15), timber)
	var runner := craft.painted.get_material("indigo")
	craft.box(root, at + Vector3(0, .958, 0), Vector3(.78, .022, 1.82), runner)
	var trim := craft.painted.get_material("cream_linen")
	for side in [-1, 1]:
		craft.box(root, at + Vector3(side * .28, .971, 0), Vector3(.045, .009, 1.81), trim)
		craft.box(root, at + Vector3(0, .851, side * .906), Vector3(.78, .214, .023), runner)
		_stool(root, Vector3(slot.x + side, 0, slot.y))

func _stool(root: Node3D, at: Vector3) -> void:
	craft.box(root, at + Vector3(0, .414, 0), Vector3(.74, .13, .64), craft.painted.get_material("light_wood"))
	for x in [-.23, .23]:
		for z in [-.21, .21]:
			craft.beam(root, at + Vector3(x * 1.28, .018, z * 1.24), at + Vector3(x, .36, z), .10, craft.painted.get_material("timber"))

func _private_table(root: Node3D, slot: Dictionary, style: String) -> void:
	var at := Vector3(slot.x - .5, 0, slot.y - 1)
	var h := .45 if style == "family" else .79
	var wood := craft.painted.get_material("wood")
	var frame := craft.painted.get_material("timber")
	craft.box(root, at + Vector3.UP * h, Vector3(1.92, .13, .83), wood)
	for dx in [-.75,.75]:
		for dz in [-.28,.28]:
			craft.box(root, at + Vector3(dx, h * .5, dz), Vector3(.14, h, .14), frame)
	var top := at + Vector3.UP * (h + .07)
	match style:
		"grower":
			for dx in [-.55,.03,.58]:
				_pot(root, top + Vector3(dx, 0, 0), .61 + .24 * (1.0 - absf(dx)))
		"craft":
			for i in range(3):
				var strip := craft.box(root, top + Vector3(-.45, .04 + .033 * i, .14 - i * .14), Vector3(.65, .064, .16), wood)
				strip.rotation.y = -.24 + i * .11
			craft.beam(root, top + Vector3(.27,.10,-.25), top + Vector3(.64,.10,.18), .085, frame)
			craft.box(root, top + Vector3(.28,.137,-.24), Vector3(.29,.17,.094), craft.mat("6c6c62"))
		"family":
			craft.box(root, top - Vector3(.05, 0, 0), Vector3(1.53,.023,.58), craft.painted.get_material("woven"))
			_tea(root, top + Vector3(-.23,.02,0), true)
			for offset in [.24,.63]:
				_tea(root, top + Vector3(offset,.014,.09), false)

func _tea(root: Node3D, at: Vector3, serving: bool) -> void:
	var glaze := craft.mat("8b9c8c" if serving else "c7bda3")
	craft.orb(root, at + Vector3.UP * (.119 if serving else .067), Vector3(.30,.21,.29) if serving else Vector3(.18,.124,.17), glaze)
	if serving:
		craft.rod(root, at + Vector3(.07,.13,0), at + Vector3(.21,.20,0), .044, .53, glaze, 7)
		craft.orb(root, at + Vector3.UP * .222, Vector3(.095,.076,.095), glaze)

func _pot(root: Node3D, at: Vector3, size: float) -> void:
	craft.orb(root, at + Vector3.UP * .16 * size, Vector3(.45,.32,.43) * size, craft.mat("aa7c62"))
	craft.orb(root, at + Vector3.UP * .26 * size, Vector3(.35,.035,.34) * size, craft.mat("796450"))
	for i in range(4):
		var angle := i * 2.38
		var tip := at + Vector3(cos(angle)*.19, .45 + .06 * i, sin(angle)*.19) * size
		craft.beam(root, at + Vector3.UP * .235 * size, tip, .019 * size, craft.mat("71805a"))
		craft.orb(root, tip, Vector3(.21,.075,.14) * size, craft.mat("99a174" if i % 2 else "78885f")).rotation.y = angle

func _furnish(root: Node3D, room: Dictionary, style: String) -> void:
	var wood := craft.painted.get_material("wood")
	var frame := craft.painted.get_material("timber")
	var rug_key: String = {"grower":"sage_linen","craft":"indigo","family":"rose_linen","hall":"woven"}[style]
	var rugs := {"grower":Vector4(7.49,7.27,3.82,2.45), "craft":Vector4(3.51,7.41,3.91,2.63),
		"family":Vector4(10.58,8.72,3.81,2.68), "hall":Vector4(7.47,7.02,5.96,3.19)}
	_woven_rug(root, rugs[style], rug_key)
	var cabinet_x := float(room.width) - 2.46 if style == "family" else (3.2 if style == "hall" else float(room.width) * .57)
	var cabinet := Vector3(cabinet_x, .55, 3.03)
	craft.box(root, cabinet, Vector3(2.19,1.10,.52), frame)
	for x in [-.54, .54]:
		craft.box(root, cabinet + Vector3(x, .03, .275), Vector3(.96,.72,.080), wood)
		craft.box(root, cabinet + Vector3(x,.06,.34), Vector3(.145,.052,.067), craft.mat("b8a178"))
	craft.box(root, cabinet + Vector3.UP * .57, Vector3(2.30,.10,.65), wood)
	if style == "grower":
		_pot(root, cabinet + Vector3(-.65,.62,.06), .82)
		_pot(root, cabinet + Vector3(.58,.62,0), 1.05)
		var seed_tray := Vector3(cabinet_x - 1.39, .28, 3.18)
		craft.orb(root, seed_tray, Vector3(.61,.44,.50), craft.painted.get_material("woven"))
		for knot in [-1,0,1]:
			craft.orb(root, seed_tray + Vector3(knot*.13,.19,.05), Vector3(.18,.13,.17), craft.mat("a28258"))
	elif style == "family":
		_tea(root, cabinet + Vector3(-.67,.62,.06), true)
		for i in range(4):
			craft.box(root, cabinet + Vector3(.37,.68+.048*i,.03), Vector3(.64,.060,.40), craft.painted.get_material("rose_linen" if i % 2 else "cream_linen"))
		_plum_screen(root, 6.75)
		for x in [9.61, 11.49]:
			craft.orb(root, Vector3(x,.080,9.31), Vector3(.63,.145,.56), craft.painted.get_material("woven"))
	elif style != "hall" or not room.get("slots", []).any(func(slot): return slot.get("key") == "mvp-seed"):
		for i in range(4):
			var at := cabinet + Vector3(-.70 + .42*i,.73,.055)
			craft.orb(root, at, Vector3(.31,.27,.28), craft.mat("899084" if i % 2 else "a68b6b"))
			craft.orb(root, at + Vector3.UP * .132, Vector3(.18,.045,.18), wood)
	if style == "hall":
		for x in [6.83, 8.03, 8.77]:
			_tea(root, Vector3(x,.97,6.45), x == 8.03)
	if style == "craft":
		_hanging_tools(root, 5.24)

func _woven_rug(root: Node3D, box: Vector4, dye: String) -> void:
	var at := Vector3(box.x,.009,box.y)
	var thread := craft.painted.get_material("cream_linen")
	craft.box(root, at, Vector3(box.z,.019,box.w), craft.painted.get_material(dye))
	for direction: int in [-1,1]:
		craft.box(root, at + Vector3(0,.012,direction * (box.w*.5 - .13)), Vector3(box.z,.008,.062), thread)
		craft.box(root, at + Vector3(direction * (box.z*.5 - .14),.012,0), Vector3(.053,.007,box.w), thread)
		for i in range(13):
			var x := at.x + (float(i) / 12.0 - .5) * (box.z - .14)
			var z := at.z + direction * (box.w*.5 + .041)
			craft.box(root, Vector3(x,.017,z), Vector3(.031,.008,.12 + .02 * cos(i * 2)), thread)

func _plum_screen(root: Node3D, x: float) -> void:
	var at := Vector3(x,1.62,2.72)
	var wood := craft.painted.get_material("timber")
	craft.box(root, at, Vector3(2.56,1.38,.087), wood)
	craft.box(root, at + Vector3(0,0,.059), Vector3(2.36,1.19,.035), craft.mat("e3d1ac"))
	var origin := at + Vector3(-.92,-.45,.09)
	var tips := [Vector2(-.31,.23),Vector2(.41,.37),Vector2(.85,.06),Vector2(.16,-.11)]
	for i in range(tips.size()):
		var sprig: Vector2 = tips[i]
		var end := at + Vector3(sprig.x,sprig.y,.095)
		craft.beam(root, origin + Vector3(.17*i,.075*i,0), end, .027, craft.mat("80634e"))
		for j in range(4):
			var flower := end + Vector3(cos(j * 2.41) * .092, sin(j * 2.41) * .078, .012)
			craft.orb(root, flower, Vector3(.078,.070,.023), craft.mat("be8983" if (i+j)%2 else "d5a692"))

func _hanging_tools(root: Node3D, x: float) -> void:
	var wood := craft.painted.get_material("wood")
	craft.box(root, Vector3(x,1.59,2.73), Vector3(2.1,.18,.19), wood)
	for i in range(4):
		var at := Vector3(x + (i-1.5)*.46,1.56,2.87)
		var bottom := at + Vector3(.10*sin(i),-.41 + .045*i,.06)
		craft.beam(root, at, bottom, .079, wood)
		craft.box(root, bottom, Vector3(.16,.088,.083), craft.mat("747771"))

func _hearth_position(slot: Dictionary) -> Vector3:
	return Vector3(slot.x, 0, slot.y - .85)

func _stove(root: Node3D, at: Vector3) -> void:
	var masonry := craft.mat("b3a28b")
	craft.box(root, at + Vector3(0, .38, 0), Vector3(1.48, .76, .89), masonry)
	craft.box(root, at + Vector3(0, .13, .01), Vector3(1.56, .23, .94), craft.mat("998c79"))
	craft.box(root, at + Vector3(0, .80, 0), Vector3(1.64, .16, .99), craft.mat("7c7162"))
	var arch := craft.mat("6a6152")
	craft.box(root, at + Vector3(-.27, .325, .466), Vector3(.35, .36, .056), arch)
	craft.orb(root, at + Vector3(-.27, .481, .47), Vector3(.35, .31, .049), arch)
	for i in range(7):
		var angle := i * PI / 6.0
		var brick := craft.box(root, at + Vector3(-.27 + cos(angle) * .21, .435 + sin(angle) * .21, .473),
			Vector3(.102, .14, .081), craft.mat("c6b49c"))
		brick.rotation.z = angle - PI * .5
	craft.box(root, at + Vector3(.38, .46, -.295), Vector3(.40, .91, .28), masonry)
	craft.box(root, at + Vector3(.38, .92, -.295), Vector3(.47, .13, .34), craft.mat("999084"))
	var iron := craft.mat("555950")
	var center := at + Vector3(-.22, .88, .075)
	craft.orb(root, center + Vector3.UP * .079, Vector3(.56, .22, .55), iron)
	var rim := TorusMesh.new()
	rim.inner_radius = .235
	rim.outer_radius = .286
	rim.rings = 20
	rim.ring_segments = 8
	craft.mesh(root, rim, center + Vector3.UP * .174, iron)
	craft.orb(root, center + Vector3.UP * .143, Vector3(.47, .023, .47), craft.mat("454540"))
	for side in [-1, 1]:
		craft.box(root, center + Vector3(side * .31, .16, 0), Vector3(.15, .064, .12), iron)

func paint_cooking(root: Node3D, world: Dictionary, room: Dictionary, id: String) -> void:
	for slot in room.slots:
		if slot.kind != "kitchen": continue
		for person in world.get("residents", []):
			if person.get("inside") != id or person.get("roomAt") != slot.at: continue
			var activity: Variant = person.get("activity")
			if not activity is Dictionary or activity.get("action", {}).get("type") != "cook": continue
			if not activity.get("path", []).is_empty() or float(activity.get("remaining", 0)) <= 0: continue
			var journey: Variant = activity.get("room")
			if journey is Dictionary and not journey.get("path", []).is_empty(): continue
			_steam(root, _hearth_position(slot.at), float(world.minute))
			break

func _steam(root: Node3D, at: Vector3, minute: float) -> void:
	for i in range(3):
		var drift := fposmod(minute * .08 + i * .29, 1.0)
		var wisp := craft.orb(root, at + Vector3(-.24 + sin(i * 2.1 + drift * 2.0) * .18, 1.18 + drift * .55, .095),
			Vector3(.14 + drift * .13, .04, .075), craft.mat("e3e0cc"))
		wisp.rotation.z = .35 - drift * .65

# The station is furnished only when the server supplies its real room slot.
func _seed_bench(root: Node3D, slot: Dictionary) -> void:
	# The existing hall cabinet occupies the nonwalkable wall strip (y=3).
	# Use its top; do not add furniture/blockers to saved walking routes.
	var at := Vector3(slot.x, .31, slot.y - 1)
	var wood := craft.painted.get_material("light_wood")
	craft.box(root, at + Vector3(-.37,.874,0), Vector3(.84,.025,.45), craft.painted.get_material("woven"))
	# Empty tray remains after stock is exhausted; no decorative seed pile.
	craft.box(root, at + Vector3(.49,.89,0), Vector3(.43,.065,.46), craft.mat("a58c66"))
	for dx in [-.23,.23]:
		craft.box(root, at + Vector3(.49+dx,.95,0), Vector3(.035,.12,.47), wood)
	for dz in [-.23,.23]:
		craft.box(root, at + Vector3(.49,.95,dz), Vector3(.48,.12,.035), wood)

func paint_seeds(root: Node3D, world: Dictionary, room: Dictionary, id: String) -> void:
	if id != "mvp-home": return
	var slot: Dictionary = {}
	for entry in room.get("slots", []):
		if entry.get("key") == "mvp-seed": slot = entry
	if slot.is_empty(): return
	var seeds := SeedObservation.state(world)
	var at := Vector3(slot.at.x, .31, slot.at.y - 1)
	if not seeds.is_empty():
		# One paper packet per remaining seed unit, bounded by the finite store.
		for i in range(mini(int(seeds.stock), 8)):
			var packet := craft.box(root, at + Vector3(.38 + (i % 2) * .16,.99 + (i / 4) * .06,-.12 + ((i / 2) % 2) * .20), Vector3(.13,.045,.15), craft.mat("d8c49a"))
			packet.rotation.y = .07 * (i % 3 - 1)
	var label := Label3D.new()
	label.text = "种台 · " + SeedObservation.stock_label(world)
	label.font = FONT
	label.font_size = 32
	label.pixel_size = .010
	label.modulate = Color("554c3b")
	label.outline_modulate = Color("f1e2bf")
	label.outline_size = 7
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.position = at + Vector3(0,1.50,.48)
	root.add_child(label)
	for person in world.get("residents", []):
		if person.get("inside") != id or person.get("roomAt") != slot.at: continue
		var activity: Variant = person.get("activity")
		if not activity is Dictionary or activity.get("action", {}).get("type") != "mvpSaveSeed": continue
		if not activity.get("path", []).is_empty() or float(activity.get("remaining", 0)) <= 0: continue
		var journey: Variant = activity.get("room")
		if journey is Dictionary and (journey.get("mode") == "exit" or not journey.get("path", []).is_empty()): continue
		if float(person.get("inventory", {}).get("turnip", 0)) < 1: continue
		craft.orb(root, at + Vector3(-.27,.95,.03), Vector3(.19,.16,.22), craft.mat("ddcda6"))
		craft.rod(root, at + Vector3(-.27,1.00,.03), at + Vector3(-.24,1.17,.04), .025,.6,craft.mat("7a8b60"))
		break
