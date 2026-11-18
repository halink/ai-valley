extends Node3D
const Art = preload("res://valley_interface_style.gd")
const Craft = preload("res://valley_craft.gd")
const Architecture = preload("res://valley_architecture.gd")
const Botany = preload("res://valley_botany.gd")
const RoomArt = preload("res://valley_room_art.gd")
const Ground = preload("res://valley_ground.gd")
const PainterlyResident = preload("res://painterly_resident.gd")
# Read-only presentation: every interactive object is anchored to snapshot data.
const Snapshot = preload("res://snapshot.gd")
const Movement = preload("res://completed_movement.gd")
const MIST_BACKDROP = preload("res://art/valley-mists-v1.png")
const LONG_CREEK_BACKDROP = preload("res://art/long-creek-mists-v1.png")
const MEADOW = preload("res://art/courtyard-meadow-v1.png")
const GROUND_SHADER = preload("res://art/courtyard_ground.gdshader")
const SHADOW_SHADER = preload("res://art/courtyard_shadow.gdshader")
const TILE_COLORS := {"grass": 0, "path": 1, "water": 2, "soil": 3, "sand": 4, "road": 5, "bridge": 6, "cliff": 7}
var room_id := ""
var room_layouts := {}
var room_world := ""
var show_place_labels := false
var camera: Camera3D
var sun: DirectionalLight3D
var backdrop: TextureRect
var environment_preview: Dictionary = {}
var sky_environment: Environment
var building_doors := {}
var plot_positions := {}
var resource_positions := {}
var terrain: Node3D
var actors: Node3D
var focus := Vector3(16, 0, 12)
var map_key := ""
var people := {}
var residents_root: Node3D
var motions := {}
var last_revision := -1
var camera_focus := Vector3(16, 0, 12)
var camera_size := 26.0
var outdoor_focus := Vector3.ZERO
var outdoor_size := 26.0
var outdoor_span := Vector2.ZERO
var outdoor_fit := true
var outdoor_dimensions := Vector2i.ZERO
var frame_span := Vector2.ZERO
var fit_view := true
const CAMERA_BOOM := Vector3(23, 32, 31)
const SNAPSHOT_SECONDS := 2.0
const WALK_PLAYBACK_SECONDS := SNAPSHOT_SECONDS + 0.25
const DOORWAY_SECONDS_PER_TILE := 0.35

var craft := Craft.new()
var architecture := Architecture.new(craft)
var plants := Botany.new(craft, CAMERA_BOOM)
var room_art := RoomArt.new(craft, architecture)
var room_terrain_key := ""
var garden_key := 0

const DOORWAY_PLAYBACK_SECONDS := .82
# Replay confirmed travel over the snapshot interval, including partial steps.
func _process(delta: float) -> void:
	var ease := 1.0 - exp(-10.0 * delta)
	if fit_view:
		camera_size = _fitted_size()
	camera_focus = camera_focus.lerp(focus, ease)
	camera.size = lerpf(camera.size, camera_size, ease)
	position_camera()
	for id in people:
		if not motions.has(id): people[id].advance_activity(delta)
	for id in motions.keys():
		var motion: Dictionary = motions[id]
		motion.elapsed = minf(motion.duration, motion.elapsed + maxf(delta, 0.0))
		var offsets: PackedFloat32Array = motion.offsets
		var distance: float = motion.elapsed / motion.duration * offsets[-1]
		var edge: int = motion.edge
		while edge < offsets.size() - 2 and distance >= offsets[edge + 1]:
			edge += 1
		motion.edge = edge
		motion.distance = distance
		var weight := inverse_lerp(offsets[edge], offsets[edge + 1], distance)
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
		actor.present_pose(true, fposmod(motion.phase + distance * TAU, TAU))
		if motion.elapsed >= motion.duration:
			motions.erase(id)
			actor.present_pose(false, 0.0)
	var height := maxf(1.0, get_viewport().get_visible_rect().size.y)
	for actor in people.values():
		actor.advance_spacing(delta)
		var caption: Label3D = actor.presentation.get_node("NameCaption")
		if caption.visible:
			caption.pixel_size = minf(.012, 25.0 * camera.size / (height * caption.font_size))

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

static func _walk_points(path: Array) -> Array[Vector3]:
	var points: Array[Vector3] = []
	for at in path:
		points.append(Vector3(at.x, 0, at.y))
	return points

