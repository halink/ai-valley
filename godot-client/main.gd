extends Node3D
const Valley3D = preload("res://valley_3d.gd")
const UI_FONT = preload("res://art/fonts/ValleyCJK-Regular.otf")
var valley: Node3D
const Snapshot = preload("res://snapshot.gd")
var movement_feed = preload("res://completed_movement.gd").new()
var world: Dictionary = {}
var observation: Dictionary = {}
var selected := ""
var dragging := false
var active_endpoint := ""
var endpoint: LineEdit
var status: Label
var detail: Label
var events_label: Label
var mode_label: Label
var endpoint_hint: Label
var room_hint: Label
var connection_label: Label
var http: HTTPRequest
var timer: Timer
var busy := false
var connected := false
var first := true
var panel_collapsed := false
var model_diagnostics: Label

func _ready() -> void:
	valley = Valley3D.new()
	add_child(valley)
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	panel.name = "ObserverPanel"
	panel.theme = Theme.new()
	panel.theme.default_font = UI_FONT
	panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	panel.position = Vector2(12, 12)
	panel.theme.default_font_size = 16
	var paper := StyleBoxFlat.new()
	paper.bg_color = Color(0.96, 0.94, 0.86, 0.96)
	paper.set_corner_radius_all(10)
	paper.content_margin_left = 12
	paper.content_margin_right = 12
	paper.content_margin_top = 10
	paper.content_margin_bottom = 10
	panel.add_theme_stylebox_override("panel", paper)
	panel.theme.set_color("font_color", "Label", Color(0.19, 0.23, 0.20))
	layer.add_child(panel)
	var frame := VBoxContainer.new()
	panel.add_child(frame)
	var toggle := Button.new()
	toggle.text = "山谷手记 · 收起"
	frame.add_child(toggle)
	var scroll := ScrollContainer.new()
	scroll.name = "ObserverScroll"
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	frame.add_child(scroll)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	toggle.pressed.connect(func():
		panel_collapsed = not panel_collapsed
		scroll.visible = not panel_collapsed
		toggle.text = "山谷手记 · 展开" if panel_collapsed else "山谷手记 · 收起"
		_resize_panel(panel)
	)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(box)
	var title := Label.new()
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.text = "AI Valley · 只读观察"
	box.add_child(title)
	var presets := VBoxContainer.new()
	box.add_child(presets)
	for preset in ["规则演示 · 3414 · 不存档／不调用模型", "持久世界 · 3415 · 需配置服务端"]:
		var button := Button.new()
		button.text = preset
		var origin := "http://127.0.0.1:3414" if presets.get_child_count() == 0 else "http://127.0.0.1:3415"
		button.pressed.connect(_choose_endpoint.bind(origin))
		presets.add_child(button)
	var row := GridContainer.new()
	row.columns = 2
	box.add_child(row)
	endpoint = LineEdit.new()
	endpoint.text = "http://127.0.0.1:3414"
	if OS.has_feature("web"):
		# Browser uses the page origin, never the viewer's localhost server.
		endpoint.text = str(JavaScriptBridge.eval("window.location.origin"))
		presets.visible = false
		endpoint.editable = false
		endpoint.visible = false
	endpoint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(endpoint)
	var connect_button := Button.new()
	connect_button.text = "连接 / 重连"
	connect_button.tooltip_text = "读取同源世界快照，不调用或启用模型"
	connect_button.pressed.connect(_connect_server)
	connect_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(connect_button)
	var home := Button.new()
	home.text = "回到中心"
	home.pressed.connect(_recenter)
	home.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(home)
	var next_person := Button.new()
	next_person.text = "下一位居民"
	next_person.pressed.connect(_next_resident)
	next_person.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(next_person)
	var enter := Button.new()
	enter.text = "住宅内部"
	enter.pressed.connect(_enter_room)
	enter.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(enter)
	var leave := Button.new()
	leave.text = "回到室外"
	leave.pressed.connect(_leave_room)
	leave.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(leave)
	room_hint = Label.new()
	room_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	room_hint.text = "室外视图 · 观察房间不会移动居民"
	box.add_child(room_hint)
	endpoint_hint = Label.new()
	endpoint_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(endpoint_hint)
	endpoint.text_changed.connect(_endpoint_edited)
	_endpoint_edited(endpoint.text)
	endpoint_hint.visible = not OS.has_feature("web")
	connection_label = Label.new()
	connection_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	connection_label.text = "尚未连接 · 点击连接读取世界"
	box.add_child(connection_label)
	status = Label.new()
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status.text = "中键拖动 · 滚轮缩放 · 左键选择"
	box.add_child(status)
	detail = Label.new()
	detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail.text = "尚未选择居民。室内／地图外居民不会被放到室外显示。"
	box.add_child(detail)
	mode_label = Label.new()
	mode_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	mode_label.text = "尚未连接模拟世界"
	box.add_child(mode_label)
	var diagnostic_toggle := CheckButton.new()
	diagnostic_toggle.text = "模型诊断"
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		diagnostic_toggle.add_theme_color_override(color_name, Color(0.19, 0.23, 0.20))
	box.add_child(diagnostic_toggle)
	model_diagnostics = Label.new()
	model_diagnostics.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	model_diagnostics.visible = false
	box.add_child(model_diagnostics)
	diagnostic_toggle.toggled.connect(func(value: bool): model_diagnostics.visible = value)
	events_label = Label.new()
	events_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	events_label.text = "近期事件：尚未收到"
	box.add_child(events_label)
	get_viewport().size_changed.connect(_resize_panel.bind(panel))
	_resize_panel(panel)
	http = HTTPRequest.new()
	http.timeout = 8.0
	http.body_size_limit = 33554432
	http.request_completed.connect(_received)
	add_child(http)
	timer = Timer.new()
	timer.wait_time = 2.0
	timer.timeout.connect(_poll)
	add_child(timer)

