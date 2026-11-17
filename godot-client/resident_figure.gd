extends Node3D

const MeshBuilder = preload("res://resident_mesh.gd")
const Face = preload("res://resident_face.gd")
const PIGMENT = preload("res://art/resident_pigment.gdshader")
const PALETTES := {
	"shirt": Color("a36750"),
	"hair": Color("514036"),
	"skin": Color("e3b485"),
}

static var templates := {}
var pigment: ShaderMaterial
var colors := {}
var torso: Node3D
var head: Node3D
var shoulders: Array[Node3D] = []
var elbows: Array[Node3D] = []
var hips: Array[Node3D] = []
var knees: Array[Node3D] = []
var shoes: Array[Node3D] = []

func construct(wrapped: bool) -> void:
	if not templates.has(wrapped): templates[wrapped] = _pattern(wrapped)
	var pieces: Dictionary = templates[wrapped]
	pigment = ShaderMaterial.new()
	pigment.shader = PIGMENT
	torso = _joint(self, "Coat", Vector3(0, .76, 0), pieces.coat)
	head = _joint(torso, "Head", Vector3(0, .465 if wrapped else .490, .001), pieces.head)
	for i in range(2):
		var side := i * 2 - 1
		var shoulder_x := .222 if wrapped else .239
		var shoulder := _joint(torso, "Shoulder%d" % side, Vector3(side * shoulder_x, .325, .011), pieces.upper_arm)
		var elbow := _joint(shoulder, "Elbow%d" % side, Vector3(.012 * side, -.213, .002), pieces.forearm[i])
		var hip := _joint(self, "Hip%d" % side, Vector3(side * .124, .668, .001), pieces.thigh)
		var knee := _joint(hip, "Knee%d" % side, Vector3(0, -.294, -.009), pieces.shin)
		var shoe := _joint(knee, "Shoe%d" % side, Vector3(0, -.315, 0), pieces.shoe)
		shoulders.append(shoulder)
		elbows.append(elbow)
		hips.append(hip)
		knees.append(knee)
		shoes.append(shoe)
	relax()

func _joint(parent: Node3D, label: String, at: Vector3, shape: ArrayMesh) -> Node3D:
	var joint := Node3D.new()
	joint.name = label
	joint.position = at
	parent.add_child(joint)
	var model := MeshInstance3D.new()
	model.mesh = shape
	model.material_override = pigment
	joint.add_child(model)
	return joint

func apply_appearance(appearance: Dictionary) -> void:
	for part in PALETTES:
		var color: Color = PALETTES[part]
		var exact: Variant = appearance.get(part)
		if exact is int or exact is float and is_finite(exact): color = Color.hex(((int(exact) & 0xffffff) << 8) | 255)
		if colors.get(part) == color: continue
		colors[part] = color
		pigment.set_shader_parameter(part, color)

func relax() -> void:
	transform = Transform3D.IDENTITY
	torso.rotation = Vector3.ZERO
	head.rotation = Vector3.ZERO
	for i in range(2):
		var side := 2 * i - 1
		shoulders[i].rotation = Vector3(.025, -.014 * side, .099 * side)
		elbows[i].rotation = Vector3(.066, 0, 0)
		hips[i].rotation = Vector3.ZERO
		knees[i].rotation = Vector3.ZERO
		shoes[i].rotation = Vector3(0, -.068 * side, 0)

func walk(phase: float) -> void:
	torso.rotation = Vector3(-.06, cos(phase) * .084, sin(phase) * .045)
	head.rotation.y = -torso.rotation.y * .67
	for i in range(2):
		var side := 2 * i - 1
		var stride := sin(phase) * side
		hips[i].rotation.x = .30 * stride
		knees[i].rotation.x = -.33 * maxf(0, cos(phase) * side) * (.64 + .36 * absf(stride))
		shoes[i].rotation.x = -.65 * (hips[i].rotation.x + knees[i].rotation.x)
		shoulders[i].rotation.x = -.27 * stride
		elbows[i].rotation.x = .11 + maxf(0, -stride) * .18

