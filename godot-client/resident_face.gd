extends RefCounted

const MeshBuilder = preload("res://resident_mesh.gd")
const LIN_PROFILE := [
	Vector4(0,0,0,-.062), Vector4(.054,.014,.046,-.052),
	Vector4(.099,.048,.094,-.032), Vector4(.136,.088,.127,-.014),
	Vector4(.165,.151,.154,.001), Vector4(.174,.215,.160,.011),
	Vector4(.166,.269,.155,.017), Vector4(.139,.324,.137,.030),
	Vector4(.092,.379,.091,.037), Vector4(.043,.402,.046,.038), Vector4(0,.412,0,.036)
]
const QIAO_PROFILE := [
	Vector4(0,0,0,-.068), Vector4(.049,.015,.042,-.055),
	Vector4(.101,.053,.101,-.038), Vector4(.145,.096,.123,-.018),
	Vector4(.158,.157,.150,0), Vector4(.161,.217,.158,.011),
	Vector4(.163,.270,.158,.019), Vector4(.147,.317,.141,.024),
	Vector4(.095,.382,.099,.030), Vector4(.038,.411,.047,.038), Vector4(0,.421,0,.038)
]

var profile: Array
var wrapped: bool
var hair_style: String

func _init(in_headwrap: bool, style := "") -> void:
	wrapped = in_headwrap
	hair_style = style
	profile = LIN_PROFILE if wrapped else QIAO_PROFILE

func build() -> ArrayMesh:
	var ink := MeshBuilder.new()
	var top: Vector4 = profile.back()
	ink.patch(52, 41, func(u: float, v: float) -> Vector3: return _head(u * TAU, v * top.y),
		func(u: float, v: float) -> Color:
			var point := _head(u * TAU, v * top.y)
			var blush := _spot(absf(point.x) - .110, point.y - .148, .043, .033) * maxf(cos(u * TAU), 0)
			var base := Color(.95 + .06 * sin(v * PI), .98, .99)
			return base.lerp(Color(1.04, .87, .81), blush * .59), MeshBuilder.SKIN)
	for side in [-1, 1]:
		_ear(ink, side)
		_eye(ink, side)
	_mouth(ink)
	_scalp(ink)
	if wrapped: _headwrap(ink)
	elif not hair_style.is_empty(): _low_knot(ink)
	else: _topknot(ink)
	return ink.finish()

func _low_knot(ink: MeshBuilder) -> void:
	var pin := hair_style == "pin"
	ink.loft(Vector3(.018 if pin else 0.0, .155, .156), [
		Vector4(0,-.036,0,0),Vector4(.074,-.019,.055,.012),Vector4(.096,.033,.076,.020),
		Vector4(.088,.086,.064,.013),Vector4(.051,.117,.039,.007),Vector4(0,.131,0,0)
	], Color(.92,.87,.82), MeshBuilder.HAIR, .23, 31)
	ink.ribbon([Vector3(.014,.410,-.005),Vector3(-.075,.355,-.097),Vector3(-.128,.257,-.092),
		Vector3(-.151,.197,-.056)], [.029,.045,.030,.001], .016, Color("dfd1be"), MeshBuilder.HAIR)
	if pin:
		ink.ribbon([Vector3(-.115,.185,.178),Vector3(.112,.207,.183),Vector3(.177,.219,.182)],
			[.012,.018,.008], .007, Color("b58c5c"), MeshBuilder.LINEN)

func _spot(x: float, y: float, width: float, height: float) -> float:
	return exp(-pow(x / width, 2) - pow(y / height, 2))

func _head(angle: float, height: float) -> Vector3:
	var row := MeshBuilder.profile_at(profile, height)
	var x := row.x * sin(angle)
	var front := maxf(cos(angle), 0)
	var nose := .027 if wrapped else .033
	var relief := nose * _spot(x, height - .137, .023, .030)
	relief += .015 * _spot(x, height - .192, .018, .062)
	relief += .012 * _spot(absf(x) - .096, height - .147, .050, .037)
	relief -= .010 * _spot(absf(x) - .067, height - .202, .047, .027)
	relief += (.010 if wrapped else .015) * _spot(absf(x) - .063, height - .237, .056, .023)
	relief += .008 * _spot(x, height - .086, .056, .021)
	return Vector3(x, height, row.w - cos(angle) * row.z - front * relief)