func _start_walk(id: String, points: Array[Vector3], doorway := false) -> float:
	if points.size() < 2 or not people.has(id): return 0.0
	var actor: PainterlyResident = people[id]
	var playing: Dictionary = motions.get(id, {})
	var anchor: Vector3 = actor.position if playing.is_empty() else playing.path[-1]
	if not points[0].is_equal_approx(anchor):
		var first := points[0]
		var next := points[1]
		if not is_equal_approx(first.distance_to(anchor) + anchor.distance_to(next), first.distance_to(next)):
			return 0.0
		points[0] = anchor
	var phase := 0.0
	if not playing.is_empty():
		var remainder: Array[Vector3] = [actor.position]
		remainder.append_array(playing.path.slice(playing.edge + 1))
		remainder.append_array(points.slice(1))
		points = remainder
		phase = fposmod(playing.phase + playing.distance * TAU, TAU)
	if points.size() > 2 * (Movement.MAX_ACTOR_STEPS + 2): return 0.0
	var path: Array[Vector3] = [points[0]]
	var offsets := PackedFloat32Array([0.0])
	for point in points.slice(1):
		var distance := path[-1].distance_to(point)
		if distance <= 0.00001: continue
		path.append(point)
		offsets.append(offsets[-1] + distance)
	if path.size() < 2: return 0.0
	var duration := WALK_PLAYBACK_SECONDS
	if doorway: duration = minf(DOORWAY_PLAYBACK_SECONDS, DOORWAY_SECONDS_PER_TILE * offsets[-1])
	motions[id] = {"path":path, "offsets":offsets, "elapsed":0.0, "duration":duration,
		"edge":0, "distance":0.0, "angle":actor.rotation.y, "phase":phase}
	return duration

# The short offset belongs to the rendered threshold, not the resident's grid position.
func walk_doorway(id: String, path: Array, offset: Vector3, arriving: bool) -> float:
	if path.is_empty() or not people.has(id): return 0.0
	var points := _walk_points(path)
	if arriving:
		var actor: PainterlyResident = people[id]
		actor.position = points[0] - offset
		actor.rotation.y = atan2(-offset.x, -offset.z)
		points.push_front(actor.position)
		var target: Vector3 = actor.get_meta("target", points[-1])
		if not target.is_equal_approx(points[-1]): points.append(target)
	else:
		points.append(points[-1] + offset)
	return _start_walk(id, points, true)

func match_follow_view(id: String, size: float) -> void:
	if focus_resident(id):
		fit_view = false
		camera_size = size
		_settle_camera()

func _travel_position(person: Dictionary, cell: Vector3, world: Dictionary, room: Dictionary) -> Vector3:
	var activity: Variant = person.get("activity")
	if not activity is Dictionary: return cell
	var route: Variant = activity if room.is_empty() else activity.get("room")
	if not route is Dictionary or not route.get("path") is Array or route.path.is_empty(): return cell
	if not room.is_empty() and route.get("buildingId") != room_id: return cell
	var progress: Variant = route.get("travelProgress" if room.is_empty() else "progress")
	if not Movement.nonnegative_number(progress) or progress <= 0.0 or progress >= 1.0: return cell
	var at: Variant = route.path[0]
	if room.is_empty():
		if not Movement.point(at, world): return cell
	elif not Snapshot.resident_room_position(at, room):
		return cell
	var next := Vector3(at.x, 0, at.y)
	if absf(next.x - cell.x) + absf(next.z - cell.z) != 1.0: return cell
	return cell.lerp(next, float(progress))

func _show_resident(person: Dictionary, cell: Vector3, world: Dictionary, path: Array, animate: bool, pose_enabled: bool, room: Dictionary = {}) -> void:
	var id: String = person.id
	var target := _travel_position(person, cell, world, room)
	var actor: PainterlyResident = people.get(id)
	var created := actor == null
	if created:
		actor = create_person(person)
		residents_root.add_child(actor)
		people[id] = actor
		_add_resident_caption(actor, person)
		actor.position = target
	if created or actor.get_meta("target", target) != target or not path.is_empty():
		var points := _walk_points(path)
		var duration := 0.0
		if animate:
			if points.is_empty() and not created and actor.get_meta("cell", cell) == cell:
				points = [cell]
			if not points.is_empty() and points[-1] == cell:
				if not target.is_equal_approx(cell): points.append(target)
				if created: actor.position = points[0]
				duration = _start_walk(id, points)
		if duration == 0.0:
			motions.erase(id)
			actor.position = target
	actor.update_appearance(person)
	actor.update_provisions(person, world, room)
	if not room.is_empty(): actor.update_bed_pose(person, room)
	actor.set_activity_pose(person, pose_enabled, not motions.has(id))
	actor.set_meta("cell", cell)
	actor.set_meta("target", target)

