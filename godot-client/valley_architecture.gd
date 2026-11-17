extends RefCounted

const Craft = preload("res://valley_craft.gd")
const TIMBER := "timber"
const EAVE_HEIGHT := 2.70

var craft: Craft

func _init(palette: Craft) -> void:
	craft = palette

func build(parent: Node3D, building: Dictionary, map: Dictionary) -> Vector3:
	var size := Vector2(float(building.width), float(building.height))
	var center := Vector3(building.at.x + (size.x - 1) * .5, 0, building.at.y + (size.y - 1) * .5)
	var door := Vector3(building.door.x, .045, building.door.y)
	var relative := door - center
	var along_z := absf(relative.z) >= absf(relative.x)
	var normal := Vector3(0, 0, signf(relative.z)) if along_z else Vector3(signf(relative.x), 0, 0)
	if normal == Vector3.ZERO: normal = Vector3.BACK
	var tangent := Vector3.UP.cross(normal)
	var width := size.x if along_z else size.y
	var depth := size.y if along_z else size.x
	var house := Node3D.new()
	house.set_meta("building_id", str(building.get("id", "")))
	house.transform = Transform3D(Basis(tangent, Vector3.UP, normal), center)
	parent.add_child(house)

	var kind := str(building.get("kind", ""))
	var shared := kind == "lodge"
	var store := kind in ["store", "workshop", "barn"]
	var eaves := .67 if shared else (.50 if store else .45)
	var rise := clampf(depth * .26, .98, 1.58) if shared else clampf(depth * .26, .78, 1.35)
	var walls := craft.mat("d7c7ad" if shared else ("bcaa8d" if store else "ded1b4"))
	var timber := craft.painted.get_material(TIMBER)
	var clay := craft.painted.get_material("clay_roof" if store else ("roof" if shared else "moss_roof"))
	var entry_x := clampf(relative.dot(tangent), -width * .5, width * .5)
	_foundation(house, width, depth, shared)
	_shell(house, width, depth, rise, walls, timber)
	_roof(house, width, depth, eaves, rise, clay, timber)
	_entry(house, entry_x, width, depth, shared, store, clay, timber)
	_approach(house, map, door, normal, tangent)
	craft.batch(house)
	return door + Vector3(0, .10, 0)

func _foundation(house: Node3D, width: float, depth: float, shared: bool) -> void:
	craft.box(house, Vector3(0, .19, 0), Vector3(width + .22, .38, depth + .22), craft.mat("797668"))
	var colors := ["aaa495", "929387", "9e9988"]
	for face in range(4):
		var span := width if face % 2 == 0 else depth
		var distance := depth * .5 if face % 2 == 0 else width * .5
		var basis := Basis(Vector3.UP, face * PI / 2.0)
		var count := maxi(2, roundi(span / .83))
		var step := span / count
		for row in range(2):
			for i in range(count + 1):
				var left := maxf(-span * .5, -span * .5 + (i - .5 * row) * step)
				var right := minf(span * .5, -span * .5 + (i + 1 - .5 * row) * step)
				if right - left < .1: continue
				var center := basis * Vector3((left + right) * .5, .11 + row * .17, distance + .10)
				var dims := Vector3(right - left - .025, .18, .20)
				if face % 2 != 0: dims = Vector3(dims.z, dims.y, dims.x)
				craft.stone(house, center, dims, craft.mat(colors[(i * 7 + row + face) % 3]), i + face + row)
	var sill := craft.mat("aea18b" if shared else "a89880")
	craft.box(house, Vector3(0, .367, 0), Vector3(width + .20, .09, depth + .20), sill)

func _shell(house: Node3D, width: float, depth: float, rise: float, walls: Material, timber: Material) -> void:
	craft.box(house, Vector3(0, 1.49, 0), Vector3(width, 2.19, depth), walls)
	var gable := PrismMesh.new()
	gable.size = Vector3(depth, rise * .94, width)
	var infill := craft.mesh(house, gable, Vector3(0, 2.57 + rise * .47, 0), walls)
	infill.rotation.y = PI * .5
	for x in [-width * .5, width * .5]:
		for z in [-depth * .5, depth * .5]:
			craft.box(house, Vector3(x, 1.52, z), Vector3(.24, 2.33, .24), timber)
		craft.box(house, Vector3(x, 2.53, 0), Vector3(.19, .21, depth + .12), timber)
		craft.box(house, Vector3(x, 3.01, 0), Vector3(.14, .81, .17), timber)
		var pitch_peak := Vector3(x, 2.55 + rise, 0)
		for side in [-1.0, 1.0]:
			craft.beam(house, Vector3(x, 2.52, side * depth * .5), pitch_peak, .19, timber)
	for z in [-depth * .5, depth * .5]:
		craft.box(house, Vector3(0, 2.47, z), Vector3(width + .12, .17, .22), timber)
		craft.box(house, Vector3(0, .51, z), Vector3(width, .13, .13), timber)

