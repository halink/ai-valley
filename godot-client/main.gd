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
var world_summary_label: Label
var detail: Label
var memories_label: Label
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
var resident_events_only := false
var observer_panel: PanelContainer
var follow_button: CheckButton
var resident_title: Label
var resident_action: Label
var inventory_detail: Label

func _ready() -> void:
	valley = Valley3D.new()
	add_child(valley)
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	observer_panel = panel
	# Wheel events can bubble at scroll limits; never let the panel pass them to the map.
	panel.mouse_force_pass_scroll_events = false
	panel.name = "ObserverPanel"
	panel.theme = Theme.new()
	panel.theme.default_font = UI_FONT
	panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	panel.position = Vector2(12, 12)
	panel.theme.default_font_size = 16
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		var button_style := StyleBoxFlat.new()
		button_style.bg_color = Color("dce4cf") if state == "normal" else Color("c4d3b1")
		if state == "disabled": button_style.bg_color = Color("e5e3d7")
		button_style.set_corner_radius_all(6)
		button_style.set_content_margin_all(9)
		if state == "focus":
			button_style.set_border_width_all(2)
			button_style.border_color = Color("496549")
		panel.theme.set_stylebox(state, "Button", button_style)
		panel.theme.set_color("font_" + state + "_color" if state != "normal" else "font_color", "Button", Color("263c30"))
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
	title.text = "山谷里的日常"
	title.add_theme_font_size_override("font_size", 24)
	box.add_child(title)
	var help := Label.new()
	help.text = "左键选居民 · 中键拖动画面 · 滚轮缩放\n观察不会改变居民行为"
	help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	help.add_theme_font_size_override("font_size", 13)
	box.add_child(help)
	var resident_card := VBoxContainer.new()
	resident_card.add_theme_constant_override("separation", 8)
	resident_card.custom_minimum_size.y = 202
	box.add_child(resident_card)
	resident_title = Label.new()
	resident_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	resident_title.add_theme_font_size_override("font_size", 22)
	resident_card.add_child(resident_title)
	resident_action = Label.new()
	resident_action.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	resident_action.custom_minimum_size.y = 48
	resident_action.add_theme_font_size_override("font_size", 20)
	resident_action.add_theme_color_override("font_color", Color("496549"))
	resident_card.add_child(resident_action)
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
	home.text = "家园全景"
	home.pressed.connect(_recenter)
	home.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(home)
	var next_person := Button.new()
	next_person.text = "下一位居民"
	next_person.pressed.connect(_next_resident)
	next_person.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(next_person)
	var locate := Button.new()
	locate.text = "近看居民"
	locate.tooltip_text = "切换到居民所在视图并定位镜头，不移动居民"
	locate.pressed.connect(_locate_resident)
	locate.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(locate)
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
	follow_button = CheckButton.new()
	follow_button.text = "跟随所选居民"
	follow_button.tooltip_text = "只跟随当前视图中的居民；拖动、断连或离开视图时停止"
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		follow_button.add_theme_color_override(color_name, Color(0.19, 0.23, 0.20))
	box.add_child(follow_button)
	follow_button.toggled.connect(func(enabled: bool):
		if enabled and (not connected or selected.is_empty() or not valley.focus_resident(selected)):
			_stop_follow()
			status.text = "请先选择当前视图中的居民；过期或未知位置不能跟随"
	)
	# Keep interactive controls above variable-height snapshot text.
	var event_filter := CheckButton.new()
	event_filter.text = "只看所选居民参与的事件"
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		event_filter.add_theme_color_override(color_name, Color(0.19, 0.23, 0.20))
	box.add_child(event_filter)
	event_filter.toggled.connect(func(value: bool):
		resident_events_only = value
		_update_events()
	)
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
	world_summary_label = Label.new()
	world_summary_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	world_summary_label.text = "世界时间与环境资源：等待快照"
	box.add_child(world_summary_label)
	var place_labels := CheckButton.new()
	place_labels.text = "显示资源与菜园标记"
	place_labels.tooltip_text = "显示真实资源余量与田地生长；关闭让场景更清爽"
	place_labels.add_theme_color_override("font_color", Color("263c30"))
	box.add_child(place_labels)
	place_labels.toggled.connect(valley.set_place_labels)
	var memory_toggle := CheckButton.new()
	memory_toggle.text = "查看本人近期经历"
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		memory_toggle.add_theme_color_override(color_name, Color(0.19, 0.23, 0.20))
	box.add_child(memory_toggle)
	detail = Label.new()
	detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail.text = "尚未选择居民。室内／地图外居民不会被放到室外显示。"
	resident_card.add_child(detail)
	memories_label = Label.new()
	memories_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	memories_label.visible = false
	memories_label.text = "本人近期经历：未连接／数据过期"
	box.add_child(memories_label)
	memory_toggle.toggled.connect(func(enabled: bool): memories_label.visible = enabled)
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
	# Keep technical facts available without turning the main view into a debugger.
	var service_toggle := CheckButton.new()
	service_toggle.text = "连接与运行信息"
	service_toggle.add_theme_color_override("font_color", Color("263c30"))
	box.add_child(service_toggle)
	var help_toggle := CheckButton.new()
	help_toggle.text = "操作帮助"
	help_toggle.add_theme_color_override("font_color", Color("263c30"))
	box.add_child(help_toggle)
	help.reparent(box)
	help.visible = false
	help_toggle.toggled.connect(func(value: bool): help.visible = value)
	var life_toggle := CheckButton.new()
	life_toggle.text = "随身物品与生活记录"
	life_toggle.add_theme_color_override("font_color", Color("263c30"))
	box.add_child(life_toggle)
	var life_info := VBoxContainer.new()
	box.add_child(life_info)
	inventory_detail = Label.new()
	inventory_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	life_info.add_child(inventory_detail)
	for control in [event_filter, memory_toggle, memories_label, events_label]: control.reparent(life_info)
	life_info.visible = false
	life_toggle.toggled.connect(func(value: bool): life_info.visible = value)
	var service_info := VBoxContainer.new()
	box.add_child(service_info)
	for control in [row.get_child(0), connect_button, connection_label, diagnostic_toggle, model_diagnostics]:
		control.reparent(service_info)
	service_info.visible = false
	service_toggle.toggled.connect(func(value: bool): service_info.visible = value)
	mode_label.add_theme_font_size_override("font_size", 13)
	box.move_child(world_summary_label, 1)
	box.move_child(mode_label, 2)
	box.move_child(resident_card, 3)
	box.move_child(row, 4)
	box.move_child(follow_button, 5)
	box.move_child(room_hint, 6)
	box.move_child(life_toggle, 7)
	box.move_child(life_info, 8)
	box.move_child(help, help_toggle.get_index() + (1 if help.get_index() > help_toggle.get_index() else 0))
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
	# Web is a same-origin read-only observer. Fetching a snapshot does not
	# start the world or enable a model; retain the button for manual retries.
	if OS.has_feature("web"):
		_connect_server.call_deferred()