func _finish_residents(visible_ids: Dictionary, selected: String, settle_spacing: bool) -> void:
	for id in people.keys():
		if not visible_ids.has(id):
			motions.erase(id)
			residents_root.remove_child(people[id])
			people[id].queue_free()
			people.erase(id)
	_space_residents(settle_spacing)
	select_resident(selected)

func _ready() -> void:
	terrain = Node3D.new()
	add_child(terrain)
	residents_root = Node3D.new()
	add_child(residents_root)
	actors = Node3D.new()
	add_child(actors)
	camera = Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = camera_size
	camera.far = 200
	add_child(camera)
	camera.current = true
	position_camera()
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-49, -40, 0)
	sun.shadow_blur = 2.3
	sun.shadow_opacity = .74
	sun.light_color = Color("fff4e4")
	sun.light_energy = 0.68
	sun.shadow_enabled = true
	add_child(sun)
	var sheet := CanvasLayer.new()
	sheet.layer = -1
	add_child(sheet)
	backdrop = TextureRect.new()
	backdrop.texture = MIST_BACKDROP
	backdrop.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	backdrop.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sheet.add_child(backdrop)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var environment := WorldEnvironment.new()
	var env := Environment.new()
	sky_environment = env
	env.background_mode = Environment.BG_CANVAS
	env.background_canvas_max_layer = -1
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("d8e0d6")
	env.ambient_light_energy = 0.51
	environment.environment = env
	add_child(environment)

# Presentation only: consume the same authoritative minute as the observer clock.
# No wall-clock interpolation: paused or disconnected worlds retain their light.
func update_daylight(world: Dictionary) -> void:
	var minute = world.get("minute")
	if not (minute is int or minute is float) or not is_finite(minute) or minute < 0 or minute > 9007199254740991:
		return
	if not environment_preview.is_empty():
		var level: float = environment_preview.daylightPermille / 1000.0
		var cloud: float = environment_preview.cloudPermille / 1000.0
		# Readability exposure is not sunlight or crop energy. No moving particles.
		sun.light_energy = lerpf(0.29, 0.68, level)
		sun.light_color = Color("b9c7dd").lerp(Color("fff4e4"), level).lerp(Color("c6d0d4"), cloud * .22)
		backdrop.modulate = Color("acbbcc").lerp(Color.WHITE, level).lerp(Color("b4bfc2"), cloud * .24)
		sky_environment.ambient_light_color = Color("a6b5d3").lerp(Color("d8e0d6"), level)
		sky_environment.ambient_light_energy = lerpf(0.56, 0.51, level)
		return
	var hour := fmod(float(minute), 1440.0) / 60.0
	var elevation := sin((hour - 6.0) / 24.0 * TAU)
	var daylight := smoothstep(-0.15, 0.35, elevation)
	var twilight := (1.0 - absf(daylight * 2.0 - 1.0))
	# Keep the hand-painted scene readable at night; this is not real moonlight.
	sun.light_energy = lerpf(0.29, 0.68, daylight)
	sun.light_color = Color("acc2e4").lerp(Color("fff4e4"), daylight).lerp(Color("f5bd91"), twilight * .35)
	backdrop.modulate = Color("acbbcc").lerp(Color.WHITE, daylight).lerp(Color("f2dfc9"), twilight * .38)
	sky_environment.ambient_light_color = Color("a6b5d3").lerp(Color("d8e0d6"), daylight)
	sky_environment.ambient_light_energy = lerpf(0.56, 0.51, daylight)

func position_camera() -> void:
	camera.position = camera_focus + CAMERA_BOOM
	camera.look_at(camera_focus)

func _settle_camera() -> void:
	camera_focus = focus
	camera.size = camera_size
	position_camera()