func reach(hand: int, angle: float, elbow: float, inward := 0.0) -> void:
	var side := 2 * hand - 1
	shoulders[hand].rotation.x = angle
	shoulders[hand].rotation.y = side * inward
	elbows[hand].rotation.x = elbow

func sit() -> void:
	position.y = -.21
	for i in range(2):
		hips[i].rotation.x = 1.30
		knees[i].rotation.x = -1.37

func grip(hand: int) -> Transform3D:
	return transform * torso.transform * shoulders[hand].transform * elbows[hand].transform * 		Transform3D(Basis.IDENTITY, Vector3(0, -.218, -.046))

func belt() -> Transform3D:
	return transform * torso.transform

static func _pattern(wrapped: bool) -> Dictionary:
	return {
		"coat": _coat(wrapped),
		"head": Face.new(wrapped).build(),
		"upper_arm": _upper_arm(wrapped),
		"forearm": [_forearm(wrapped, -1), _forearm(wrapped, 1)],
		"thigh": _thigh(wrapped),
		"shin": _shin(wrapped),
		"shoe": _shoe(wrapped),
	}

static func _coat(wrapped: bool) -> ArrayMesh:
	var mesh := MeshBuilder.new()
	var hem := -.267 if wrapped else -.302
	var width := .246 if wrapped else .263
	var profile := [
		Vector4(0,hem-.008,0,0), Vector4(width * .97,hem,.155,.010),
		Vector4(width,hem+.026,.166,.011), Vector4(width * .946,-.164,.167,.017),
		Vector4(.226,-.058,.156,.017), Vector4(.217,.041,.152,.018),
		Vector4(.228,.149,.160,.014), Vector4(.240 if wrapped else .260,.251,.169,.016),
		Vector4(.220 if wrapped else .245,.321,.161,.020), Vector4(.161,.387,.130,.019),
		Vector4(.085,.425,.089,.012), Vector4(0,.438,0,.009)
	]
	mesh.loft(Vector3.ZERO, profile, Color(.96,.945,.93), MeshBuilder.SHIRT, .060, 35)
	mesh.loft(Vector3(0,.378,.008), [
		Vector4(0,.0,0,0), Vector4(.080,.021,.066,-.005), Vector4(.077,.089,.068,-.012),
		Vector4(.083,.117,.077,-.021), Vector4(0,.127,0,.0)
	], Color(.94,.90,.86), MeshBuilder.SKIN, .0, 23)
	var hem_trim := Color("775442") if wrapped else Color("57676e")
	mesh.loft(Vector3.ZERO, [
		Vector4(0,hem-.012,0,.010), Vector4(width*1.02,hem+.003,.168,.012),
		Vector4(width*1.025,hem+.025,.173,.013), Vector4(width*1.01,hem+.041,.174,.014),
		Vector4(0,hem+.045,0,.014)
	], hem_trim, MeshBuilder.LINEN, .046, 31)

	var under: Array[Vector3] = []
	for point in [Vector2(-.071,.420),Vector2(-.107,.381),Vector2(-.091,.323),Vector2(-.025,.244),Vector2(.055,.163)]:
		under.append(_coat_point(profile, point, .0035))
	mesh.ribbon(under, [.016,.024,.024,.022,.002], .007, Color("efdfbe"), MeshBuilder.LINEN)
	var lapel: Array[Vector3] = []
	for point in [Vector2(.070,.416),Vector2(.097,.382),Vector2(.096,.330),Vector2(.049,.258),Vector2(-.034,.177),Vector2(-.112,.097),Vector2(-.133,.051)]:
		lapel.append(_coat_point(profile, point, .0055))
	var linen := Color("d8bd91") if wrapped else Color("c9ccbf")
	mesh.ribbon(lapel, [.017,.032,.035,.035,.030,.022,.011], .008, linen, MeshBuilder.LINEN)
	var fold: Array[Vector3] = []
	for point in [Vector2(-.115,-.053),Vector2(-.114,-.095),Vector2(-.107,-.159),Vector2(-.096,hem+.010)]:
		fold.append(_coat_point(profile, point, .0026))
	mesh.ribbon(fold, [.009,.011,.009,.008], .006, hem_trim.lightened(.36), MeshBuilder.LINEN)
	var belt := Color("8b6a50") if wrapped else Color("505e5d")
	mesh.loft(Vector3.ZERO, [
		Vector4(0,-.025,0,.015),Vector4(.234,-.022,.171,.015),
		Vector4(.238,-.008,.178,.016),Vector4(.231,.034,.173,.016),
		Vector4(.230,.048,.169,.018),Vector4(0,.050,0,.018)
	], belt, MeshBuilder.LINEN, .041, 35)
	mesh.loft(Vector3(-.051,.0,-.161), [
		Vector4(0,-.028,0,-.001), Vector4(.040,-.024,.019,-.005), Vector4(.054,.008,.033,-.007),
		Vector4(.045,.032,.023,-.006), Vector4(0,.041,0,-.004)
	], belt.lightened(.13), MeshBuilder.LINEN, .16, 25)
	mesh.ribbon([
		Vector3(-.055,.016,-.183), Vector3(-.049,-.049,-.186), Vector3(-.018,-.109,-.178), Vector3(-.024,-.171,-.189)
	], [.022,.019,.014,.004], .0055, belt.lightened(.15), MeshBuilder.LINEN)
	if wrapped:
		mesh.ribbon([
			Vector3(-.065,.004,-.187), Vector3(-.082,-.065,-.174), Vector3(-.103,-.128,-.171)
		], [.018,.013,.005], .0045, belt.lightened(.083), MeshBuilder.LINEN)
	return mesh.finish()

