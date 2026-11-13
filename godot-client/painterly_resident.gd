extends Node3D
## Original code-authored 3D resident sample. Geometry only, never simulation.
## Local -Z is forward; feet sit at y=0.025 above the ground plane.
static var meshes: Dictionary = {}
var garments: Array[MeshInstance3D] = []
var applied_colors: Dictionary = {}
var rest_transforms: Dictionary = {}
var activity_pose := "idle"

static func paint(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.vertex_color_use_as_albedo = true
	material.roughness = 0.94
	return material

# Flat-shaded elliptical ring loft with subtly varied pigment per face.
# Rings are (radius_x, height, radius_z); closed caps, clockwise front faces.
static func loft(rings: Array[Vector3]) -> ArrayMesh:
	var key := str(rings)
	if meshes.has(key): return meshes[key]
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sides := 10
	for row in range(rings.size()-1):
		for side in range(sides):
			var points: Array[Vector3] = []
			for pair in [Vector2i(row,side),Vector2i(row+1,side),Vector2i(row+1,side+1),Vector2i(row,side+1)]:
				var ring: Vector3 = rings[pair.x]
				var angle: float = TAU * pair.y / sides
				points.append(Vector3(cos(angle)*ring.x,ring.y,sin(angle)*ring.z))
			for index in [0,2,1,0,3,2]:
				var pigment := 0.91 + 0.09 * float((side*7+row*3)%5)/4.0
				surface.set_color(Color(pigment,pigment,pigment))
				surface.add_vertex(points[index])
	surface.generate_normals()
	var result := surface.commit()
	meshes[key] = result
	return result

func part(label: String, rings: Array[Vector3], at: Vector3, color: String, clothing := false) -> MeshInstance3D:
	if rings[0] == Vector3.ZERO and rings[1].y > 0:
		rings[0] = Vector3(0,rings[1].y,0)
	var node := MeshInstance3D.new()
	node.name = label
	node.mesh = loft(rings)
	node.position = at
	node.material_override = paint(Color(color))
	add_child(node)
	if clothing: garments.append(node)
	return node

func construct(person: Dictionary) -> void:
	set_meta("resident_id",str(person.id))
	# Stable identity-derived silhouette, not inferred gender/job/personality.
	var variant := int(str(person.id).sha256_text().substr(62,2).hex_to_int()) % 2
	set_meta("silhouette",variant)
	var skin := "d8ab83"
	for side in [-1,1]:
		part("Boot"+str(side),[Vector3.ZERO,Vector3(.105,.025,.16),Vector3(.105,.17,.16),Vector3(.08,.22,.09),Vector3(0,.22,0)],Vector3(side*.13,0,-.035),"65523f")
		part("Trouser"+str(side),[Vector3.ZERO,Vector3(.075,.17,.085),Vector3(.09,.67,.1),Vector3(0,.67,0)],Vector3(side*.13,0,0),"657777")
		var arm := part("Sleeve"+str(side),[Vector3.ZERO,Vector3(.065,.68,.075),Vector3(.1,1.05,.095),Vector3(.07,1.13,.07),Vector3(0,1.13,0)],Vector3(side*.29,0,0),"ffffff",true)
		arm.rotation.z = -side*.07
		part("Hand"+str(side),[Vector3.ZERO,Vector3(.065,.58,.065),Vector3(.075,.68,.075),Vector3(0,.73,0)],Vector3(side*.335,0,0),skin)
	part("Tunic",[Vector3(0,.49,0),Vector3(.26 if variant==0 else .23,.49,.17),Vector3(.20,.85,.14),Vector3(.24,1.07,.16),Vector3(.12,1.15,.10),Vector3(0,1.15,0)],Vector3.ZERO,"ffffff",true)
	part("Belt",[Vector3(0,.74,0),Vector3(.225,.74,.158),Vector3(.22,.79,.158),Vector3(0,.79,0)],Vector3.ZERO,"846b47")
	part("Neck",[Vector3.ZERO,Vector3(.085,1.09,.08),Vector3(.085,1.25,.08),Vector3(0,1.25,0)],Vector3.ZERO,skin)
	part("Head",[Vector3(0,1.19,0),Vector3(.13,1.23,.12),Vector3(.185,1.39,.16),Vector3(.17,1.52,.15),Vector3(.1,1.57,.1),Vector3(0,1.59,0)],Vector3.ZERO,skin)
	part("Hair",[Vector3(0,1.49,0),Vector3(.185,1.49,.16),Vector3(.19,1.55,.17),Vector3(.12,1.64,.12),Vector3(0,1.66,0)],Vector3(0,0,.025),"514638")
	if variant == 0:
		part("SoftCap",[Vector3(0,1.55,0),Vector3(.22,1.55,.20),Vector3(.22,1.59,.20),Vector3(.16,1.72,.15),Vector3(0,1.74,0)],Vector3.ZERO,"a99361")
	else:
		part("HairKnot",[Vector3.ZERO,Vector3(.09,.03,.09),Vector3(.1,.12,.10),Vector3(0,.19,0)],Vector3(0,1.45,.16),"514638")
		part("Collar",[Vector3(0,1.08,0),Vector3(.16,1.08,.12),Vector3(.13,1.18,.11),Vector3(0,1.18,0)],Vector3.ZERO,"d9bb7e")
	part("Nose",[Vector3.ZERO,Vector3(.04,.03,.045),Vector3(.035,.10,.065),Vector3(0,.12,0)],Vector3(0,1.32,-.15),skin)
	for side in [-1,1]:
		part("Eye"+str(side),[Vector3.ZERO,Vector3(.016,.016,.014),Vector3(0,.032,0)],Vector3(side*.073,1.415,-.145),"403c36")
	set_meta("garments",garments)
	update_appearance(person)
	for child in get_children(): rest_transforms[child.name] = child.transform

func update_appearance(person: Dictionary) -> void:
	var appearance: Dictionary = person.get("appearance",{})
	for feature in ["shirt","hair","skin"]:
		var color := Color({"shirt":"9b6b55","hair":"514638","skin":"d8ab83"}[feature])
		var value: Variant = appearance.get(feature)
		if value is float or value is int: color = Color.hex(int(value)*256+255)
		if applied_colors.get(feature) == color: continue
		applied_colors[feature] = color
		var material := paint(color)
		for child in get_children():
			var label := str(child.name)
			if (feature == "shirt" and child in garments) or (feature == "hair" and label in ["Hair","HairKnot"]) or (feature == "skin" and (label in ["Head","Neck","Nose"] or label.begins_with("Hand"))):
				child.material_override = material

# Only transforms geometry children; authoritative root, labels and selection stay fixed.
func reset_pose() -> void:
	for label in rest_transforms:
		get_node(NodePath(label)).transform = rest_transforms[label]

func pivot_part(label: String, pivot: Vector3, angle: float) -> void:
	var rotation_basis := Basis(Vector3.RIGHT, angle)
	get_node(NodePath(label)).transform = Transform3D(rotation_basis, pivot - rotation_basis * pivot) * rest_transforms[label]

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
		"eat": return "eat"
		"mvpDrink": return "drink"
		"sleep":
			if person.get("inside") != null and person.get("roomAt") is Dictionary: return "rest"
	return "idle"

func set_activity_pose(person: Dictionary, enabled: bool) -> void:
	activity_pose = onsite_pose(person) if enabled else "idle"
	present_pose(false, 0.0)

func present_pose(walking: bool, phase: float) -> void:
	reset_pose()
	if walking:
		for side in [-1, 1]:
			var swing: float = sin(phase) * side * 0.24
			for label in ["Boot", "Trouser"]: pivot_part(label+str(side), Vector3(side*.13,.67,0), swing)
			for label in ["Sleeve", "Hand"]: pivot_part(label+str(side), Vector3(side*.29,1.08,0), -swing)
	elif activity_pose == "gather":
		for side in [-1, 1]:
			for label in ["Sleeve", "Hand"]: pivot_part(label+str(side), Vector3(side*.29,1.08,0), 0.8)
	elif activity_pose in ["eat", "drink"]:
		# Empty hand-to-mouth gesture, not an invented cup, food or success effect.
		for label in ["Sleeve", "Hand"]: pivot_part(label+"1", Vector3(.29,1.08,0), 2.15 if activity_pose == "drink" else 1.8)
	elif activity_pose == "rest":
		# Bowed head at the authoritative indoor cell, not a fake bed teleport.
		for label in ["Head", "Hair", "HairKnot", "SoftCap", "Nose", "Eye-1", "Eye1"]:
			if rest_transforms.has(label): pivot_part(label, Vector3(0,1.2,0), -0.3)