func _fitted_size() -> float:
	var viewport := get_viewport().get_visible_rect().size
	var width := maxf(viewport.x - 100, 1)
	var height := maxf(viewport.y - 154, 1)
	var scale_factor := maxf(frame_span.x / width, frame_span.y / height)
	return maxf(viewport.y * scale_factor, 9.0)

static func _is_long_valley(world: Dictionary) -> bool:
	return str(world.id).begins_with("godot-mvp-") and world.map.width == 48 and world.map.height == 36

func center(world: Dictionary, immediate := false) -> void:
	if world.is_empty(): return
	fit_view = true
	var extents: Vector3
	if room_layouts.has(room_id):
		var room: Dictionary = room_layouts[room_id]
		focus = Vector3((room.width - 1) * .5, .9, (room.height + 1) * .5)
		extents = Vector3(room.width + .65, 2.9, room.height - 1)
	else:
		focus = Vector3((world.map.width - 1) * .5, .9, (world.map.height - 1) * .5)
		extents = Vector3(world.map.width + 1.8, 4.7, world.map.height + 1.8)
		if _is_long_valley(world):
			focus.y = 1.25
			extents = Vector3(world.map.width + 3.0, 5.6, world.map.height + 2.4)
	var back := CAMERA_BOOM.normalized()
	var right := Vector3.UP.cross(back).normalized()
	var up := back.cross(right)
	frame_span = Vector2(extents.dot(right.abs()), extents.dot(up.abs()))
	camera_size = _fitted_size()
	if immediate or not room_id.is_empty(): _settle_camera()

func pan(delta: Vector2) -> void:
	fit_view = false
	var scale_factor := camera.size / get_viewport().get_visible_rect().size.y
	var up := Vector3(camera.global_basis.y.x, 0, camera.global_basis.y.z)
	var offset := (camera.global_basis.x * delta.x + up * delta.y / maxf(up.length_squared(), .2)) * scale_factor
	camera_focus -= offset
	focus = camera_focus
	position_camera()

func close_view() -> void:
	fit_view = false
	camera_size = 10.5

func zoom(direction: float) -> void:
	fit_view = false
	camera_size = clampf(camera_size * direction, 5.0, maxf(100.0, _fitted_size()))

# Only focus actors already rendered from the current validated snapshot.
# Do not infer an outdoor location for indoor, absent or unknown residents.
func focus_resident(id: String) -> bool:
	if not people.has(id): return false
	var actor: Node3D = people[id]
	focus = actor.position + Vector3(.8, .65, -.65)
	return true

func frame_building(id: String) -> void:
	if not building_doors.has(id): return
	fit_view = false
	focus = building_doors[id] + Vector3(-.8, .6, -1.5)
	camera_size = 18.5

func building_screen_position(id: String) -> Vector2:
	if not building_doors.has(id): return Vector2(-10000, -10000)
	return camera.unproject_position(building_doors[id])

# Plot navigation only uses garden meshes rendered from the current snapshot.
func frame_plot(id: String) -> void:
	if not room_id.is_empty() or not plot_positions.has(id): return
	fit_view = false
	focus = plot_positions[id] + Vector3(0, .3, 0)
	camera_size = 10.5

func plot_screen_position(id: String) -> Vector2:
	if not room_id.is_empty() or not plot_positions.has(id): return Vector2(-10000, -10000)
	return camera.unproject_position(plot_positions[id] + Vector3(0, .18, 0))

# Resource anchors refer only to the rendered, supported outdoor sources.
func frame_resource(id: String) -> void:
	if not room_id.is_empty() or not resource_positions.has(id): return
	fit_view = false
	focus = resource_positions[id] + Vector3(0, .3, 0)
	camera_size = 10.5

func resource_screen_position(id: String) -> Vector2:
	if not room_id.is_empty() or not resource_positions.has(id): return Vector2(-10000, -10000)
	return camera.unproject_position(resource_positions[id] + Vector3(0, .18, 0))

func select_resident(id: String) -> void:
	for key in people:
		var actor: Node3D = people[key]
		var on_bed: bool = actor.activity_pose == "rest" and actor.bed_pose != null
		actor.presentation.get_node("Selection").visible = key == id and not on_bed
		var label: Label3D = actor.presentation.get_node_or_null("NameCaption")
		if label != null:
			label.position.y = 3.2 if on_bed else 2.12
			label.visible = key == id

