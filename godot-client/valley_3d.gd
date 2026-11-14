extends Node3D
const UI_FONT = preload("res://art/fonts/ValleyCJK-Regular.otf")
const PaintedSurfaces = preload("res://painted_surfaces.gd")
var painted_surfaces := PaintedSurfaces.new()
const PainterlyResident = preload("res://painterly_resident.gd")
# Read-only presentation: every interactive object is anchored to snapshot data.
const Snapshot = preload("res://snapshot.gd")
const MEADOW = preload("res://art/meadow-gouache-v1.png")
const PLASTER = preload("res://art/plaster-gouache-v1.png")
var room_id := ""
var room_layouts := {}
var room_world := ""
var camera: Camera3D
var terrain: Node3D
var actors: Node3D
var focus := Vector3(16, 0, 12)
var map_key := ""
var people := {}
var materials := {}
var residents_root: Node3D
var motions := {}
var last_revision := -1
const MOVE_SECONDS := 0.35

const MAX_PLAYBACK_SECONDS := 1.4
# Replay confirmed edges in order, never shortcut a corner or extrapolate.
func _process(delta: float) -> void:
	for id in motions.keys():
		var motion: Dictionary = motions[id]
		motion.elapsed = minf(motion.duration, motion.elapsed + maxf(delta, 0.0))
		var progress: float = motion.elapsed / motion.duration * (motion.path.size() - 1)
		var edge := mini(int(progress), motion.path.size() - 2)
		var weight := clampf(progress - edge, 0.0, 1.0)
		var actor: Node3D = people[id]
		var start: Vector3 = motion.path[edge]
		var target: Vector3 = motion.path[edge+1]
		actor.position = start.lerp(target, weight)
		var direction := target - start
		var facing := atan2(-direction.x, -direction.z)
		var angle: float = motion.angle
		if edge > 0:
			var prior: Vector3 = start - motion.path[edge-1]
			angle = atan2(-prior.x, -prior.z)
		actor.rotation.y = lerp_angle(angle, facing, weight)
		actor.present_pose(true, motion.elapsed * TAU / MOVE_SECONDS)
		if motion.elapsed >= motion.duration:
			motions.erase(id)
			actor.present_pose(false, 0.0)

func settle_motion() -> void:
	for id in motions:
		people[id].position = motions[id].path[-1]
		var direction: Vector3 = motions[id].path[-1] - motions[id].path[-2]
		people[id].rotation.y = atan2(-direction.x, -direction.z)
	motions.clear()
	for actor in people.values(): actor.set_activity_pose({}, false)

func clear_people() -> void:
	motions.clear()
	people.clear()
	clear_children(residents_root)

func _ready() -> void:
	terrain = Node3D.new()
	add_child(terrain)
	residents_root = Node3D.new()
	add_child(residents_root)
	actors = Node3D.new()
	add_child(actors)
	camera = Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 34
	camera.far = 200
	add_child(camera)
	camera.current = true
	position_camera()
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -35, 0)
	sun.light_color = Color("fff0ce")
	sun.light_energy = 1.15
	sun.shadow_enabled = true
	add_child(sun)
	var environment := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("dce4d3")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("cddbd7")
	env.ambient_light_energy = 0.65
	environment.environment = env
	add_child(environment)

func position_camera() -> void:
	camera.position = focus + Vector3(26, 30, 32)
	camera.look_at(focus)

func center(world: Dictionary) -> void:
	if world.is_empty(): return
	if room_layouts.has(room_id):
		var room: Dictionary = room_layouts[room_id]
		focus = Vector3(room.width / 2.0, 0, room.height / 2.0)
		camera.size = maxf(room.width, room.height) * 1.5
		position_camera()
		return
	focus = Vector3(world.map.width / 2.0, 0, world.map.height / 2.0)
	camera.size = maxf(world.map.width, world.map.height) * 1.1
	position_camera()

func pan(delta: Vector2) -> void:
	var scale_factor := camera.size / get_viewport().get_visible_rect().size.y
	focus -= (camera.global_basis.x * delta.x + Vector3(camera.global_basis.y.x, 0, camera.global_basis.y.z) * delta.y) * scale_factor
	position_camera()

func zoom(direction: float) -> void:
	camera.size = clampf(camera.size * direction, 8, 70)