static func _coat_point(profile: Array, at: Vector2, lift: float) -> Vector3:
	var row := MeshBuilder.profile_at(profile, at.y)
	var angle := asin(clampf(at.x / row.x, -.99, .99))
	return Vector3(at.x, at.y, row.w - row.z * 1.054 * cos(angle) - lift)

static func _upper_arm(wrapped: bool) -> ArrayMesh:
	var mesh := MeshBuilder.new()
	var cuff := .077 if wrapped else .081
	mesh.loft(Vector3.ZERO, [
		Vector4(0,-.256,0,0),Vector4(cuff,-.245,.081,-.004),Vector4(cuff+.010,-.209,.086,-.003),
		Vector4(.088,-.147,.090,.005),Vector4(.090,-.068,.094,.012),Vector4(.092,.008,.095,.015),
		Vector4(.074,.062,.075,.018),Vector4(.037,.097,.039,.013),Vector4(0,.107,0,.011),
	], Color(.96,.94,.91), MeshBuilder.SHIRT, .10, 28)
	return mesh.finish()

static func _forearm(wrapped: bool, side: int) -> ArrayMesh:
	var mesh := MeshBuilder.new()
	var end := -.116 if wrapped else -.135
	mesh.loft(Vector3.ZERO, [
		Vector4(0,end-.021,0,-.005),Vector4(.069,end-.012,.067,-.005),
		Vector4(.078,end+.014,.073,-.002),Vector4(.086,-.054,.080,.003),
		Vector4(.089,-.005,.083,.005),Vector4(.076,.046,.083,.003),Vector4(0,.055,0,.003)
	], Color(.93,.91,.88), MeshBuilder.SHIRT, .12, 26)
	mesh.loft(Vector3.ZERO, [
		Vector4(0,end-.032,0,-.005),Vector4(.066,end-.027,.068,-.007),
		Vector4(.076,end-.014,.076,-.006),Vector4(.083,end+.007,.081,-.006),
		Vector4(.079,end+.024,.079,-.004), Vector4(0,end+.028,0,-.004)
	], Color("d7c3a1" if wrapped else "b5bab0"), MeshBuilder.LINEN, .070, 27)
	mesh.loft(Vector3(.008*side,0,-.012), [
		Vector4(0,-.254,0,-.027),Vector4(.026,-.245,.023,-.020),Vector4(.043,-.219,.035,-.007),
		Vector4(.046,-.184,.036,.003),Vector4(.036,-.144,.030,.006),Vector4(0,-.120,0,.013)
	], Color(.98,.93,.88), MeshBuilder.SKIN, .060, 26)
	mesh.loft(Vector3(-.032*side,-.199,-.031), [
		Vector4(0,-.022,0,-.008),Vector4(.016,-.013,.013,-.007),Vector4(.020,.010,.017,-.003),
		Vector4(.016,.035,.014,.010),Vector4(0,.046,0,.016)
	], Color(1.02,.96,.91), MeshBuilder.SKIN, .04, 19)
	return mesh.finish()