func clear_children(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()

func show_world(world: Dictionary, selected: String, continuous := true, paths: Dictionary = {}) -> void:
	update_daylight(world)
	if not room_id.is_empty() and (world.get("id", "") != room_world or not room_layouts.has(room_id)):
		room_id = ""
		map_key = ""
		center(world)
	if not room_id.is_empty():
		backdrop.texture = MIST_BACKDROP
		show_room(world, selected, continuous, paths)
		return
	if world.is_empty():
		backdrop.texture = MIST_BACKDROP
		clear_children(terrain)
		clear_children(actors)
		clear_people()
		last_revision = -1
		map_key = ""
		building_doors.clear()
		plot_positions.clear()
		resource_positions.clear()
		return
	var key := str(world.id) + ":" + str(world.get("mapRevision", 0)) + ":" + str(hash(world.map)) + ":" + str(hash(world.get("buildings", [])))
	var reset := key != map_key
	if reset:
		clear_people()
		room_terrain_key = ""
		map_key = key
		clear_children(terrain)
		backdrop.texture = LONG_CREEK_BACKDROP if _is_long_valley(world) else MIST_BACKDROP
		build_terrain(world)
	# The landscape and its props are static across resident-only updates.
	var names: Array = []
	for person in world.get("residents", []):
		names.append([person.id, person.get("name", "")])
	var prop_key := hash([world.get("resources", []), world.get("plots", []),
		world.get("definitions", {}), names, floorf(float(world.minute) / 1440)])
	if reset or prop_key != garden_key:
		garden_key = prop_key
		clear_children(actors)
		draw_gardens(world)
		draw_resources(world)
		craft.batch(actors)
	var revision := int(world.get("revision", 0))
	var pose_enabled: bool = continuous and not world.get("clock", {}).get("paused", true)
	var animate := pose_enabled and not reset and revision > last_revision
	if not pose_enabled: settle_motion()
	last_revision = revision
	var visible_ids := {}
	for person in world.get("residents", []):
		if not Snapshot.visible(person): continue
		var target := Vector3(person.at.x, 0, person.at.y)
		if target.x < 0 or target.z < 0 or target.x >= world.map.width or target.z >= world.map.height: continue
		visible_ids[person.id] = true
		_show_resident(person, target, world, paths.get(person.id, []), animate, pose_enabled)
	_finish_residents(visible_ids, selected, false)

# Optional detailed annotations, off by default so scenery reads as a place.
func set_place_labels(enabled: bool) -> void:
	show_place_labels = enabled
	for label in get_tree().get_nodes_in_group("valley_place_labels"):
		label.visible = enabled

func style_caption(label: Label3D, place := false) -> void:
	label.font = Art.hand()
	label.font_size = 36
	label.pixel_size = .012
	label.modulate = Color("293d32")
	label.outline_modulate = Color("f2e8cf")
	label.outline_size = 6
	label.no_depth_test = true
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	if place:
		label.add_to_group("valley_place_labels")
		label.visible = show_place_labels

func create_person(person: Dictionary) -> PainterlyResident:
	var actor := PainterlyResident.new()
	actor.construct(person)
	var ring := TorusMesh.new()
	ring.inner_radius = .398
	ring.outer_radius = .426
	var selection := craft.mesh(actor.presentation, ring, Vector3(0, .036, 0), craft.mat("e8c57f"))
	selection.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	selection.name = "Selection"
	return actor

func build_terrain(world: Dictionary) -> void:
	var map: Dictionary = world.map
	building_doors.clear()
	var dimensions := Vector2i(map.width, map.height)
	var map_center := Vector3((dimensions.x - 1) * .5, 0, (dimensions.y - 1) * .5)
	var hamlet: bool = world.get("buildings", []).any(func(building): return building.get("id") == "mvp-plum-house")
	var long_valley := _is_long_valley(world)
	_build_ground(world, dimensions, map_center, hamlet, long_valley)
	if long_valley:
		Ground.build_footbridges(terrain, craft, map)
		plants.long_valley(terrain, world)
	else:
		plants.build_rim(terrain, map)
	for building in world.get("buildings", []):
		building_doors[str(building.id)] = architecture.build(terrain, building, map)
	plants.courtyard(terrain, world)
	if hamlet and not long_valley: plants.hamlet(terrain, world)

func _build_ground(world: Dictionary, dimensions: Vector2i, center: Vector3, hamlet: bool, long_valley: bool) -> void:
	var map: Dictionary = world.map
	var tile_image := Image.create_empty(dimensions.x, dimensions.y, false, Image.FORMAT_R8)
	var wash_image := Image.create_empty(dimensions.x, dimensions.y, false, Image.FORMAT_RGBA8) if hamlet else null
	for y in range(dimensions.y):
		for x in range(dimensions.x):
			var index: int = TILE_COLORS.get(map.tiles[y * dimensions.x + x], 0)
			# The two river mouths reach the edge of the diorama. The grid's rim remains closed.
			if long_valley and y in [0, dimensions.y - 1]:
				var inner := clampi(y, 1, dimensions.y - 2)
				if map.tiles[inner * dimensions.x + x] == "water": index = TILE_COLORS.water
			tile_image.set_pixel(x, y, Color(index / 255.0, 0, 0))
			if wash_image != null:
				var water := index == 2 or (long_valley and index == 6)
				wash_image.set_pixel(x, y, Color(float(index in [1,5]), float(index == 5), float(water), float(index == 4)))
	var paint := ShaderMaterial.new()
	paint.shader = GROUND_SHADER
	paint.set_shader_parameter("tile_map", ImageTexture.create_from_image(tile_image))
	paint.set_shader_parameter("meadow", MEADOW)
	paint.set_shader_parameter("map_size", Vector2(dimensions))
	paint.set_shader_parameter("hamlet", hamlet)
	paint.set_shader_parameter("long_valley", long_valley)
	if not Snapshot.garden_layout(map).is_empty():
		var beds: Array[Vector2] = []
		for plot in world.get("plots", []):
			if str(plot.get("id", "")).begins_with("mvp-garden-"):
				beds.append(Vector2(plot.at.x, plot.at.y) + Vector2.ONE * .5)
		if beds.size() >= 2:
			var area := Rect2(beds[0], Vector2.ZERO)
			for bed in beds: area = area.expand(bed)
			paint.set_shader_parameter("garden_bounds", Vector4(area.position.x, area.position.y, area.end.x, area.end.y))
	if wash_image != null: paint.set_shader_parameter("terrain_wash", ImageTexture.create_from_image(wash_image))
	if hamlet:
		Ground.hamlet(terrain, craft, dimensions, paint, long_valley)
	else:
		var ground := PlaneMesh.new()
		ground.size = Vector2(dimensions)
		craft.mesh(terrain, ground, center + Vector3(0, .012, 0), paint)
		craft.box(terrain, center - Vector3.UP * .28, Vector3(dimensions.x, .55, dimensions.y), craft.mat("8e8069"))
		craft.box(terrain, center - Vector3.UP * .517, Vector3(dimensions.x + .055, .086, dimensions.y + .055), craft.mat("7b6a54"))
		craft.box(terrain, center + Vector3(0, -.58, 0), Vector3(dimensions.x + .22, .10, dimensions.y + .22), craft.mat("655744"))
	var veil := ShaderMaterial.new()
	veil.shader = SHADOW_SHADER
	veil.set_shader_parameter("board_size", Vector2(dimensions))
	var shadow := PlaneMesh.new()
	shadow.size = Vector2(dimensions) + Vector2(14, 14)
	var depth := 1.12 if long_valley else (.86 if hamlet else .66)
	var paper_shadow := craft.mesh(terrain, shadow, center - Vector3(0, depth, 0), veil)
	paper_shadow.name = "PaperShadow"
	paper_shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

# CPU triangle queries use the same opaque mesh geometry as rendering. No
# physics bodies/step lag: playback, rotations and camera changes apply now.
# Labels and the selection ring are annotations, not pick/occlusion surfaces.
func pick(screen: Vector2) -> Dictionary:
	var origin := camera.project_ray_origin(screen)
	var direction := camera.project_ray_normal(screen)
	var nearest := camera.far
	var result := {}
	var pending: Array[Node] = [terrain, actors, residents_root]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		if node is Node3D and not node.is_visible_in_tree(): continue
		pending.append_array(node.get_children())
		if not node is MeshInstance3D or node.name in ["Selection", "PaperShadow"]: continue
		var item := node as MeshInstance3D
		if item.mesh == null: continue
		var inverse := item.global_transform.affine_inverse()
		var local_origin := inverse * origin
		var local_direction := (inverse.basis * direction).normalized()
		if item.get_aabb().intersects_ray(local_origin, local_direction) == null: continue
		if not item.mesh.has_meta("pick_triangles"):
			item.mesh.set_meta("pick_triangles", item.mesh.generate_triangle_mesh())
		var triangles: TriangleMesh = item.mesh.get_meta("pick_triangles")
		var hit := triangles.intersect_ray(local_origin, local_direction)
		if hit.is_empty(): continue
		if item.has_meta("foliage_pixels") and not Botany.visible_texel(item, hit.position): continue
		var point: Vector3 = item.global_transform * hit.position
		var distance := (point-origin).dot(direction)
		if distance < 0 or distance >= nearest: continue
		nearest = distance
		result = {}
		var owner_node: Node = item
		while owner_node != self:
			if owner_node.has_meta("resident_id"):
				result = {"resident": owner_node.get_meta("resident_id")}
				break
			if owner_node.has_meta("building_id"):
				var id: String = owner_node.get_meta("building_id")
				if not id.is_empty(): result = {"building": id}
				break
			if owner_node.has_meta("plot_id") and room_id.is_empty():
				result = {"plot": owner_node.get_meta("plot_id")}
				break
			if owner_node.has_meta("resource_id") and room_id.is_empty():
				result = {"resource": owner_node.get_meta("resource_id")}
				break
			owner_node = owner_node.get_parent()
	return result

# Cutaway presentation in room coordinates, not an outdoor footprint or teleport.
func enter_room(world: Dictionary, id: String) -> bool:
	if not room_layouts.has(id): return false
	if room_id.is_empty():
		outdoor_focus = focus
		outdoor_size = camera_size
		outdoor_span = frame_span
		outdoor_fit = fit_view
		outdoor_dimensions = Vector2i(world.map.width, world.map.height)
	room_id = id
	room_world = world.id
	map_key = ""
	settle_motion()
	center(world)
	return true

func leave_room(world: Dictionary) -> void:
	if room_id.is_empty(): return
	room_id = ""
	map_key = ""
	if Vector2i(world.map.width, world.map.height) != outdoor_dimensions:
		center(world, true)
		return
	focus = outdoor_focus
	camera_size = outdoor_size
	frame_span = outdoor_span
	fit_view = outdoor_fit
	if fit_view: camera_size = _fitted_size()
	_settle_camera()

func show_room(world: Dictionary, selected: String, continuous := true, paths: Dictionary = {}) -> void:
	map_key = ""
	var room: Dictionary = room_layouts[room_id]
	var shared := false
	for building in world.get("buildings", []):
		if building.get("id") == room_id:
			shared = building.get("kind") == "lodge"
			break
	var dining: bool = world.get("mvpRooms", {}).get("version", 0) == 1
	var key := str([world.id, room_id, hash(room), shared, dining])
	var reset := key != room_terrain_key
	if reset:
		clear_people()
		room_terrain_key = key
		clear_children(terrain)
		room_art.build(terrain, room, shared, dining)
	clear_children(actors)
	room_art.paint_cooking(actors, world, room, room_id)
	room_art.paint_seeds(actors, world, room, room_id)
	var revision := int(world.revision)
	var pose_enabled: bool = continuous and not world.clock.paused
	var animate := pose_enabled and not reset and revision > last_revision
	if not pose_enabled: settle_motion()
	last_revision = revision
	var visible_ids := {}
	for person in world.residents:
		if person.get("inside") != room_id or person.get("status") != "alive" or person.get("regionalLocation") != null or person.get("residency") == "outside": continue
		if not Snapshot.resident_room_position(person.get("roomAt"),room): continue
		visible_ids[person.id] = true
		_show_resident(person, Vector3(person.roomAt.x, 0, person.roomAt.y), world, paths.get(person.id, []), animate, pose_enabled, room)
	_finish_residents(visible_ids, selected, reset)

func _add_resident_caption(actor: Node3D, person: Dictionary) -> void:
	var label := Label3D.new()
	label.name = "NameCaption"
	label.text = Snapshot.resident_name(person)
	style_caption(label)
	label.outline_size = 4
	label.position.y = 2.12
	actor.presentation.add_child(label)

# More than one resident can occupy a cell. Keep the actor root and confirmed
# path on that cell, while the visible figures stand apart within its bounds.
func _space_residents(settle := false) -> void:
	var cells := {}
	var ids := people.keys()
	ids.sort()
	for id in ids:
		var actor: PainterlyResident = people[id]
		actor.offset_goal = Vector3.ZERO
		if actor.activity_pose == "rest" and actor.bed_pose != null: continue
		var target: Vector3 = actor.get_meta("target", actor.position)
		var cell := Vector2i(roundi(target.x), roundi(target.z))
		if not cells.has(cell): cells[cell] = []
		cells[cell].append(actor)
	var screen_right := Vector3.UP.cross(CAMERA_BOOM).normalized()
	for group in cells.values():
		if group.size() < 2: continue
		for i in range(group.size()):
			group[i].offset_goal = screen_right.rotated(Vector3.UP, PI + i * TAU / group.size()) * .393
	if settle:
		for actor in people.values(): actor.advance_spacing(1.0)

# Each bed is an actual owned plot; growth and moisture come only from snapshots.
func draw_gardens(world: Dictionary) -> void:
	plot_positions.clear()
	var planned := not Snapshot.garden_layout(world.map).is_empty()
	for plot in world.get("plots", []):
		if not str(plot.id).begins_with("mvp-garden-"): continue
		var at := Vector3(plot.at.x,0,plot.at.y)
		var crop: Variant = plot.get("crop")
		var wet: bool = crop is Dictionary and crop.get("wateredDay",-1) == floorf(float(world.minute)/1440.0)
		var status := "空田"
		var growth := -1.0
		if crop is Dictionary:
			var definition: Dictionary = world.get("definitions", {}).get(crop.definition, {})
			var days: float = float(definition.get("data", {}).get("growthDays", 4))
			growth = clampf(float(crop.growth) / maxf(1, days), 0, 1)
			status = "成熟" if growth >= 1 else "生长 %s/%s 天" % [str(int(crop.growth)), str(int(days))]
			status += " · 已浇水" if wet else " · 未浇水"
		# Keep each bed in its own batch so geometry retains its plot identity.
		var bed := Node3D.new()
		bed.set_meta("plot_id", str(plot.id))
		actors.add_child(bed)
		plants.garden(bed, at, wet, growth, planned)
		craft.batch(bed)
		plot_positions[str(plot.id)] = at
		var owner := ""
		for person in world.get("residents", []):
			if person.id == plot.ownerId: owner = str(person.name)
		var label := Label3D.new()
		label.font = Art.hand()
		label.text = owner+"的田\n"+status.replace(" · ", "\n")
		label.position = at+Vector3(0,.18,1.55)
		style_caption(label, true)
		actors.add_child(label)

func draw_resources(world: Dictionary) -> void:
	resource_positions.clear()
	var well = Snapshot.garden_layout(world.map).get("well")
	for resource in world.get("resources", []):
		var at := Vector3(resource.at.x, 0, resource.at.y)
		# Batch each source separately: sharing a material must not merge identities.
		var source := Node3D.new()
		actors.add_child(source)
		if resource.kind in ["spring", "bush", "tree", "rock"]:
			source.set_meta("resource_id", str(resource.id))
			resource_positions[str(resource.id)] = at
		match resource.kind:
			"spring":
				if resource.id == "mvp-spring" and Snapshot.valid_position(well):
					var rim := Vector3(well.x, 0, well.y)
					plants.well(source, rim, at, float(resource.amount))
					resource_positions[str(resource.id)] = rim
					at = rim
				else:
					plants.spring(source, at, float(resource.amount))
			"bush":
				if resource.get("foodItem") == "fruit": plants.fruit_shrub(source, at, float(resource.amount))
				else: plants.berry_bush(source, at, float(resource.amount))
			"tree": plants.resource_tree(source, at, float(resource.amount))
			"rock": plants.resource_rock(source, at, float(resource.amount))
			_: craft.stone(source, at + Vector3.UP * .171, Vector3(.55, .42, .50), craft.mat("a7a397"), int(at.x + at.z))
		craft.batch(source)
		var label := Label3D.new()
		label.text = Snapshot.resource_place_name(world.map, resource) + "：" + str(resource.amount)
		label.position = at + Vector3(0, .18, 1.35)
		style_caption(label, true)
		actors.add_child(label)