func _roof_point(x: float, side: float, t: float, half_width: float, span: float, rise: float) -> Vector3:
	# Slight upsweep limited to the outermost course and gable ends.
	var curve := 1.0 - t * (1.37 - .37 * t)
	var tips := pow(smoothstep(.70, 1.0, absf(x) / half_width), 2) * (.045 + .20 * t * t)
	return Vector3(x, EAVE_HEIGHT + rise * curve + tips, side * span * t)

func _roof(house: Node3D, width: float, depth: float, eaves: float, rise: float, tiles: Material, timber: Material) -> void:
	var half_width := width * .5 + eaves
	var span := depth * .5 + eaves + .09
	for side in [-1.0, 1.0]:
		var surface := SurfaceTool.new()
		surface.begin(Mesh.PRIMITIVE_TRIANGLES)
		for column in range(14):
			var left := lerpf(-half_width, half_width, column / 14.0)
			var right := lerpf(-half_width, half_width, (column + 1) / 14.0)
			for row in range(8):
				var t0 := row / 8.0
				var t1 := (row + 1) / 8.0
				var points := [
					_roof_point(left, side, t0, half_width, span, rise),
					_roof_point(right, side, t0, half_width, span, rise),
					_roof_point(right, side, t1, half_width, span, rise),
					_roof_point(left, side, t1, half_width, span, rise)
				]
				for index in ([0, 1, 2, 0, 2, 3] if side > 0 else [0, 2, 1, 0, 3, 2]):
					var point: Vector3 = points[index]
					surface.set_uv(Vector2(point.x / .365, absf(point.z) / .34))
					surface.add_vertex(point)
		surface.generate_normals()
		surface.index()
		craft.mesh(house, surface.commit(), Vector3.ZERO, tiles)
		for side_x in [-half_width, half_width]:
			for row in range(8):
				var a := _roof_point(side_x, side, row / 8.0, half_width, span, rise) - Vector3.UP * .075
				var b := _roof_point(side_x, side, (row + 1) / 8.0, half_width, span, rise) - Vector3.UP * .075
				craft.beam(house, a, b, .16, timber)
		for i in range(14):
			var a := _roof_point(lerpf(-half_width, half_width, i / 14.0), side, 1, half_width, span, rise)
			var b := _roof_point(lerpf(-half_width, half_width, (i + 1) / 14.0), side, 1, half_width, span, rise)
			craft.beam(house, a - Vector3.UP * .06, b - Vector3.UP * .06, .146, timber)
		for i in range(maxi(2, roundi(width / .55))):
			var x := -width * .5 + .29 + i * .55
			var rafter := _roof_point(x, side, 1, half_width, span, rise)
			craft.box(house, rafter - Vector3(0, .15, side * .23), Vector3(.13, .19, .54), timber)
	var ridge_height := EAVE_HEIGHT + rise
	var ridge := craft.mat("575a54")
	craft.rod(house, Vector3(-half_width - .04, ridge_height + .06, 0), Vector3(half_width + .04, ridge_height + .06, 0), .136, 1, ridge, 12)
	for side in [-1, 1]:
		craft.rod(house, Vector3(side * (half_width - .38), ridge_height + .06, 0), Vector3(side * (half_width + .14), ridge_height + .26, 0), .15, .56, ridge)