# Only focus actors already rendered from the current validated snapshot.
# Do not infer an outdoor location for indoor, absent or unknown residents.
func focus_resident(id: String) -> bool:
	if not people.has(id): return false
	var actor: Node3D = people[id]
	focus = actor.position
	position_camera()
	return true

func mat(color: String, grass := false) -> StandardMaterial3D:
	var key := color + str(grass)
	if materials.has(key): return materials[key]
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(color)
	material.albedo_texture = MEADOW if grass else PLASTER
	material.roughness = 1.0
	material.uv1_triplanar = true
	material.uv1_world_triplanar = true
	material.uv1_scale = Vector3.ONE * 0.38
	materials[key] = material
	return material

func mesh(parent: Node3D, shape: Mesh, at: Vector3, material: Material) -> MeshInstance3D:
	var item := MeshInstance3D.new()
	item.mesh = shape
	item.position = at
	item.material_override = material
	parent.add_child(item)
	return item

func box(parent: Node3D, at: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	var shape := BoxMesh.new()
	shape.size = size
	return mesh(parent, shape, at, material)

func orb(parent: Node3D, at: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	var shape := SphereMesh.new()
	shape.radial_segments = 12
	shape.rings = 6
	shape.radius = 0.5
	shape.height = 1
	var item := mesh(parent, shape, at, material)
	item.scale = size
	return item

func clear_children(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()

func show_world(world: Dictionary, selected: String, continuous := true, paths: Dictionary = {}) -> void:
	if not room_id.is_empty() and (world.get("id", "") != room_world or not room_layouts.has(room_id)):
		room_id = ""
		map_key = ""
		center(world)
	if not room_id.is_empty():
		show_room(world, selected, continuous)
		return
	if world.is_empty():
		clear_children(terrain)
		clear_children(actors)
		clear_people()
		last_revision = -1
		map_key = ""
		return
	var key := str(world.id) + ":" + str(world.get("mapRevision", 0)) + ":" + str(hash(world.map)) + ":" + str(hash(world.get("buildings", [])))
	var reset := key != map_key
	if reset:
		clear_people()
		map_key = key
		clear_children(terrain)
		build_terrain(world)
	clear_children(actors)
	var revision := int(world.get("revision", 0))
	var new_snapshot := revision != last_revision or reset
	var animate: bool = continuous and not reset and revision > last_revision and not world.get("clock", {}).get("paused", false)
	if not continuous or world.get("clock", {}).get("paused", false):
		settle_motion()
	last_revision = revision
	for resource in world.get("resources", []):
		var at := Vector3(resource.at.x, 0, resource.at.y)
		if resource.kind == "spring":
			orb(actors, at + Vector3(0, 0.05, 0), Vector3(1.6, 0.12, 1.6), painted_surfaces.get_material("water"))
		elif resource.kind == "bush":
			for i in range(3):
				orb(actors, at + Vector3((i-1)*0.25, 0.38, sin(i)*0.2), Vector3(0.7, 0.8, 0.7), mat("a4b477" if resource.amount > 0 else "a59e7e", true))
			if resource.amount > 0:
				for i in range(mini(5, int(resource.amount))):
					orb(actors, at + Vector3(cos(i*2.4)*0.35, 0.65, sin(i*2.4)*0.35), Vector3.ONE*0.15, mat("b45858"))
		else:
			box(actors, at+Vector3(0,0.25,0), Vector3.ONE*0.5, mat("a7a397"))
		var label := Label3D.new()
		label.font = UI_FONT
		label.text = Snapshot.resource_name(resource.kind) + "：" + str(resource.amount)
		label.position = at + Vector3(0, 1.2, 0)
		label.font_size = 30
		label.pixel_size = 0.01
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		actors.add_child(label)
	var visible_ids := {}
	for person in world.get("residents", []):
		if not Snapshot.visible(person): continue
		var target := Vector3(person.at.x, 0, person.at.y)
		if target.x < 0 or target.z < 0 or target.x >= world.map.width or target.z >= world.map.height: continue
		visible_ids[person.id] = true
		var actor: Node3D = people.get(person.id)
		if actor == null:
			actor = create_person(person)
			residents_root.add_child(actor)
			people[person.id] = actor
			actor.position = target
		elif new_snapshot or actor.get_meta("target", target) != target:
			# Do not accumulate visual lag. A new batch during playback snaps to
			# its authoritative endpoint rather than append an unbounded queue.
			var interrupted := motions.has(person.id)
			motions.erase(person.id)
			var path: Array = paths.get(person.id, [])
			var points: Array[Vector3] = []
			for at in path:
				points.append(Vector3(at.x, 0, at.y))
			if animate and not interrupted and points.size() >= 2 and points.size() <= 17 and points[0] == actor.position and points[-1] == target:
				motions[person.id] = {"path":points, "elapsed":0.0, "duration":minf(MAX_PLAYBACK_SECONDS, MOVE_SECONDS * (points.size()-1)), "angle":actor.rotation.y}
			else:
				actor.position = target
		actor.update_appearance(person)
		actor.set_activity_pose(person, continuous and not world.get("clock", {}).get("paused", true))
		actor.set_meta("target", target)
		actor.get_node("Selection").visible = person.id == selected
	for id in people.keys():
		if not visible_ids.has(id):
			motions.erase(id)
			residents_root.remove_child(people[id])
			people[id].queue_free()
			people.erase(id)

func create_person(person: Dictionary) -> Node3D:
	var actor := PainterlyResident.new()
	actor.construct(person)
	var ring := TorusMesh.new()
	ring.inner_radius = 0.43
	ring.outer_radius = 0.49
	var selection := mesh(actor, ring, Vector3(0, 0.04, 0), mat("efbd6a"))
	selection.name = "Selection"
	return actor

func build_terrain(world: Dictionary) -> void:
	var map: Dictionary = world.map
	var palette := {"grass": "ffffff", "water": "7caeb1", "path": "c8ac7c", "soil": "a78e6c", "sand": "ddc79c", "cliff": "929185", "road": "b8aa8c", "bridge": "87745b"}
	box(terrain, Vector3((map.width-1)*0.5, -0.5, (map.height-1)*0.5), Vector3(map.width, 0.9, map.height), mat("918374"))
	for y in range(map.height):
		for x in range(map.width):
			var tile: String = map.tiles[y*int(map.width)+x]
			var shape := PlaneMesh.new()
			shape.size = Vector2.ONE
			var surface: Material = mat(palette.get(tile, "b8aa8c"), tile == "grass")
			if tile == "water": surface = painted_surfaces.get_material("water")
			elif tile == "bridge": surface = painted_surfaces.get_material("wood")
			elif tile == "cliff": surface = painted_surfaces.get_material("stone")
			mesh(terrain, shape, Vector3(x, 0.01 if tile != "water" else 0.025, y), surface)
	for building in world.get("buildings", []):
		var w: float = building.width
		var d: float = building.height
		var at := Vector3(building.at.x+(w-1)*0.5, 0, building.at.y+(d-1)*0.5)
		box(terrain, at+Vector3(0, 1.2, 0), Vector3(w, 2.4, d), mat("f1ddba"))
		box(terrain, at+Vector3(0, 0.18, 0), Vector3(w+0.12, 0.36, d+0.12), painted_surfaces.get_material("stone"))
		for side in [-1, 1]:
			var roof := box(terrain, at+Vector3(side*w*0.26, 2.65, 0), Vector3(w*0.6, 0.16, d+0.7), painted_surfaces.get_material("roof"))
			roof.rotation.z = side * -0.4
		var door := Vector3(building.door.x, 0.05, building.door.y)
		box(terrain, door, Vector3(0.85, 0.1, 0.85), painted_surfaces.get_material("stone"))
		# Door is placed on the wall nearest the authoritative entrance tile.
		var relative := door-at
		var front := Vector3(clampf(relative.x, -w/2, w/2), 0.9, clampf(relative.z, -d/2, d/2))
		box(terrain, at+front, Vector3(0.8 if absf(relative.z)>absf(relative.x) else 0.12, 1.8, 0.12 if absf(relative.z)>absf(relative.x) else 0.8), painted_surfaces.get_material("wood"))

# CPU triangle queries use the same opaque mesh geometry as rendering. No
# physics bodies/step lag: playback, rotations and camera changes apply now.
# Labels and the selection ring are annotations, not pick/occlusion surfaces.
func pick(screen: Vector2) -> String:
	var origin := camera.project_ray_origin(screen)
	var direction := camera.project_ray_normal(screen)
	var nearest := camera.far
	var result := ""
	var pending: Array[Node] = [terrain, actors, residents_root]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		if node is Node3D and not node.is_visible_in_tree(): continue
		pending.append_array(node.get_children())
		if not node is MeshInstance3D or node.name == "Selection": continue
		var item := node as MeshInstance3D
		if item.mesh == null: continue
		if not item.mesh.has_meta("pick_triangles"):
			item.mesh.set_meta("pick_triangles", item.mesh.generate_triangle_mesh())
		var triangles: TriangleMesh = item.mesh.get_meta("pick_triangles")
		var inverse := item.global_transform.affine_inverse()
		var hit := triangles.intersect_ray(inverse * origin, (inverse.basis * direction).normalized())
		if hit.is_empty(): continue
		var point: Vector3 = item.global_transform * hit.position
		var distance := (point-origin).dot(direction)
		if distance < 0 or distance >= nearest: continue
		nearest = distance
		result = ""
		var owner_node: Node = item
		while owner_node != self:
			if owner_node.has_meta("resident_id"):
				result = owner_node.get_meta("resident_id")
				break
			owner_node = owner_node.get_parent()
	return result

# Cutaway presentation in room coordinates, not an outdoor footprint or teleport.
func enter_room(world: Dictionary, id: String) -> bool:
	if not room_layouts.has(id): return false
	room_id = id
	room_world = world.id
	map_key = ""
	settle_motion()
	center(world)
	return true

func leave_room(world: Dictionary) -> void:
	room_id = ""
	map_key = ""
	center(world)

func show_room(world: Dictionary, selected: String, continuous := true) -> void:
	clear_children(terrain)
	clear_children(actors)
	clear_people()
	map_key = ""
	var room: Dictionary = room_layouts[room_id]
	var w: float = room.width
	var h: float = room.height
	box(terrain, Vector3((w-1)/2, -0.15, (h+2)/2), Vector3(w, 0.3, h-3), painted_surfaces.get_material("wood"))
	# Back/side walls are full height; near walls are cut away for observation.
	box(terrain, Vector3((w-1)/2, 1.2, 2.4), Vector3(w, 2.4, 0.2), mat("f1ddba"))
	box(terrain, Vector3(0, 1.2, (h+2)/2), Vector3(0.2, 2.4, h-3), mat("f1ddba"))
	box(terrain, Vector3(w-1, 0.15, (h+2)/2), Vector3(0.2, 0.3, h-3), mat("f1ddba"))
	for x in range(int(w)):
		if x != int(room.entry.x): box(terrain, Vector3(x, 0.15, h-1), Vector3(1,0.3,0.2), mat("f1ddba"))
	var bed_cells := {}
	for slot in room.slots:
		if slot.kind != "bed": continue
		# Bed footprint is defined by roomLayout's blocked cells, not resident position.
		for x in range(int(slot.at.x)-1, int(slot.at.x)+1):
			for y in range(int(slot.at.y)-2, int(slot.at.y)):
				var at := {"x":x,"y":y}
				if at in room.blocked:
					bed_cells[Vector2i(x,y)] = true
					box(terrain, Vector3(x,0.3,y), Vector3(0.96,0.6,0.96),mat("b0c1b3"))
	for at in room.blocked:
		if not bed_cells.has(Vector2i(at.x,at.y)):
			# Neutral obstacle marker: no invented table/care/kitchen furniture.
			box(terrain,Vector3(at.x,0.06,at.y),Vector3(0.9,0.12,0.9),mat("a79881"))
	for person in world.residents:
		if person.get("inside") != room_id or person.get("status") != "alive" or person.get("regionalLocation") != null or person.get("residency") == "outside": continue
		if not Snapshot.resident_room_position(person.get("roomAt"),room): continue
		var actor := create_person(person)
		actor.position = Vector3(person.roomAt.x,0,person.roomAt.y)
		actor.set_activity_pose(person, continuous and not world.get("clock", {}).get("paused", true))
		residents_root.add_child(actor)
		people[person.id] = actor
		actor.get_node("Selection").visible = person.id == selected
		var label := Label3D.new()
		label.font = UI_FONT
		label.text = Snapshot.resident_name(person) + " · " + Snapshot.activity_label(person)
		label.font_size = 24
		label.pixel_size = 0.01
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.position = actor.position + Vector3(0,2,0)
		actors.add_child(label)