static func _thigh(wrapped: bool) -> ArrayMesh:
	var mesh := MeshBuilder.new()
	mesh.loft(Vector3.ZERO, [
		Vector4(0,-.341,0,-.008),Vector4(.094,-.323,.097,-.011),Vector4(.109,-.276,.116,-.008),
		Vector4(.118,-.199,.121,-.002),Vector4(.114,-.109,.128,.002),
		Vector4(.111,-.011,.123,.006),Vector4(.095,.065,.106,.010),Vector4(0,.081,0,.010)
	], Color("766f53" if wrapped else "626961"), MeshBuilder.LINEN, .123, 27)
	return mesh.finish()

static func _shin(wrapped: bool) -> ArrayMesh:
	var mesh := MeshBuilder.new()
	mesh.loft(Vector3.ZERO, [
		Vector4(0,-.322,0,-.001),Vector4(.074,-.297,.077,-.004),Vector4(.086,-.259,.082,.006),
		Vector4(.105,-.213,.095,.013),Vector4(.111,-.162,.104,.008),Vector4(.105,-.088,.105,-.004),
		Vector4(.101,-.002,.110,-.009),Vector4(.083,.051,.085,-.004),Vector4(0,.067,0,-.005)
	], Color("746c53" if wrapped else "5d635b"), MeshBuilder.LINEN, .136, 27)
	mesh.loft(Vector3.ZERO, [
		Vector4(0,-.335,0,0),Vector4(.071,-.321,.075,0),Vector4(.075,-.292,.077,.003),
		Vector4(.078,-.268,.080,.006),Vector4(.076,-.254,.082,.006),Vector4(0,-.244,0,.004)
	], Color("b9a886" if wrapped else "bac0a9"), MeshBuilder.LINEN, .05, 23)
	return mesh.finish()

static func _shoe(wrapped: bool) -> ArrayMesh:
	var mesh := MeshBuilder.new()
	mesh.loft(Vector3.ZERO, [
		Vector4(0,-.039,0,-.048),Vector4(.096,-.036,.154,-.049),Vector4(.101,-.020,.155,-.050),
		Vector4(.098,-.004,.151,-.048),Vector4(0,.005,0,-.047)
	], Color("514639"), MeshBuilder.FIXED, .02, 28)
	mesh.loft(Vector3.ZERO, [
		Vector4(0,-.013,0,-.050),Vector4(.094,-.005,.152,-.050),Vector4(.098,.012,.152,-.054),
		Vector4(.092,.039,.131,-.043),Vector4(.079,.073,.100,-.019),
		Vector4(.074,.107,.080,.001),Vector4(.056,.114,.066,.006),Vector4(0,.123,0,.004)
	], Color("665849" if wrapped else "5b5350"), MeshBuilder.LINEN, .036, 28)
	return mesh.finish()