func _resize_panel(panel: PanelContainer) -> void:
	valley.set_observer_inset(0 if panel_collapsed else 342)
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
		if not world.get("residents", []).is_empty(): selected = world.residents[0].id
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
	_update_detail()
	var paths: Dictionary = movement_feed.observe(world, parsed.get("movement"))
	if paths.is_empty():
		valley.settle_motion()
	valley.show_world(world, selected, continuous, paths)
	_room_status()

func _recenter() -> void:
	_stop_follow()
	if world.is_empty():
		return
	if not valley.room_id.is_empty():
		valley.leave_room(world)
		valley.show_world(world, selected, false)
		_room_status()
	valley.center(world)

func _update_events() -> void:
	events_label.text = Snapshot.event_summary(world, selected, resident_events_only, connected)

func _update_detail() -> void:
	detail.tooltip_text = ""
	resident_action.tooltip_text = ""
	inventory_detail.text = "随身物品：未连接或未选择居民"
	if connected: _room_status()
	if not connected: _stop_follow()
	_update_events()
	memories_label.text = "本人近期经历：请选择居民" if connected else "本人近期经历：未连接／数据过期"
	world_summary_label.text = Snapshot.world_summary(world).get_slice("\n", 0) if connected else "世界时间：未连接／数据过期"
	world_summary_label.tooltip_text = Snapshot.world_summary(world) if connected else ""
	resident_title.text = "选择一位居民" if connected else "连接已中断"
	resident_action.text = "点击人物，或使用下一位居民" if connected else "等待新快照，当前画面已过期"
	detail.text = ""
	for person in world.get("residents", []):
		if person.id == selected:
			if not connected:
				detail.text = "已断开／数据过期 · 收到新快照前居民详情未知"
				return
			resident_title.text = Snapshot.resident_name(person) + " · " + Snapshot.resident_status(person) + (" · 室内" if person.get("inside") != null else " · 室外")
			resident_action.text = Snapshot.life_action(person, world)
			resident_action.tooltip_text = Snapshot.action_detail(person)
			detail.text = "健康 %s   饥饿 %s   精力 %s\n" % [Snapshot.number_label(person.get("health")), Snapshot.number_label(person.get("hunger")), Snapshot.number_label(person.get("energy"))]
			detail.text += Snapshot.thirst_label(world, person.id)
			inventory_detail.text = Snapshot.inventory_label(person)
			detail.tooltip_text = Snapshot.plan_summary(person) + "\n" + Snapshot.failure_label(person)
			memories_label.text = Snapshot.memory_summary(person)
			return
	selected = ""
	_update_events()

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

