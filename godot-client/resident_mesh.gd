extends RefCounted
## Builds one painted mesh per articulated part. UV2.x identifies its dye.

const FIXED := 0
const SKIN := 1
const HAIR := 2
const SHIRT := 3
const LINEN := 4

var surface := SurfaceTool.new()
var smooth_group := 0

func _init() -> void:
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)

func finish() -> ArrayMesh:
	surface.generate_normals()
	surface.index()
	return surface.commit()

# The fields are half-width, height, half-depth and fore/aft centre.
static func profile_at(profile: Array, height: float) -> Vector4:
	for index in range(1, profile.size()):
		var upper: Vector4 = profile[index]
		if height > upper.y and index < profile.size() - 1: continue
		var lower: Vector4 = profile[index - 1]
		var before: Vector4 = profile[maxi(0, index - 2)]
		var after: Vector4 = profile[mini(index + 1, profile.size() - 1)]
		var t := clampf(inverse_lerp(lower.y, upper.y, height), 0, 1)
		var q := t * t
		var result := (lower * 2.0 + (upper - before) * t +
			(before * 2.0 - lower * 5.0 + upper * 4.0 - after) * q +
			(-before + lower * 3.0 - upper * 3.0 + after) * (q * t)) * .5
		return Vector4(maxf(0, result.x), height, maxf(0, result.z), result.w)
	return profile.back()

func loft(at: Vector3, profile: Array, color: Color, dye := FIXED, fold := .0, sides := 30) -> void:
	var first: Vector4 = profile.front()
	var last: Vector4 = profile.back()
	patch(sides, (profile.size() - 1) * 2,
		func(u: float, v: float) -> Vector3:
			var row := profile_at(profile, lerpf(first.y, last.y, v))
			var a := TAU * u
			var ribs := 1.0 + fold * (cos(a * 4.0 + v * 4.2) * .65 + sin(a * 7.0 - v * 6.5) * .35)
			return at + Vector3(sin(a) * row.x * ribs, row.y, row.w - cos(a) * row.z * ribs),
		func(u: float, v: float) -> Color:
			# Broad pigment modulation follows the shape, including less light under hems.
			var stroke := .96 + .024 * sin(u * TAU * 3.0) + .032 * sin(PI * v)
			return color * Color(stroke, stroke, stroke, 1), dye)

# A ribbon with a curved crest and tapered ends, laid along a painted surface.
func ribbon(points: Array[Vector3], widths: Array[float], relief: float, color: Color, dye := FIXED) -> void:
	patch(4, (points.size() - 1) * 4,
		func(u: float, v: float) -> Vector3:
			var along := v * (points.size() - 1)
			var segment := mini(int(along), points.size() - 2)
			var weight := along - segment
			var start: Vector3 = points[segment]
			var end: Vector3 = points[segment + 1]
			var before: Vector3 = points[maxi(segment - 1, 0)]
			var after: Vector3 = points[mini(segment + 2, points.size() - 1)]
			var point := start.cubic_interpolate(end, before, after, weight)
			var previous := start.cubic_interpolate(end, before, after, maxf(0, weight - .02))
			var next := start.cubic_interpolate(end, before, after, minf(1, weight + .02))
			var heading := next - previous
			var lateral := Vector3(heading.y, -heading.x, 0).normalized()
			var across := 2.0 * u - 1.0
			var width := lerpf(widths[segment], widths[segment + 1], weight)
			return point + lateral * across * width + Vector3.FORWARD * relief * sin(PI * u),
		func(u: float, _v: float) -> Color:
			var tone := .91 + .13 * sin(PI * u)
			return color * Color(tone, tone, tone, 1), dye)

func patch(columns: int, rows: int, position: Callable, pigment: Callable, dye: int, reverse := false) -> void:
	var points := PackedVector3Array()
	var colors := PackedColorArray()
	var uv := PackedVector2Array()
	var span := columns + 1
	for y in range(rows + 1):
		for x in range(span):
			var u := float(x) / columns
			var v := float(y) / rows
			points.append(position.call(u, v))
			colors.append(pigment.call(u, v))
			uv.append(Vector2(u, v))
	for y in range(rows):
		for x in range(columns):
			var a := y * span + x
			var b := a + 1
			var c := b + span
			var d := a + span
			var corners := [a, c, b, a, d, c] if reverse else [a, b, c, a, c, d]
			for index in corners:
				surface.set_smooth_group(smooth_group)
				surface.set_color(colors[index])
				surface.set_uv(uv[index])
				surface.set_uv2(Vector2(dye, 0))
				surface.add_vertex(points[index])
	smooth_group += 1
