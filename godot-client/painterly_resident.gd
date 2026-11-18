extends Node3D
## Read-only actor presentation. The root stays at the authoritative cell.
const ResidentFigure = preload("res://resident_figure.gd")

static var vessel_meshes := {}
var figure: ResidentFigure
var presentation: Node3D
var body_scale := Vector3.ONE
var view_offset := Vector3.ZERO
var offset_goal := Vector3.ZERO
var activity_pose := "idle"
var activity_phase := 0.0
var carried_fruits := 0
var carried_food := 0
var carried_roots := 0
var carried_meals := 0
var carried_water := 0
var gathering_kind := ""
var action_item := ""
var dining := false
var bed_pose: Variant = null
var facing_target: Variant = null
var props: Node3D
var food_prop: MeshInstance3D
var meal_bowl: MeshInstance3D
var meal_surface: MeshInstance3D
var water_prop: MeshInstance3D
var basket: MeshInstance3D
var carried_berries: Array[MeshInstance3D] = []

static func paint(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.vertex_color_use_as_albedo = true
	material.roughness = 1.0
	material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	return material

# Vessel profile follows its outside and the recessed bowl interior.
# Rings are (radius_x, height, radius_z); closed caps, clockwise front faces.
static func loft(rings: Array[Vector3]) -> ArrayMesh:
	var key := str(rings)
	if vessel_meshes.has(key): return vessel_meshes[key]
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sides := 18
	for row in range(rings.size()-1):
		for side in range(sides):
			var corners := [
				Vector2i(row, side), Vector2i(row + 1, side),
				Vector2i(row + 1, side + 1), Vector2i(row, side + 1)
			]
			for index in [0, 2, 1, 0, 3, 2]:
				var corner: Vector2i = corners[index]
				var ring := rings[corner.x]
				var angle := TAU * corner.y / sides
				var value := .958 + sin(angle * 3.0 + corner.x * .39) * .036
				surface.set_color(Color(value, value, value))
				surface.set_uv(Vector2(float(corner.y) / sides, ring.y))
				surface.add_vertex(Vector3(cos(angle) * ring.x, ring.y, sin(angle) * ring.z))
	surface.generate_normals()
	var result := surface.commit()
	vessel_meshes[key] = result
	return result

func construct(person: Dictionary) -> void:
	var id := str(person.id)
	set_meta("resident_id", id)
	var variant := int(id.sha256_text().substr(62, 2).hex_to_int()) % 2
	set_meta("silhouette", variant)
	var hair_style: String = {"yan":"tie","tang":"pin"}.get(id, "")
	var wrapped := variant == 0 and hair_style.is_empty()
	rotation.y = -2.94 if wrapped else -2.23
	presentation = Node3D.new()
	presentation.name = "Presentation"
	if id == "tang": body_scale = Vector3(.91, .94, .91)
	if id == "yan": body_scale = Vector3(1.06, 1.02, 1.06)
	add_child(presentation)
	figure = ResidentFigure.new()
	presentation.add_child(figure)
	figure.construct(wrapped, hair_style)
	update_appearance(person)
	_build_provisions()

func _build_provisions() -> void:
	# Presentation vessels, not additional simulated inventory or equipment.
	props = Node3D.new()
	props.name = "Provisions"
	presentation.add_child(props)
	food_prop = provision(Vector3.ONE * .048, "b45858")
	meal_bowl = provision(Vector3.ONE, "d2bd8c")
	meal_bowl.mesh = loft([Vector3(0,-.07,0),Vector3(.08,-.07,.08),Vector3(.17,.05,.17),Vector3(.16,.08,.16),Vector3(.13,.03,.13),Vector3(0,.03,0)])
	meal_surface = provision(Vector3(.13,.015,.13),"af8650")
	water_prop = provision(Vector3.ONE, "9b6948")
	water_prop.mesh = loft([Vector3(0,-.12,0),Vector3(.10,-.12,.10),Vector3(.12,.02,.12),Vector3(.055,.12,.055),Vector3(.055,.19,.055),Vector3(0,.19,0)])
	basket = provision(Vector3.ONE,"b39058")
	basket.mesh = loft([Vector3(0,0,0),Vector3(.17,0,.10),Vector3(.20,.18,.12),Vector3(.17,.18,.09),Vector3(.14,.04,.07),Vector3(0,.04,0)])
	basket.position = Vector3(-.20,.64,.23)
	for i in range(3):
		var berry := provision(Vector3.ONE * .056, "b45858")
		berry.position = Vector3(-.24 + i*.085,.78,.21)
		carried_berries.append(berry)

func provision(size: Vector3, color: String) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var shape := SphereMesh.new()
	shape.radius = 1.0
	shape.height = 2.0
	shape.radial_segments = 10
	shape.rings = 5
	node.mesh = shape
	node.scale = size
	node.material_override = paint(Color(color))
	node.visible = false
	props.add_child(node)
	return node

func update_provisions(person: Dictionary, world: Dictionary, room: Dictionary = {}) -> void:
	var inventory: Dictionary = person.get("inventory", {})
	carried_food = maxi(0, int(inventory.get("berry", 0)))
	carried_fruits = maxi(0, int(inventory.get("fruit", 0)))
	carried_roots = maxi(0, int(inventory.get("turnip", 0)))
	carried_meals = maxi(0, int(inventory.get("meal", 0)))
	carried_water = maxi(0, int(inventory.get("water", 0)))
	gathering_kind = ""
	dining = false
	facing_target = null
	var activity: Variant = person.get("activity")
	if not activity is Dictionary: return
	var action: Dictionary = activity.get("action", {})
	action_item = str(action.get("item", ""))
	food_prop.material_override = paint(Color("e9d5a4" if action_item == "turnip" else "d7ad58" if action_item == "fruit" else "b45858"))
	food_prop.scale = Vector3.ONE * (.089 if action_item == "turnip" else .074 if action_item == "fruit" else .048)
	if action.get("type") == "eat" and action.get("mvpAtTable", false) and person.get("inside") != null and onsite_pose(person) == "eat":
		var at: Variant = person.get("roomAt")
		if room.get("style") == "hall":
			for slot in room.slots:
				if slot.kind == "seat" and slot.at == at:
					dining = true
					facing_target = Vector3(floorf(float(room.width) * .5) - .5,0,6.5)
		else:
			for b in world.get("buildings", []):
				if b.id == person.inside and b.id == person.get("homeId"):
					var index: int = b.residents.find(person.id)
					var cx := floorf(maxf(16,float(b.width)*2)/2)
					if index in [0,1] and at is Dictionary and at.x == cx-1+index*2 and at.y == 8:
						dining = true
						facing_target = Vector3(at.x,0,at.y-1)
	if action.get("type") == "gather":
		for source in world.get("resources", []):
			if source.id == action.get("resourceId"):
				gathering_kind = str(source.kind)
				facing_target = Vector3(source.at.x,0,source.at.y)
	elif action.get("type") in ["cook", "mvpCollectSeed", "mvpSaveSeed"] and person.get("roomAt") is Dictionary:
		facing_target = Vector3(person.roomAt.x,0,person.roomAt.y-1)
	elif action.get("type") in ["plant", "water", "harvest"]:
		for plot in world.get("plots", []):
			if plot.id == action.get("plotId"):
				facing_target = Vector3(plot.at.x,0,plot.at.y-1)
	elif action.get("type") == "talk":
		for other in world.get("residents", []):
			if other.id == action.get("targetId") and other.get("inside") == person.get("inside"):
				var at: Variant = other.get("roomAt") if person.get("inside") != null else other.get("at")
				if at is Dictionary: facing_target = Vector3(at.x,0,at.y)

# The simulation stands at a reserved bedside interaction cell. Only the body
# geometry occupies that bed; root/selection and all pathing remain unchanged.
func update_bed_pose(person: Dictionary, room: Dictionary) -> void:
	bed_pose = null
	if onsite_pose(person) != "rest": return
	var activity: Dictionary = person.activity
	var pinned: Variant = activity.get("mvpBed")
	var journey: Variant = activity.get("room")
	if not pinned is Dictionary: return
	if pinned.get("buildingId") != person.get("inside"): return
	if journey is Dictionary and journey.get("buildingId") != person.get("inside"): return
	for slot in room.get("slots", []):
		if slot.get("kind") != "bed" or slot.get("key") != "bed:" + str(int(pinned.get("index", -1))): continue
		if slot.at != person.get("roomAt"): return
		if journey is Dictionary and slot.at != journey.get("target"): return
		# Match the four occupied cells used by the rendered mattress.
		for x in range(int(slot.at.x)-1, int(slot.at.x)+1):
			for y in range(int(slot.at.y)-2, int(slot.at.y)):
				var occupied := false
				for cell in room.get("blocked", []):
					if cell.x == x and cell.y == y: occupied = true
				if not occupied: return
		bed_pose = Transform3D(Basis(Vector3.RIGHT, PI/2), Vector3(-.5,.83,-2.32))
		return

func advance_activity(delta: float) -> void:
	if activity_pose != "idle":
		activity_phase += maxf(delta, 0.0) * 2.8
		if facing_target is Vector3 and activity_pose in ["gather", "talk", "eat", "plant", "water", "harvest", "cook", "seed_collect", "seed_save"]:
			var direction: Vector3 = facing_target - position
			if direction.length_squared() > .01:
				rotation.y = lerp_angle(rotation.y, atan2(-direction.x,-direction.z), minf(delta*6.0,1.0))
		present_pose(false, activity_phase)

func update_appearance(person: Dictionary) -> void:
	figure.apply_appearance(person.get("appearance", {}))

func advance_spacing(delta: float) -> void:
	if view_offset == Vector3.ZERO and offset_goal == Vector3.ZERO: return
	view_offset = view_offset.move_toward(offset_goal, delta * 2.4)
	presentation.position = Basis(Vector3.UP, -rotation.y) * view_offset

static func onsite_pose(person: Dictionary) -> String:
	var activity: Variant = person.get("activity")
	if not activity is Dictionary or not activity.get("path") is Array or not activity.path.is_empty(): return "idle"
	var room: Variant = activity.get("room")
	if room != null and (not room is Dictionary or not room.get("path") is Array or not room.path.is_empty() or room.get("mode") == "exit"): return "idle"
	var remaining: Variant = activity.get("remaining")
	if not (remaining is int or remaining is float) or not is_finite(remaining) or remaining <= 0: return "idle"
	var action: Variant = activity.get("action")
	if not action is Dictionary: return "idle"
	match action.get("type"):
		"gather": return "gather"
		"cook": return "cook"
		"mvpCollectSeed": return "seed_collect"
		"mvpSaveSeed": return "seed_save"
		"plant": return "plant"
		"water": return "water"
		"harvest": return "harvest"
		"eat": return "eat"
		"talk": return "talk"
		"mvpDrink": return "drink"
		"sleep":
			if person.get("inside") != null and person.get("roomAt") is Dictionary: return "rest"
	return "idle"

func set_activity_pose(person: Dictionary, enabled: bool, redraw := true) -> void:
	var next_pose := onsite_pose(person) if enabled else "idle"
	if next_pose != activity_pose: activity_phase = 0.0
	activity_pose = next_pose
	if redraw: present_pose(false, activity_phase)

func present_pose(walking: bool, phase: float) -> void:
	figure.relax()
	figure.scale = body_scale
	var eating := not walking and activity_pose == "eat"
	var drinking := not walking and activity_pose == "drink"
	var drawing_water := not walking and activity_pose == "gather" and gathering_kind == "spring"
	var resting := not walking and activity_pose == "rest" and bed_pose is Transform3D
	food_prop.visible = eating and ((action_item == "berry" and carried_food > 0) or (action_item == "fruit" and carried_fruits > 0) or (action_item == "turnip" and carried_roots > 0))
	meal_bowl.visible = eating and action_item == "meal" and carried_meals > 0
	meal_surface.visible = meal_bowl.visible
	water_prop.visible = not resting and (carried_water > 0 or drawing_water)
	basket.visible = not resting and carried_food > 0
	for i in range(carried_berries.size()): carried_berries[i].visible = basket.visible and carried_food > i

	if walking:
		figure.walk(phase)
	else:
		_pose_activity(phase, resting)

	var waist := figure.belt()
	water_prop.position = waist * Vector3(.223, -.040, .148)
	water_prop.rotation = Vector3.ZERO
	basket.position = waist * Vector3(-.220, -.115, .151)
	for i in range(carried_berries.size()):
		carried_berries[i].position = waist * Vector3(-.308 + i * .083, .014, .163)
	if eating or drinking or drawing_water or (not walking and activity_pose == "water"):
		_pose_held_item(eating, drinking, drawing_water)

func _pose_activity(phase: float, resting: bool) -> void:
	match activity_pose:
		"gather":
			var water := gathering_kind == "spring"
			figure.torso.rotation.x = -.60 if water else -.35
			figure.head.rotation.x = -.16 if water else -.11
			figure.reach(0, .24 + sin(phase) * .10, .38, .12)
			figure.reach(1, .39 + sin(phase + .3) * .26, .44, .21)
		"seed_collect", "seed_save":
			figure.torso.rotation.x = -.22
			figure.head.rotation.x = -.24
			var sweep := .12 if activity_pose == "seed_save" else .05
			figure.reach(0, .47 + sin(phase) * sweep, .69, .24)
			figure.reach(1, .55 + sin(phase + 1.2) * sweep, .73, .21)
		"cook":
			figure.torso.rotation.x = -.12
			figure.head.rotation.x = -.16
			figure.reach(0, .50, .82 + sin(phase) * .17, .26)
			figure.reach(1, .59, .78 + sin(phase + .9) * .22, .23)
		"plant", "water", "harvest":
			figure.torso.rotation.x = -.46 if activity_pose == "water" else -.59
			figure.head.rotation.x = -.13
			figure.reach(0, .32 + sin(phase) * .10, .48, .17)
			figure.reach(1, .43 + sin(phase + .6) * .17, .67, .16)
		"eat", "drink":
			if dining: figure.sit()
			var sip := activity_pose == "drink"
			figure.torso.rotation.x = -.09 if sip else -.15
			figure.head.rotation.x = .06 if sip else -.13
			figure.reach(1, 1.08 if sip else .83, 1.39 + sin(phase) * .10, .64)
			if meal_bowl.visible: figure.reach(0, .73, 1.18, .63)
		"talk":
			figure.torso.rotation.y = sin(phase * .6) * .064
			figure.reach(1, .54, .76 + sin(phase) * .26, .26)
		"rest":
			if resting:
				# Cancel root yaw while leaving the world anchor at the bedside cell.
				var lying: Transform3D = Transform3D(Basis(Vector3.UP, -rotation.y), Vector3.ZERO) * bed_pose
				lying.basis = lying.basis.scaled_local(body_scale)
				figure.transform = lying
			else:
				figure.head.rotation.x = -.28

func _pose_held_item(eating: bool, drinking: bool, drawing_water: bool) -> void:
	var hand := figure.grip(1)
	if eating:
		food_prop.position = hand * Vector3(0, -.022, -.028)
		if meal_bowl.visible:
			var other := figure.grip(0)
			meal_bowl.position = hand.origin.lerp(other.origin, .5) + Vector3(0, -.024, -.074)
			meal_surface.position = meal_bowl.position + Vector3(0, .045, 0)
	elif water_prop.visible:
		water_prop.position = hand * Vector3(0, -.015, -.058)
		water_prop.rotation.x = -1.05 if drinking else (-.19 if drawing_water else -.82)
