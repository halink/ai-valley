extends Control
# Native disposable observer. The original development owner supplies only one
# live redacted frame over an anonymous inherited pipe.
const STALE_MS := 375
var reader := Thread.new()
var mutex := Mutex.new()
var newest := ""
var newest_at := 0
var stopping := false
var body: Label
var point: Label

static func marker(frame: String) -> Vector2i:
	var fields := frame.split(" ", true, 3)
	if fields.size() != 3 or fields[0] != "active": return Vector2i(-1, -1)
	for value in [fields[1], fields[2]]:
		if value.is_empty() or value.length() > 5: return Vector2i(-1, -1)
		for digit in value:
			if not digit in "0123456789": return Vector2i(-1, -1)
		if int(value) > 65535 or str(int(value)) != value: return Vector2i(-1, -1)
	return Vector2i(int(fields[1]), int(fields[2]))

func _read() -> void:
	while true:
		var frame := OS.read_string_from_stdin(64)
		mutex.lock()
		newest = frame
		newest_at = Time.get_ticks_msec()
		if frame.is_empty(): stopping = true
		var done := stopping
		mutex.unlock()
		if done: return

func _ready() -> void:
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := VBoxContainer.new()
	panel.add_theme_constant_override("separation", 16)
	center.add_child(panel)
	var title := Label.new()
	title.text = "落果 · 私有观察"
	title.add_theme_color_override("font_color", Color("#31271f"))
	title.add_theme_font_size_override("font_size", 30)
	panel.add_child(title)
	body = Label.new()
	body.add_theme_color_override("font_color", Color("#4b382c"))
	body.add_theme_font_size_override("font_size", 23)
	panel.add_child(body)
	point = Label.new()
	point.add_theme_color_override("font_color", Color("#873e4b"))
	point.add_theme_font_size_override("font_size", 32)
	panel.add_child(point)
	_show_frame("")
	var kind := OS.get_stdin_type()
	# Node’s inherited anonymous stream can report UNKNOWN on Linux.
	if OS.has_feature("web") or kind not in [OS.STD_HANDLE_PIPE, OS.STD_HANDLE_UNKNOWN]: return
	if reader.start(_read) == OK: get_tree().auto_accept_quit = false

func _show_frame(frame: String) -> void:
	var at := marker(frame)
	point.text = "●  %d, %d" % [at.x, at.y] if at.x >= 0 else ""
	body.text = "一枚落果在地面。" if at.x >= 0 else ("地面无落果。" if frame == "empty" else "观察不可用。")

func _process(_delta: float) -> void:
	mutex.lock()
	var done := stopping
	var frame := newest if not done and Time.get_ticks_msec() - newest_at <= STALE_MS else ""
	mutex.unlock()
	_show_frame(frame)
	if done and reader.is_started() and not reader.is_alive():
		reader.wait_to_finish()
		get_tree().quit()

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		mutex.lock()
		stopping = true
		mutex.unlock()
		hide()
