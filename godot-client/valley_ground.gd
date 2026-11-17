extends RefCounted

const Craft = preload("res://valley_craft.gd")

# Only the cliff lip is sculpted. Every walkable tile still sits on the
# authoritative horizontal grid, including the bend in the blue-green creek.
static func hamlet(root: Node3D, craft: Craft, dimensions: Vector2i, paint: Material, long_valley: bool) -> void:
	var ring := _outline(Vector2(dimensions), long_valley)
	var center := Vector3((dimensions.x - 1.0) * .5, .012, (dimensions.y - 1.0) * .5)
	var chip := SurfaceTool.new()
	chip.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(ring.size()):
		for p in [_point(ring[i], .012), _point(ring[(i + 1) % ring.size()], .012), center]:
			chip.set_normal(Vector3.UP)
			chip.add_vertex(p)
	craft.mesh(root, chip.commit(), Vector3.ZERO, paint)

	var edge := SurfaceTool.new()
	edge.begin(Mesh.PRIMITIVE_TRIANGLES)
	var colors := [Color("aa9778"), Color("887253"), Color("655843")]
	var levels := [0.011, -.23, -.54, -.82]
	if long_valley:
		colors = [Color("aa9b79"), Color("84785f"), Color("665d51")]
		levels = [0.011, -.26, -.63, -1.03]
	var widths := [1.0, 1.008, 1.001, .982]
	for band in range(colors.size()):
		for i in range(ring.size()):
			var j := (i + 1) % ring.size()
			var a := _ledge(ring[i], center, widths[band], levels[band], i)
			var b := _ledge(ring[j], center, widths[band], levels[band], j)
			var c := _ledge(ring[j], center, widths[band + 1], levels[band + 1], j)
			var d := _ledge(ring[i], center, widths[band + 1], levels[band + 1], i)
			var normal := Vector3(b.z - a.z, .10, a.x - b.x).normalized()
			var tint: Color = colors[band].lightened(.062 * sin(i * 2.55 + band))
			for p in [a, b, c, a, c, d]:
				edge.set_color(tint)
				edge.set_normal(normal)
				edge.add_vertex(p)
	var material: StandardMaterial3D = craft.mat("d3c3a8").duplicate()
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.vertex_color_use_as_albedo = true
	craft.mesh(root, edge.commit(), Vector3.ZERO, material)

static func build_footbridges(root: Node3D, craft: Craft, map: Dictionary) -> void:
	var bridges := Node3D.new()
	bridges.name = "CreekFootbridges"
	root.add_child(bridges)
	for z in range(map.height):
		var start := -1
		for x in range(int(map.width) + 1):
			if x < int(map.width) and map.tiles[z * int(map.width) + x] == "bridge":
				if start < 0: start = x
			elif start >= 0:
				_timber_walk(bridges, craft, start - .70, x - .30, z)
				start = -1
	craft.batch(bridges)

static func _timber_walk(root: Node3D, craft: Craft, start: float, end: float, z: float) -> void:
	var wood := craft.painted.get_material("timber")
	var middle := (start + end) * .5
	var span := end - start
	var boards := [craft.mat("b0926d"), craft.mat("a98560"), craft.mat("ba9b72"), craft.mat("a48967")]
	var count := ceili(span / .24)
	var stride := span / count
	for i in range(count):
		var board := craft.box(root, Vector3(start + (i + .5) * stride, .043, z + .016 * cos(i * 1.3)),
			Vector3(stride - .011, .058, 1.23), boards[i % boards.size()])
		board.rotation.y = .018 * sin(i * 2.4)
	for side in [-.54, .54]:
		craft.box(root, Vector3(middle, -.025, z + side), Vector3(span, .15, .13), wood)
		craft.beam(root, Vector3(start + .16, .46, z + side), Vector3(end - .16, .46, z + side), .076, wood)
		for t in [.04, .33, .67, .96]:
			var x := lerpf(start, end, t)
			craft.box(root, Vector3(x, .22, z + side), Vector3(.12, .57, .12), wood)
			craft.box(root, Vector3(x, .51, z + side), Vector3(.158, .053, .158), boards[1])

static func _point(p: Vector2, height: float) -> Vector3:
	return Vector3(p.x, height, p.y)

static func _ledge(p: Vector2, center: Vector3, scale: float, height: float, i: int) -> Vector3:
	var offset := _point(p, height) - Vector3(center.x, 0, center.z)
	return Vector3(center.x + offset.x * scale, height + maxf(.012 - height, 0) * .12 * sin(1.9 * i), center.z + offset.z * scale)

static func _outline(size: Vector2, long_valley: bool) -> PackedVector2Array:
	var far := size - Vector2(.5, .5)
	var ring := PackedVector2Array()
	var across := 21 if long_valley else 13
	var down := 16 if long_valley else 12
	for i in range(across + 1):
		var t := float(i) / across
		ring.append(Vector2(lerpf(.45, far.x - .58, t), -.43 + .46 * pow(absf(t - .5) * 2, 5.0) + .15 * sin(i * 2.2)))
	for i in range(1, down):
		var t := float(i) / down
		ring.append(Vector2(far.x + .29 * cos(i * 1.59), lerpf(-.35, far.y, t)))
	for i in range(across + 1):
		var t := float(i) / across
		ring.append(Vector2(lerpf(far.x - .4, .23, t), far.y - .29 * pow(absf(t - .5) * 2, 4.0) + .14 * sin(i * 1.77)))
	for i in range(1, down):
		var t := float(i) / down
		ring.append(Vector2(-.45 + .23 * sin(i * 1.49), lerpf(far.y, -.35, t)))
	return ring