func _resize_panel(panel: PanelContainer) -> void:
	panel.size = Vector2(330, 48 if panel_collapsed else maxf(240, get_viewport().get_visible_rect().size.y - 24))

# Presets never start services, enable a model, or change a running connection.
func _choose_endpoint(origin: String) -> void:
	endpoint.text = origin
	_endpoint_edited(origin)

func _endpoint_edited(value: String) -> void:
	var origin := value.strip_edges().trim_suffix("/")
	if origin == "http://127.0.0.1:3414":
		endpoint_hint.text = "地址预设：规则演示 · 临时世界重启后丢失 · 不调用模型。"
	elif origin == "http://127.0.0.1:3415":
		endpoint_hint.text = "地址预设：持久世界 · 默认禁用模型，需服务端配置。不代表已调用模型。"
	else:
		endpoint_hint.text = "自定义观察地址 · 存档及决策来源未知，须由服务端报告。"
	endpoint_hint.text += " 编辑地址不会切换当前连接。实际模式以下方服务端报告为准。"

func _connect_server() -> void:
	http.cancel_request()
	busy = false
	timer.stop()
	connected = false
	_invalidate_room()
	active_endpoint = ""
	connection_label.text = "当前连接：无"
	observation = {}
	model_diagnostics.text = "当前模型状态未知"
	_update_detail()
	mode_label.text = "已断开 · 当前模型状态未知"
	valley.settle_motion()
	movement_feed.reset()
	var url := endpoint.text.strip_edges().trim_suffix("/")
	if OS.has_feature("web"):
		url = str(JavaScriptBridge.eval("window.location.origin"))
	# Explicit public observer address only, never credentials or query tokens.
	if not (url.begins_with("http://") or url.begins_with("https://")) or "@" in url or "?" in url or "#" in url:
		status.text = "请填写 HTTP(S) 服务地址，不含凭据、查询参数或片段。"
		return
	endpoint.text = url
	active_endpoint = url
	connection_label.text = "目标服务：" + active_endpoint + " · 连接尚未验证"
	world = {}
	observation = {}
	selected = ""
	_update_detail()
	status.text = "正在连接 · 等待新快照"
	mode_label.text = "尚未连接模拟世界"
	events_label.text = "近期事件：尚未收到"
	first = true
	valley.show_world(world, selected, connected)
	timer.start()
	_poll()