func _on_face(x: float, y: float, lift: float) -> Vector3:
	var ring := MeshBuilder.profile_at(profile, y)
	var point := _head(asin(clampf(x / maxf(ring.x, .01), -.99, .99)), y)
	point.z -= lift
	return point

func _eye(ink: MeshBuilder, side: int) -> void:
	var center_x := side * (.067 if wrapped else .064)
	var center_y := .205 if wrapped else .209
	var width := .034 if wrapped else .036
	var opening := .0116 if wrapped else .0095
	var incline := .0025 if wrapped else .0035
	ink.patch(18, 4,
		func(u: float, v: float) -> Vector3:
			var x := u * 2.0 - 1.0
			var edge := pow(sin(PI * u), .80)
			var y := center_y + side * x * incline + (v * 2.0 - 1.0) * opening * edge
			return _on_face(center_x + x * width, y, .0035),
		func(_u: float, v: float) -> Color: return Color("e6d5bc").lerp(Color("b9a795"), v * .36), MeshBuilder.FIXED)
	var iris_x := center_x + (side * .0008 if wrapped else -.0015)
	_face_disc(ink, Vector2(iris_x, center_y), Vector2(.0101, opening * .93), .0052, Color("594336"))
	_face_disc(ink, Vector2(iris_x, center_y + .0003), Vector2(.0060, opening * .72), .0066, Color("352b27"))
	_face_disc(ink, Vector2(iris_x - .0025, center_y + .0040), Vector2(.0029, .0026), .0079, Color("eadbc0"))
	for upper in [false, true]:
		ink.patch(19, 3,
			func(u: float, v: float) -> Vector3:
				var x := u * 2.0 - 1.0
				var edge := pow(sin(PI * u), .80)
				var base := center_y + side * x * incline
				var rim := edge * opening * (1 if upper else -1)
				var brush := sin(PI * u) * (v - .5) * (.0054 if upper else .0030)
				return _on_face(center_x + x * width, base + rim + brush, .0070 if upper else .005), func(_u: float, _v: float) -> Color: return Color("4e3930" if upper else "9e7660"), MeshBuilder.FIXED)
	ink.patch(17, 3,
		func(u: float, v: float) -> Vector3:
			var x := u * 2.0 - 1.0
			var curve := sin(PI * u) * (.007 if wrapped else .004) + side * x * .005
			var thickness := (v - .5) * pow(sin(PI * u), .60) * (.011 if wrapped else .013)
			return _on_face(center_x + x * (width + .006), center_y + .030 + curve + thickness, .0030), func(_u: float, v: float) -> Color: return Color(.85 + v * .13, .83 + v * .13, .81 + v * .13), MeshBuilder.HAIR)

func _face_disc(ink: MeshBuilder, center: Vector2, radii: Vector2, lift: float, color: Color) -> void:
	ink.patch(18, 3,
		func(u: float, v: float) -> Vector3:
			var angle := u * TAU
			var local := center + Vector2(cos(angle), sin(angle)) * radii * v
			return _on_face(local.x, local.y, lift), func(_u: float, _v: float) -> Color: return color, MeshBuilder.FIXED, true)

func _mouth(ink: MeshBuilder) -> void:
	var width := .035 if wrapped else .033
	var smile := .006 if wrapped else .002
	ink.patch(20, 4,
		func(u: float, v: float) -> Vector3:
			var t := 2.0 * u - 1.0
			var edge := sin(PI * u)
			var crease := .073 + smile * t * t - .0018 * t
			var y := crease + (v - .38) * edge * .011
			return _on_face(t * width, y, .0029),
		func(_u: float, v: float) -> Color: return Color("9f6752").lerp(Color("bd8a71"), absf(v - .38) * 1.4), MeshBuilder.FIXED)
	for side in [-1, 1]:
		_face_disc(ink, Vector2(side * .018, .117), Vector2(.008, .0026), .0017, Color("997561"))

func _ear(ink: MeshBuilder, side: int) -> void:
	var at := Vector3(side * (.161 if wrapped else .155), .107, -.008)
	ink.loft(at, [
		Vector4(0,0,0,-.003), Vector4(.021,.013,.022,-.006), Vector4(.028,.043,.026,.0),
		Vector4(.034,.070,.025,.009), Vector4(.024,.091,.020,.013), Vector4(0,.100,0,.015)
	], Color(.98,.92,.88), MeshBuilder.SKIN, .0, 22)
	ink.loft(at + Vector3(side * .015,.021,-.016), [
		Vector4(0,0,0,0), Vector4(.010,.014,.011,0), Vector4(.014,.041,.012,.004),
		Vector4(.010,.058,.009,.006), Vector4(0,.064,0,.006)
	], Color(.82,.70,.63), MeshBuilder.SKIN, .0, 17)

