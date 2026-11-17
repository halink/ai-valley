extends RefCounted

const Craft = preload("res://valley_craft.gd")
const Architecture = preload("res://valley_architecture.gd")
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
	var planks := craft.painted.get_material("floor" if shared else "light_floor")
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
	_walls(terrain, room, center, depth, frame)
	var furnished := {}
	for slot in room.slots:
		match slot.kind:
			"bed":
				_bed(terrain, slot.at, width, shared)
				for x in range(int(slot.at.x) - 1, int(slot.at.x) + 1):
					for z in range(int(slot.at.y) - 2, int(slot.at.y)):
						furnished[Vector2i(x, z)] = true
			"kitchen":
				_stove(terrain, _hearth_position(slot.at))
			"table":
				if dining:
					_table(terrain, slot.at)
					for x in range(int(slot.at.x) - 2, int(slot.at.x) + 2):
						for z in range(int(slot.at.y) - 2, int(slot.at.y)):
							furnished[Vector2i(x, z)] = true
	for at in room.blocked:
		if not furnished.has(Vector2i(at.x, at.y)):
			craft.box(terrain, Vector3(at.x, .056, at.y), Vector3(.88, .11, .88), craft.mat("a3967e"))
	if shared: _entry_weave(terrain, room.entry)
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

func _walls(root: Node3D, room: Dictionary, center: Vector3, depth: float, frame: Material) -> void:
	var width := float(room.width)
	var back := center.z - depth * .5
	var front := center.z + depth * .5
	var plaster := craft.mat("cfc6b6")
	var light_plaster := craft.mat("dbd1c2")
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

func _bed(root: Node3D, slot: Dictionary, width: float, shared: bool) -> void:
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
	var quilt := craft.painted.get_material("indigo" if float(slot.x) < width * .5 and shared else "dyed_linen")
	_quilt(root, at, quilt)
	craft.orb(root, at + Vector3(.0, .630, .58), Vector3(.88, .24, .43), craft.painted.get_material("cream_linen"))
	craft.orb(root, at + Vector3(-.26, .636, .585), Vector3(.18, .20, .44), craft.painted.get_material("woven"))

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
		var stool := Vector3(slot.x + side, 0, slot.y)
		craft.box(root, stool + Vector3(0, .414, 0), Vector3(.74, .13, .64), surface)
		for x in [-.23, .23]:
			for z in [-.21, .21]:
				craft.beam(root, stool + Vector3(x * 1.28, .018, z * 1.24), stool + Vector3(x, .36, z), .10, timber)

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
