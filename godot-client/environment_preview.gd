extends HBoxContainer

# An observer-only, low-motion sample. No simulation, animation clock or weather
# inference lives here; hiding this panel never changes the world.
const Art = preload("res://valley_interface_style.gd")
const CONDITIONS := {"sun": "晴", "cloud": "阴", "rain": "雨", "snow": "雪", "mixed": "雨雪混合"}

class WeatherSketch extends Control:
	var condition := "sun"

	func _draw() -> void:
		var ink := Color("748a91")
		if condition == "sun":
			draw_circle(Vector2(25, 24), 10, Color("be9759"), true, -1, true)
			for i in range(8):
				var ray := Vector2.from_angle(i * TAU / 8.0)
				draw_line(Vector2(25, 24) + ray * 15, Vector2(25, 24) + ray * 20, Color("be9759"), 2, true)
			return
		for cloud in [Vector3(13, 22, 8), Vector3(24, 16, 11), Vector3(36, 22, 9)]:
			draw_circle(Vector2(cloud.x, cloud.y), cloud.z, ink, true, -1, true)
		draw_rect(Rect2(13, 22, 23, 8), ink)
		if condition in ["rain", "mixed"]:
			for x in [14.0, 26.0, 38.0]:
				draw_line(Vector2(x, 35), Vector2(x - 3, 43), Color("5a8193"), 2, true)
		if condition in ["snow", "mixed"]:
			for x in [15.0, 34.0]:
				var y := 49.0 if condition == "mixed" else 39.0
				draw_line(Vector2(x - 3, y), Vector2(x + 3, y), Color("66818c"), 1.5, true)
				draw_line(Vector2(x, y - 3), Vector2(x, y + 3), Color("66818c"), 1.5, true)

var sketch: WeatherSketch
var heading: Label
var readings: Label
var caution: Label

static func valid(value: Variant, adopted := false) -> bool:
	if not value is Dictionary or value.get("algorithmVersion") != 1:
		return false
	if adopted:
		if value.has("previewOnly"): return false
		if value.get("schemaVersion") == 1:
			if value.get("observationOnly") != true or value.has("soilWater") or value.has("agriculture"): return false
		elif value.get("schemaVersion") == 2:
			if value.get("soilWater") != true or value.has("observationOnly") or value.has("agriculture"): return false
		elif value.get("schemaVersion") == 3:
			if value.get("agriculture") != true or value.has("observationOnly") or value.has("soilWater"): return false
		else: return false
	elif value.get("schemaVersion") != 1 or value.get("previewOnly") != true or value.has("observationOnly") or value.has("soilWater") or value.has("agriculture"):
		return false
	if value.get("condition") not in CONDITIONS or not value.get("atUs") is String:
		return false
	var timestamp: String = value.atUs
	if timestamp.is_empty() or timestamp.length() > 24: return false
	if timestamp.length() > 1 and timestamp.begins_with("0"): return false
	for digit in timestamp:
		if digit < "0" or digit > "9": return false
	for field in ["temperatureDeciC", "relativeHumidityPermille", "cloudPermille", "windPermille", "daylightPermille", "precipitationPermille"]:
		var number: Variant = value.get(field)
		if not (number is int or number is float) or not is_finite(number) or number != floor(number): return false
		if field == "temperatureDeciC":
			if number < -300 or number > 450: return false
		elif number < 0 or number > 1000: return false
	return true

# Prefer the committed world state. An invalid adopted state never silently
# falls back to an ephemeral sample or reinterprets the legacy weather field.
static func from_snapshot(snapshot: Dictionary) -> Dictionary:
	var world: Variant = snapshot.get("world")
	var mode: Variant = snapshot.get("mvp")
	if not world is Dictionary or not mode is Dictionary or mode.get("driver") != "local-rules": return {}
	if world.has("mvpClimate"):
		var state: Variant = world.mvpClimate
		if world.get("mode") != "validation" or not state is Dictionary: return {}
		var supported: bool = (state.get("schemaVersion") == 1 and state.get("capability") == "observation-only") or (state.get("schemaVersion") == 2 and state.get("capability") == "soil-water-v1") or (state.get("schemaVersion") == 3 and state.get("capability") == "agriculture-v1")
		if not supported: return {}
		var sample: Variant = state.get("current")
		if not valid(sample, true) or sample.schemaVersion != state.schemaVersion or sample.atUs != state.get("lastUs") or state.get("lastMinute") != world.get("minute"): return {}
		return sample
	var sample: Variant = mode.get("environmentPreview")
	return sample if mode.get("ephemeral") == true and valid(sample) else {}

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_theme_constant_override("separation", 8)
	sketch = WeatherSketch.new()
	sketch.custom_minimum_size = Vector2(50, 54)
	sketch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(sketch)
	var text := VBoxContainer.new()
	text.add_theme_constant_override("separation", 3)
	add_child(text)
	heading = _line(text, 17, Art.INK)
	readings = _line(text, 13, Art.MOSS)
	caution = _line(text, 12, Art.CLAY)
	caution.text = "环境预览 · 不影响旧制作物"
	visible = false

func _line(parent: Control, font_size: int, ink: Color) -> Label:
	var label := Label.new()
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", ink)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func present(value: Dictionary, minute: float, stale: bool) -> void:
	var adopted: bool = value.get("observationOnly") == true or value.get("soilWater") == true or value.get("agriculture") == true
	visible = valid(value, adopted)
	if not visible: return
	var season: String = ["春", "夏", "秋", "冬"][int(floor(minute / 1440.0 / 28.0)) % 4]
	heading.text = "%s · %s  %.1f℃" % [season, CONDITIONS[value.condition], value.temperatureDeciC / 10.0]
	readings.text = "湿度 %.1f%%  风 %.2f  日照 %.2f" % [value.relativeHumidityPermille / 10.0, value.windPermille / 1000.0, value.daylightPermille / 1000.0]
	caution.text = ("气候驱动新作物 · 旧茬仍按旧制" if value.get("agriculture") == true else ("气候观测 · 未影响旧制作物" if adopted else "环境预览 · 不影响旧制作物")) + (" · 已过期" if stale else "")
	tooltip_text = "只读环境样本；风与日照为 0–1 游戏强度，非现实风速。静态天气图形不随设备时间变化。"
	sketch.condition = value.condition
	sketch.queue_redraw()