func _scalp(ink: MeshBuilder) -> void:
	var top: Vector4 = profile.back()
	ink.patch(52, 20,
		func(u: float, v: float) -> Vector3:
			var a := u * TAU
			var front := maxf(0, cos(a))
			var temple := .12 * _spot(absf(sin(a)) - .93, cos(a) - .27, .12, .35)
			var lower := .121 + pow(front, .56) * (.172 if wrapped else .186) - temple * .38
			lower += .019 * sin(a + .28) * front
			var base := _head(a, lerpf(lower, top.y, v))
			var lock := .012 + .009 * sin(PI * v) + .0033 * cos(a * 12.0 + v * 3.2)
			var spread := lock * (1.0 - pow(v, 7.0))
			return base + Vector3(sin(a) * spread, .025 * v, -cos(a) * spread),
		func(u: float, v: float) -> Color:
			var band := .86 + .11 * sin(PI * v) + .11 * sin(u * TAU * 5.0 + v * 3.5)
			return Color(band + .026, band, band * .95), MeshBuilder.HAIR)

func _headwrap(ink: MeshBuilder) -> void:
	ink.patch(56, 24,
		func(u: float, v: float) -> Vector3:
			var a := u * TAU
			var edge := .294 + .023 * sin(a - .7) + .010 * cos(a * 2.0 + .6)
			var y := lerpf(edge, .483, v) + .009 * sin(PI * v) * cos(a + 1)
			var layer := _wrap_ridge(a, v, .19) * .021 + _wrap_ridge(a, v, .47) * .013
			var radius := (1.0 - pow(v, 1.85)) * (.182 + .024 * sin(PI * v) + layer)
			return Vector3(sin(a) * radius - v * .046, y, .022 + v * .009 - cos(a) * radius * .95),
		func(u: float, v: float) -> Color:
			var a := u * TAU
			var seam := .60 * _wrap_ridge(a, v, .132) + .50 * _wrap_ridge(a, v, .411) + .21 * _wrap_ridge(a, v, .627)
			var color := Color("c6ad82").lerp(Color("896d4b"), clampf(seam + (1.0 - v) * .16, 0, 1))
			var wash := .93 + sin(a + v * 4.0) * .047 + v * .055
			return color * Color(wash, wash, wash), MeshBuilder.LINEN)
	ink.loft(Vector3(-.067, .245, .159), [
		Vector4(0,-.025,0,0), Vector4(.030,-.001,.022,.011), Vector4(.047,.037,.033,.012),
		Vector4(.033,.067,.021,0),Vector4(0,.086,0,0)
	], Color("aa8d63"), MeshBuilder.LINEN, .15, 23)

func _wrap_ridge(angle: float, height: float, offset: float) -> float:
	return exp(-pow((height - offset - sin(angle - 1.2) * .09) / .076, 2.0))

func _topknot(ink: MeshBuilder) -> void:
	ink.loft(Vector3(.021, .352, .101), [
		Vector4(0,0,0,-.018), Vector4(.063,.029,.055,-.012), Vector4(.082,.074,.064,.007),
		Vector4(.090,.114,.074,.012), Vector4(.075,.157,.066,.013), Vector4(.038,.182,.037,.007),
		Vector4(0,.192,0,0)
	], Color(1.01,.98,.96), MeshBuilder.HAIR, .22, 35)
	ink.loft(Vector3(.024, .349, .089), [
		Vector4(0,.020,0,0), Vector4(.076,.026,.061,0), Vector4(.079,.035,.064,0),
		Vector4(.080,.051,.062,.002), Vector4(.074,.055,.061,.002), Vector4(0,.059,0,.002)
	], Color("536776"), MeshBuilder.LINEN, .06, 27)
	ink.ribbon([
		Vector3(-.018,.396,-.073), Vector3(-.091,.351,-.124), Vector3(-.143,.282,-.103),
		Vector3(-.164,.221,-.069), Vector3(-.150,.180,-.059)
	], [.027,.036,.030,.013,.0002], .009, Color("eee8dd"), MeshBuilder.HAIR)