func _locate_resident() -> void:
	_stop_follow()
	if not connected:
		status.text = "数据过期，收到新快照后才能定位居民"
		return
	if selected.is_empty():
		status.text = "请先选择一位居民"
		return
	for person in world.get("residents", []):
		if person.id != selected: continue
		var inside: String = str(person.get("inside")) if person.get("inside") != null else ""
		if inside != valley.room_id:
			if inside.is_empty(): valley.leave_room(world)
			elif not valley.enter_room(world, inside):
				room_hint.text = "居民所在房间布局未知，无法定位"
				return
			valley.show_world(world, selected, false)
		_room_status()
		break
	if not valley.focus_resident(selected):
		status.text = "所选居民不在当前视图中；室内居民请先进入住宅，未知位置不推测"
		return
	valley.close_view()
	status.text = "已近看所选居民 · 仅移动镜头，不持续跟随"

func _stop_follow() -> void:
	if follow_button != null:
		follow_button.set_pressed_no_signal(false)

func _process(_delta: float) -> void:
	if follow_button == null or not follow_button.button_pressed:
		return
	if not connected or selected.is_empty() or not valley.focus_resident(selected):
		_stop_follow()
		status.text = "跟随已停止：目标不在当前有效视图中"

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_MIDDLE and not event.pressed:
		dragging = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		dragging = false

func _unhandled_input(event: InputEvent) -> void:
	# Guard the entire visible panel, including padding and scroll boundaries.
	# The global middle-button release above still ends a drag over the UI.
	if event is InputEventMouse and observer_panel != null and observer_panel.is_visible_in_tree() and observer_panel.get_global_rect().has_point(event.position):
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_MIDDLE:
			if event.pressed: _stop_follow()
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
	if not valley.room_layouts.has(valley.room_id):
		room_hint.text = "原住宅布局已不可用"
		return
	var unknown := 0
	var occupants := 0
	var selected_here := false
	for person in world.residents:
		if person.get("inside") == valley.room_id:
			occupants += 1
			if person.id == selected: selected_here = true
		if person.get("inside") == valley.room_id and not Snapshot.resident_room_position(person.get("roomAt"),valley.room_layouts[valley.room_id]): unknown += 1
	room_hint.text = "住宅内部 · %s 人在家" % occupants
	if occupants == 0: room_hint.text += "\n此刻无人在屋内，居民仍在室外生活"
	elif not selected_here: room_hint.text += "\n所选居民不在这间屋内"
	if unknown > 0: room_hint.text += "\n%s 位居民位置暂不可见" % unknown

func _enter_room() -> void:
	_stop_follow()
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
	_stop_follow()
	valley.leave_room(world)
	valley.show_world(world,selected,false)
	_room_status()

func _bed_count() -> int:
	var count := 0
	for slot in valley.room_layouts.get(valley.room_id, {}).get("slots", []):
		if slot.get("kind") == "bed": count += 1
	return count