func _poll() -> void:
	if busy:
		return
	busy = true
	var error := http.request(active_endpoint + "/ai-town/api/world")
	if error != OK:
		busy = false
		connected = false
		_invalidate_room()
		connection_label.text = "目标服务：" + active_endpoint + " · 已断开／数据过期"
		observation = {}
		_update_detail()
		model_diagnostics.text = "当前模型状态未知"
		mode_label.text = "已断开／数据过期 · 当前模型状态未知"
		valley.settle_motion()
		movement_feed.reset()
		status.text = "连接中断：请求未能发起（%s）。保留上次快照。" % error

func _received(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	busy = false
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		connected = false
		_invalidate_room()
		connection_label.text = "目标服务：" + active_endpoint + " · 已断开／数据过期"
		observation = {}
		_update_detail()
		model_diagnostics.text = "当前模型状态未知"
		mode_label.text = "已断开／数据过期 · 当前模型状态未知"
		valley.settle_motion()
		movement_feed.reset()
		status.text = "已断开／数据过期 · HTTP %s，传输状态 %s · 正在重试" % [code, result]
		return
	var parsed = JSON.parse_string(body.get_string_from_utf8())
	var problem: String = Snapshot.validate(parsed)
	if not problem.is_empty():
		connected = false
		_invalidate_room()
		connection_label.text = "目标服务：" + active_endpoint + " · 已断开／数据过期"
		observation = {}
		_update_detail()
		model_diagnostics.text = "当前模型状态未知"
		mode_label.text = "已断开／数据过期 · 当前模型状态未知"
		valley.settle_motion()
		movement_feed.reset()
		status.text = "已拒绝快照：格式无效" + " · 原视图已过期"
		return
	if not world.is_empty() and world.id == parsed.world.id and parsed.world.revision < world.revision:
		connected = false
		_invalidate_room()
		connection_label.text = "目标服务：" + active_endpoint + " · 已断开／数据过期"
		observation = {}
		_update_detail()
		model_diagnostics.text = "当前模型状态未知"
		mode_label.text = "已断开／数据过期 · 当前模型状态未知"
		valley.settle_motion()
		movement_feed.reset()
		status.text = "已拒绝旧版本快照 · 原视图已过期 · 正在重试"
		return
	if parsed.world.map.width * parsed.world.map.height > 4096 or parsed.world.residents.size() > 64 or parsed.world.get("resources", []).size() > 256 or parsed.world.get("buildings", []).size() > 64:
		connected = false
		_invalidate_room()
		connection_label.text = "目标服务：" + active_endpoint + " · 已断开／数据过期"
		observation = {}
		_update_detail()
		model_diagnostics.text = "当前模型状态未知"
		mode_label.text = "已断开／数据过期 · 当前模型状态未知"
		valley.settle_motion()
		movement_feed.reset()
		status.text = "地图超出 3D MVP 上限：4096 格／64 位居民／256 处资源／64 栋建筑；原视图已过期"
		return
	var changed: bool = not world.is_empty() and world.id != parsed.world.id
	var continuous := connected
	valley.room_layouts = Snapshot.room_views(parsed)
	world = parsed.world
	observation = parsed.get("observation", {}) if parsed.get("observation") is Dictionary else {}
	connected = true
	if changed:
		selected = ""
		first = true
	if first:
		_recenter()
		first = false
	var paused: bool = world.get("clock", {}).get("paused", false)
	connection_label.text = "已连接 · 同源快照（非模型验收）"
	connection_label.tooltip_text = active_endpoint
	status.text = "快照 %s · %s" % [Snapshot.number_label(world.revision), "已暂停" if paused else "世界运行中"]
	mode_label.text = Snapshot.mode_label(parsed)
	model_diagnostics.text = Snapshot.model_status(observation)
	if paused:
		mode_label.text += " · 暂停原因：" + "服务端已暂停（原因未展示）"
	var lines: Array[String] = []
	for entry in world.get("events", []).slice(-3):
		lines.append(str(entry.get("text", "")))
	events_label.text = "近期事件：\n" + "\n".join(lines)
	_update_detail()
	var paths: Dictionary = movement_feed.observe(world, parsed.get("movement"))
	if paths.is_empty():
		valley.settle_motion()
	valley.show_world(world, selected, continuous, paths)
	_room_status()

func _recenter() -> void:
	if world.is_empty():
		return
	valley.center(world)

func _update_detail() -> void:
	detail.text = "尚未选择居民。室内／地图外居民不会被放到室外显示。"
	for person in world.get("residents", []):
		if person.id == selected:
			if not connected:
				detail.text = "已断开／数据过期 · 收到新快照前居民详情未知"
				return
			detail.text = "%s · %s · 健康 %s" % [Snapshot.resident_name(person), Snapshot.resident_status(person), Snapshot.number_label(person.get("health"))]
			detail.text += "\n" + Snapshot.action_detail(person) + "\n饥饿 %s · 精力 %s\n" % [Snapshot.number_label(person.get("hunger")), Snapshot.number_label(person.get("energy"))] + Snapshot.inventory_label(person) + " · " + Snapshot.thirst_label(world, person.id) + " · " + Snapshot.failure_label(person) + "\n" + Snapshot.model_status(observation, person.id)
			detail.text += " · 室内" if person.get("inside") != null else " · 室外"
			return
	selected = ""

func _next_resident() -> void:
	var people: Array = world.get("residents", [])
	if people.is_empty():
		return
	var index := -1
	for i in range(people.size()):
		if people[i].id == selected:
			index = i
	selected = people[(index + 1) % people.size()].id
	_update_detail()
	valley.show_world(world, selected, connected)

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_MIDDLE and not event.pressed:
		dragging = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		dragging = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_MIDDLE:
			dragging = event.pressed
		if event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			valley.zoom(0.87 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 1.15)
		if event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			selected = valley.pick(event.position)
			_update_detail()
			valley.show_world(world, selected, connected)
	if event is InputEventMouseMotion and dragging:
		valley.pan(event.relative)

func _invalidate_room() -> void:
	if not valley.room_id.is_empty():
		valley.leave_room(world)
		valley.show_world({}, "")
	valley.room_layouts = {}
	if room_hint != null: room_hint.text = "收到新快照前无法观察房间"

func _room_status() -> void:
	room_hint.text = "室外视图 · 观察房间不会移动居民"
	if valley.room_id.is_empty(): return
	var unknown := 0
	for person in world.residents:
		if person.get("inside") == valley.room_id and not Snapshot.resident_room_position(person.get("roomAt"),valley.room_layouts[valley.room_id]): unknown += 1
	room_hint.text = "住宅内部 · 剖面视图 · 使用快照位置 · 位置未知居民数：" + str(unknown) + " · 床位数：" + str(_bed_count())

func _enter_room() -> void:
	if not connected: return
	var id := ""
	for person in world.residents:
		if person.id == selected:
			id = str(person.get("inside") if person.get("inside") != null else person.get("homeId", ""))
	if id.is_empty() and valley.room_layouts.size() == 1: id = str(valley.room_layouts.keys()[0])
	if not valley.enter_room(world,id):
		room_hint.text = "所选居民没有已验证的住宅布局，不推测室内结构"
		return
	valley.show_world(world,selected,false)
	_room_status()

func _leave_room() -> void:
	valley.leave_room(world)
	valley.show_world(world,selected,false)
	_room_status()

func _bed_count() -> int:
	var count := 0
	for slot in valley.room_layouts.get(valley.room_id, {}).get("slots", []):
		if slot.get("kind") == "bed": count += 1
	return count
