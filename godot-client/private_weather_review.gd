extends Control
# Standalone native preview. Never loaded by main.tscn or the Web entry.
const Weather = preload("res://valley_spirit_archive.gd")
const Art = preload("res://valley_interface_style.gd")
var body: Label
var http: HTTPRequest
var endpoint := ""
var expected_world := ""
var expected_entry := ""
var pending := false
var requested_at := 0
var accepted_at := 0
var next_poll := 0
var started_at := 0
var last_text_version := 0
var last_permission_version := 0
var last_payload := ""

static func valid_id(value: String) -> bool:
	if value.is_empty() or value.length() > 200: return false
	for ch in value:
		if not ch in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/": return false
	return true

static func presentation(value: Variant, world: String, entry: String) -> String:
	if not valid_id(world) or not valid_id(entry): return ""
	if not Weather._exact(value, ["schemaVersion", "mode", "entryId", "worldId", "textVersion", "permissionVersion", "rendererVersion", "facts"]): return ""
	if not Weather._eq_number(value.schemaVersion, 1) or not Weather._eq_number(value.rendererVersion, 1) or not Weather._eq_string(value.mode, "private-reviewed-offline-weather"): return ""
	if not Weather._eq_string(value.worldId, world) or not Weather._eq_string(value.entryId, entry): return ""
	if not Weather._integer(value.textVersion, 1, 10000) or not Weather._integer(value.permissionVersion, 1, Weather.MAX_VERSION): return ""
	if not value.facts is Array or value.facts.is_empty() or value.facts.size() > 24: return ""
	var lines := PackedStringArray()
	var seen := {}
	for fact in value.facts:
		if not Weather._exact(fact, ["minute", "field", "value"]) or not Weather._number(fact.minute, 0, Weather.MAX_MINUTE) or not fact.field is String: return ""
		var key: String = str(fact.minute) + ":" + fact.field
		if seen.has(key): return ""
		seen[key] = true
		var text := ""
		match fact.field:
			"condition":
				if fact.value is String and Weather.WEATHER.has(fact.value): text = "天气：" + Weather.WEATHER[fact.value]
			"temperatureDeciC":
				if Weather._integer(fact.value, -300, 450): text = "气温：%.1f℃" % (fact.value / 10.0)
			"relativeHumidityPermille":
				if Weather._integer(fact.value, 0, 1000): text = "湿度：%.1f%%" % (fact.value / 10.0)
		if text.is_empty(): return ""
		lines.append(Weather._time(float(fact.minute)) + " · " + text)
	return "\n".join(lines)

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(820, 520)
	panel.add_theme_stylebox_override("panel", Art.leaf(Vector4(32, 28, 32, 28)))
	center.add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 18)
	panel.add_child(column)
	var title := Label.new()
	title.text = "谷灵天气年鉴 · 私密离线阅览"
	title.add_theme_font_override("font", Art.SERIF)
	title.add_theme_font_size_override("font_size", 28)
	title.add_theme_color_override("font_color", Art.INK)
	column.add_child(title)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(756, 390)
	column.add_child(scroll)
	body = Label.new()
	body.add_theme_font_override("font", Art.SERIF)
	body.add_theme_font_size_override("font_size", 21)
	body.add_theme_color_override("font_color", Art.INK)
	scroll.add_child(body)
	body.text = "等待天气记录。"
	if OS.has_feature("web"):
		body.text = "此阅览窗口暂不可用。"
		return
	var args := {}
	for arg in OS.get_cmdline_user_args():
		var parts := arg.split("=", true, 1)
		if parts.size() != 2 or args.has(parts[0]) or parts[0] not in ["--weather-review-port", "--weather-review-world", "--weather-review-entry"]:
			body.text = "此阅览窗口暂不可用。"
			return
		args[parts[0]] = parts[1]
	if args.size() != 3: return
	var port: String = args["--weather-review-port"]
	expected_world = args["--weather-review-world"]
	expected_entry = args["--weather-review-entry"]
	if not port.is_valid_int() or str(int(port)) != port or int(port) < 1024 or int(port) > 65535 or not valid_id(expected_world) or not valid_id(expected_entry): return
	endpoint = "http://127.0.0.1:%s/developer/weather-review" % port
	http = HTTPRequest.new()
	http.timeout = 2.0
	http.max_redirects = 0
	http.body_size_limit = 65536
	add_child(http)
	http.request_completed.connect(_completed)
	started_at = Time.get_ticks_msec()

func _process(_delta: float) -> void:
	if endpoint.is_empty(): return
	var now := Time.get_ticks_msec()
	if now - started_at > 300000:
		get_tree().quit()
		return
	if accepted_at > 0 and now - accepted_at > 3000: _clear()
	if pending or now < next_poll: return
	pending = true
	requested_at = now
	next_poll = now + 2000
	if http.request(endpoint) != OK:
		pending = false
		_clear()

func _clear() -> void:
	accepted_at = 0
	body.text = "天气记录暂不可用。"

func _completed(result: int, code: int, _headers: PackedStringArray, bytes: PackedByteArray) -> void:
	if not pending: return
	pending = false
	if result != HTTPRequest.RESULT_SUCCESS or code != 200 or Time.get_ticks_msec() - requested_at > 2000 or bytes.size() > 65536:
		_clear()
		return
	var value: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	var rendered := presentation(value, expected_world, expected_entry)
	if rendered.is_empty():
		_clear()
		return
	var canonical := JSON.stringify(value, "", true)
	if value.textVersion < last_text_version or value.permissionVersion < last_permission_version or (value.textVersion == last_text_version and value.permissionVersion == last_permission_version and canonical != last_payload):
		_clear()
		return
	last_text_version = int(value.textVersion)
	last_permission_version = int(value.permissionVersion)
	last_payload = canonical
	accepted_at = Time.get_ticks_msec()
	body.text = rendered