func _entry(house: Node3D, x: float, width: float, depth: float, shared: bool, store: bool, tiles: Material, timber: Material) -> void:
	var front := depth * .5
	var opening := 1.60 if shared else (1.62 if store else 1.04)
	var door_at := Vector3(x, 0, front)
	var frame := craft.mat("a07b56")
	craft.box(house, door_at + Vector3(0, 1.30, .026), Vector3(opening + .26, 2.08, .10), timber)
	for index in range(6 if shared or store else 4):
		var n := 6 if shared or store else 4
		var board := opening / n
		craft.box(house, door_at + Vector3((index + .5) * board - opening * .5, 1.25, .095),
			Vector3(board - .024, 1.78, .065), craft.mat(["916e50", "9b7553", "8f6a4e"][index % 3]))
	var jamb := opening * .5 + .06
	for side in [-1, 1]:
		craft.box(house, door_at + Vector3(side * jamb, 1.33, .13), Vector3(.16, 2.06, .20), frame)
	craft.box(house, door_at + Vector3(0, 2.33, .145), Vector3(opening + .37, .18, .23), frame)
	craft.box(house, door_at + Vector3(.15, 1.17, .159), Vector3(.13, .16, .05), craft.mat("674d34"))
	craft.rod(house, door_at + Vector3(.15, 1.14, .19), door_at + Vector3(.15, 1.23, .19), .025, 1, craft.mat("ba9963"))
	for step in range(3):
		craft.box(house, door_at + Vector3(0, .056 * (3 - step), .18 + step * .235),
			Vector3(opening + .39 + step * .14, .112 * (3 - step), .38), craft.mat(["9a9587", "aaa292", "b5ab98"][step]))
	var shelter := opening + (1.59 if shared else .62)
	var porch := craft.box(house, door_at + Vector3(0, 2.414, .49), Vector3(shelter, .15, 1.13), tiles)
	porch.rotation.x = .16
	craft.box(house, door_at + Vector3(0, 2.29, .96), Vector3(shelter, .14, .17), timber)
	for side in [-1, 1]:
		var support := door_at + Vector3(side * (shelter * .5 - .15), 0, .87)
		if shared:
			craft.box(house, support + Vector3.UP * 1.16, Vector3(.17, 2.27, .17), timber)
			craft.box(house, support + Vector3.UP * .10, Vector3(.29, .20, .29), craft.mat("a29a8a"))
		else:
			craft.beam(house, support + Vector3(0, 2.24, 0), support + Vector3(0, 1.96, -.79), .115, timber)
	for side in [-1, 1]:
		var window_at: float = x + side * (jamb + 1.08)
		if absf(window_at) + .62 < width * .5:
			lattice(house, Vector3(window_at, 1.51, front), 1.11, .96, 4, Color("666c59"))
		var gable := Node3D.new()
		gable.transform = Transform3D(Basis(Vector3.UP, side * PI * .5), Vector3(side * width * .5, 1.49, .10))
		house.add_child(gable)
		lattice(gable, Vector3.ZERO, 1.22, .98, 4, Color("646c5b"))
		craft.batch(gable)

func lattice(root: Node3D, center: Vector3, width: float, height: float, panes: int, paper: Color) -> void:
	var frame := craft.painted.get_material(TIMBER)
	craft.box(root, center + Vector3(0, 0, .027), Vector3(width, height, .072), craft.mat(paper.to_html(false)))
	for side in [-1, 1]:
		craft.box(root, center + Vector3(side * width * .5, 0, .078), Vector3(.115, height + .15, .14), frame)
		craft.box(root, center + Vector3(0, side * height * .5, .078), Vector3(width + .14, .11, .14), frame)
	for i in range(1, panes):
		craft.box(root, center + Vector3(width * (float(i) / panes - .5), 0, .086), Vector3(.057, height, .074), frame)
	for y in [-.19, .19]:
		craft.box(root, center + Vector3(0, height * y, .095), Vector3(width, .054, .077), frame)
	craft.box(root, center + Vector3(0, -height * .5 - .076, .118), Vector3(width + .28, .092, .24), craft.mat("96775a"))

func _approach(house: Node3D, map: Dictionary, door: Vector3, normal: Vector3, tangent: Vector3) -> void:
	var origin := house.transform.affine_inverse()
	for index in range(4):
		var at := door + normal * (.55 + index * .64)
		var cell := Vector2i(roundi(at.x), roundi(at.z))
		if not Rect2i(0, 0, map.width, map.height).has_point(cell): break
		if map.tiles[cell.y * int(map.width) + cell.x] not in ["grass", "path", "road"]: break
		var slab := craft.stone(house, origin * (at + tangent * sin(index * 3.14 + 1.0) * .11),
			Vector3(.99 - index * .08, .071, .54), craft.mat("a9a08c"), index)
		slab.rotation.y = cos(index * 1.89) * .32
