extends Node3D

const Valley3D = preload("res://valley_3d.gd")
const ObserverHud = preload("res://observer_hud.gd")
const JournalRecords = preload("res://journal_records.gd")
const Snapshot = preload("res://snapshot.gd")
const MovementFeed = preload("res://completed_movement.gd")

var valley: Valley3D
var hud: ObserverHud
var movement_feed := MovementFeed.new()
var http: HTTPRequest
var timer: Timer
var world: Dictionary = {}
var observation: Dictionary = {}
var selected_resident := ""
var selected_building := ""
var active_endpoint := ""
var mode_text := ""
var source_tag := ""
var decision_source := ""
var connected := false
var busy := false
var following := false
var dragging := false
var pointer_start := Vector2.ZERO
var pointer_button := MOUSE_BUTTON_NONE
var hover_checked_at := 0
var notice_until := 0

func _ready() -> void:
	valley = Valley3D.new()
	add_child(valley)
	hud = ObserverHud.new()
	add_child(hud)
	hud.overview_requested.connect(_recenter)
	hud.resident_requested.connect(_choose_resident)
	hud.building_requested.connect(_choose_building)
	hud.doorway_requested.connect(_enter_selected_building)
	hud.outside_requested.connect(_leave_room)
	hud.locate_requested.connect(_locate_resident)
	hud.follow_changed.connect(_set_follow)
	hud.zoom_requested.connect(valley.zoom)
	hud.reconnect_requested.connect(_connect_server)
	hud.place_labels_changed.connect(valley.set_place_labels)
	http = HTTPRequest.new()
	http.timeout = 8.0
	http.body_size_limit = 33554432
	http.request_completed.connect(_received)
	add_child(http)
	timer = Timer.new()
	timer.wait_time = 2.0
	timer.timeout.connect(_poll)
	add_child(timer)
	if OS.has_feature("web"):
		_connect_server.call_deferred("")

func _connect_server(origin: String) -> void:
	var url := origin.strip_edges().trim_suffix("/")
	if OS.has_feature("web"):
		url = str(JavaScriptBridge.eval("window.location.origin"))
	if not (url.begins_with("http://") or url.begins_with("https://")) or "@" in url or "?" in url or "#" in url:
		_notice("请填写 HTTP(S) 观察地址")
		return
	http.cancel_request()
	timer.stop()
	busy = false
	connected = false
	active_endpoint = url
	mode_text = "等待新的世界快照"
	movement_feed.reset()
	valley.settle_motion()
	_set_follow(false)
	_reset_context()
	world = {}
	observation = {}
	valley.room_layouts = {}
	valley.show_world(world, "")
	hud.show_feedback("正在连接山谷…")
	notice_until = 0
	_update_hud()
	timer.start()
	_poll()

func _poll() -> void:
	if busy: return
	busy = true
	var error := http.request(active_endpoint + "/ai-town/api/world")
	if error != OK:
		busy = false
		_connection_lost("连接中断，正在重试")

func _received(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	busy = false
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_connection_lost("连接中断，正在重试")
		return
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if not Snapshot.validate(parsed).is_empty():
		_connection_lost("收到无效的世界快照")
		return
	if not world.is_empty() and world.id == parsed.world.id and parsed.world.revision < world.revision:
		_connection_lost("收到早于当前画面的快照，正在重试")
		return
	if parsed.world.map.width * parsed.world.map.height > 4096 or parsed.world.residents.size() > 64 or parsed.world.get("resources", []).size() > 256 or parsed.world.get("buildings", []).size() > 64:
		_connection_lost("地图超出当前观察范围")
		return

	var reset: bool = world.is_empty() or world.id != parsed.world.id
	var continuous: bool = connected and not reset
	if reset: _reset_context()
	world = parsed.world
	observation = parsed.get("observation", {}) if parsed.get("observation") is Dictionary else {}
	valley.room_layouts = Snapshot.room_views(parsed)
	mode_text = Snapshot.mode_label(parsed)
	var mode: Dictionary = parsed.get("mvp", {})
	decision_source = str(mode.get("driver", ""))
	source_tag = {"local-rules": "规则演示", "model": "已配置模型", "disabled": "模型禁用"}.get(decision_source, "")
	connected = true
	if not continuous:
		notice_until = 0
		hud.show_feedback("")
	if reset: valley.center(world)
	if not selected_resident.is_empty() and _resident(selected_resident).is_empty():
		_choose_resident("")
	if not selected_building.is_empty() and _building(selected_building).is_empty():
		_choose_building("")
	var paths: Dictionary = movement_feed.observe(world, parsed.get("movement"))
	if paths.is_empty(): valley.settle_motion()
	valley.show_world(world, selected_resident, continuous, paths)
	if following and not valley.focus_resident(selected_resident):
		_locate_resident()
	_update_hud()

func _connection_lost(reason: String) -> void:
	var was_connected := connected
	connected = false
	observation = {}
	mode_text = "数据过期 · 当前决策来源未知"
	movement_feed.reset()
	valley.settle_motion()
	valley.room_layouts = {}
	_set_follow(false)
	if not valley.room_id.is_empty():
		valley.leave_room(world)
		valley.show_world(world, selected_resident, false)
	if was_connected: hud.set_hover("", Vector2.ZERO)
	hud.show_feedback(reason + " · 画面已过期")
	notice_until = 0
	_update_hud()

func _reset_context() -> void:
	hud.close_journal()
	if not valley.room_id.is_empty(): valley.leave_room(world)
	selected_resident = ""
	selected_building = ""
	hud.select_resident("")
	hud.show_place("", "", "", false)
	hud.set_hover("", Vector2.ZERO)
	hud.show_room("", "")
	_set_follow(false)

func _resident(id: String) -> Dictionary:
	for person in world.get("residents", []):
		if person.id == id: return person
	return {}

func _building(id: String) -> Dictionary:
	for building in world.get("buildings", []):
		if building.get("id") == id: return building
	return {}

func _building_name(building: Dictionary) -> String:
	var name_text: Variant = building.get("name")
	if name_text is String and not name_text.strip_edges().is_empty():
		return name_text.strip_edges().left(30)
	return "未命名场所"

func _location(person: Dictionary) -> String:
	if person.get("status") != "alive": return Snapshot.resident_status(person)
	if person.get("regionalLocation") != null or person.get("residency") == "outside": return "在谷外"
	if person.get("inside") == null: return "在室外"
	var building := _building(str(person.inside))
	return "在" + _building_name(building) if not building.is_empty() else "在室内 · 场所未知"

func _can_locate(person: Dictionary) -> bool:
	if not connected or person.is_empty() or person.get("status") != "alive":
		return false
	if person.get("regionalLocation") != null or person.get("residency") == "outside":
		return false
	if person.get("inside") == null:
		return person.at.x >= 0 and person.at.x < world.map.width and person.at.y >= 0 and person.at.y < world.map.height
	var layout: Dictionary = valley.room_layouts.get(str(person.inside), {})
	return not layout.is_empty() and Snapshot.resident_room_position(person.get("roomAt"), layout)

func _choose_resident(id: String, locate := true) -> void:
	if not id.is_empty() and (not connected or _resident(id).is_empty()):
		_notice("等待新的居民位置")
		return
	_set_follow(false)
	selected_resident = id
	selected_building = ""
	hud.show_place("", "", "", false)
	hud.select_resident(id)
	valley.select_resident(id)
	_update_resident_card()
	if locate and _can_locate(_resident(id)): _locate_resident()

func _choose_building(id: String, locate := true) -> void:
	if id.is_empty():
		selected_building = ""
		hud.show_place("", "", "", false)
		return
	if not connected or _building(id).is_empty():
		_notice("等待新的场所信息")
		return
	_set_follow(false)
	selected_resident = ""
	hud.select_resident("")
	valley.select_resident("")
	selected_building = id
	if not valley.room_id.is_empty():
		_leave_room()
	if locate: valley.frame_building(id)
	_update_place_card()

func _enter_selected_building(id: String) -> void:
	if not connected or id.is_empty() or id != selected_building or not valley.room_layouts.has(id):
		_notice("这个场所的室内暂不可观察")
		return
	_set_follow(false)
	_enter_room(id)

func _enter_room(id: String) -> bool:
	if not valley.enter_room(world, id): return false
	hud.dissolve()
	hud.set_hover("", Vector2.ZERO)
	valley.show_world(world, selected_resident, true)
	_update_place_card()
	return true

func _leave_room() -> void:
	if valley.room_id.is_empty(): return
	_set_follow(false)
	valley.leave_room(world)
	hud.dissolve()
	valley.show_world(world, selected_resident, connected)
	_update_place_card()

func _recenter() -> void:
	if world.is_empty(): return
	if not valley.room_id.is_empty(): _leave_room()
	_reset_context()
	valley.select_resident("")
	valley.center(world)

func _locate_resident() -> void:
	var person := _resident(selected_resident)
	if not _can_locate(person):
		_set_follow(false)
		_notice("这位居民的位置暂不可见")
		return
	var room: String = str(person.get("inside", "")) if person.get("inside") != null else ""
	if room != valley.room_id:
		if room.is_empty():
			valley.leave_room(world)
			hud.dissolve()
			valley.show_world(world, selected_resident, true)
			_update_place_card()
		else:
			_enter_room(room)
	if valley.focus_resident(selected_resident): valley.close_view()

func _set_follow(enabled: bool) -> void:
	following = enabled and _can_locate(_resident(selected_resident))
	if enabled and not following: _notice("这位居民的位置暂不可见")
	if following: _locate_resident()
	_update_resident_card()

func _update_hud() -> void:
	var people := {}
	var places := {}
	for person in world.get("residents", []):
		people[person.id] = {"title": Snapshot.resident_name(person), "note": _location(person)}
	for building in world.get("buildings", []):
		var id := str(building.get("id", ""))
		if id.is_empty(): continue
		var kind := "可看室内" if valley.room_layouts.has(id) else "仅外观"
		places[id] = {"title": _building_name(building), "note": kind, "kind": str(building.get("kind", ""))}
	hud.update_directory(people, places)
	var summary := Snapshot.world_summary(world) if connected else ""
	var clock := summary.get_slice("\n", 0).trim_suffix("（世界时间）") if connected else "世界时间未知"
	var transport := "已断开"
	if connected:
		transport = "世界已暂停" if world.clock.paused else "世界运行中"
		transport += " · 快照 " + Snapshot.number_label(world.revision)
		if world.clock.paused and notice_until == 0: hud.show_feedback("世界已暂停")
		elif notice_until == 0: hud.show_feedback("")
	hud.show_transport(clock, mode_text, transport, summary.get_slice("\n", 1), Snapshot.model_status(observation), source_tag if connected else "")
	_update_resident_card()
	_update_place_card()
	_update_history()

func _update_resident_card() -> void:
	var person := _resident(selected_resident)
	if person.is_empty(): return
	var location := _location(person) if connected else "位置已过期"
	var action := Snapshot.life_action(person, world) if connected else "等待新的世界快照"
	if action == "暂无进行中行为 · 决策状态未知": action = "暂无进行中的行动"
	var details := ""
	if connected:
		details = Snapshot.inventory_label(person) + "\n"
		details += "健康 %s  ·  饥饿 %s  ·  精力 %s\n" % [Snapshot.number_label(person.get("health")), Snapshot.number_label(person.get("hunger")), Snapshot.number_label(person.get("energy"))]
		details += Snapshot.thirst_label(world, person.id) + "\n\n"
		details += Snapshot.memory_summary(person)
	hud.show_resident(person, location, action, details, _can_locate(person), following)

func _occupants(id: String) -> int:
	var count := 0
	for person in world.get("residents", []):
		if person.get("inside") == id and person.get("status") == "alive" and person.get("regionalLocation") == null and person.get("residency") != "outside":
			count += 1
	return count

func _update_place_card() -> void:
	var building := _building(selected_building)
	var room := _building(valley.room_id)
	if room.is_empty():
		hud.show_room("", "")
	else:
		hud.show_room(_building_name(room), "%s 人在室内" % _occupants(valley.room_id))
	if building.is_empty() or not connected:
		hud.show_place("", "", "", false)
		return
	var can_enter: bool = valley.room_layouts.has(selected_building)
	var note := "%s 人在室内" % _occupants(selected_building) if can_enter else "室内暂不可观察"
	hud.show_place(selected_building, _building_name(building), note, can_enter)

func _update_history() -> void:
	var records: Array[Dictionary] = []
	if connected:
		records = JournalRecords.from_world(world, decision_source)
	hud.show_history(records, connected)

func _notice(message: String) -> void:
	notice_until = Time.get_ticks_msec() + 3200
	hud.show_feedback(message)

func _process(_delta: float) -> void:
	if following and not valley.focus_resident(selected_resident):
		_set_follow(false)
	if not selected_building.is_empty() and valley.room_id.is_empty() and connected:
		var screen: Vector2 = valley.building_screen_position(selected_building)
		var view := get_viewport().get_visible_rect().grow(-10)
		hud.position_place(screen, view.has_point(screen))
	if notice_until != 0 and Time.get_ticks_msec() >= notice_until:
		notice_until = 0
		if connected:
			hud.show_feedback("世界已暂停" if world.clock.paused else "")
		else:
			hud.show_feedback("未连接 · 画面已过期")

func _over_controls(point: Vector2) -> bool:
	return hud != null and hud.covers_screen_point(point)

func _input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and _over_controls(event.position):
		Input.set_default_cursor_shape(Input.CURSOR_ARROW)
		hud.set_hover("", Vector2.ZERO)
	if event is InputEventMouseButton and event.button_index == pointer_button and not event.pressed and _over_controls(event.position):
		_end_pointer()

func _end_pointer() -> void:
	Input.set_default_cursor_shape(Input.CURSOR_ARROW)
	dragging = false
	pointer_button = MOUSE_BUTTON_NONE

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT: _end_pointer()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		if hud.journal_open(): hud.close_journal()
		elif not valley.room_id.is_empty(): _leave_room()
		elif hud.has_drawer(): hud.close_drawer()
		else: _choose_building("")
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouse and _over_controls(event.position): return
	if event is InputEventMouseButton:
		if event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			valley.zoom(.87 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 1.15)
		if event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_MIDDLE]:
			if event.pressed and pointer_button == MOUSE_BUTTON_NONE:
				pointer_start = event.position
				pointer_button = event.button_index
			elif not event.pressed and event.button_index == pointer_button:
				var click: bool = pointer_button == MOUSE_BUTTON_LEFT and not dragging and event.position.distance_to(pointer_start) < 6.0
				_end_pointer()
				if click: _inspect_at(event.position)
	if event is InputEventMouseMotion:
		if pointer_button == MOUSE_BUTTON_NONE:
			_hover_at(event.position)
			return
		if not dragging and event.position.distance_to(pointer_start) >= 6.0:
			dragging = true
			Input.set_default_cursor_shape(Input.CURSOR_MOVE)
			hud.set_hover("", Vector2.ZERO)
			_set_follow(false)
		if dragging: valley.pan(event.relative)

func _inspect_at(position: Vector2) -> void:
	if not connected: return
	hud.set_hover("", Vector2.ZERO)
	var target: Dictionary = valley.pick(position)
	if target.has("resident"):
		_choose_resident(target.resident)
	elif target.has("building"):
		_choose_building(target.building, false)
	else:
		_choose_resident("", false)

func _hover_at(position: Vector2) -> void:
	if not connected or Time.get_ticks_msec() - hover_checked_at < 90: return
	hover_checked_at = Time.get_ticks_msec()
	var target: Dictionary = valley.pick(position)
	var caption := ""
	if target.has("resident") and target.resident != selected_resident:
		caption = Snapshot.resident_name(_resident(target.resident))
	elif target.has("building") and target.building != selected_building:
		caption = _building_name(_building(target.building))
	hud.set_hover(caption, position)
	Input.set_default_cursor_shape(Input.CURSOR_POINTING_HAND if not target.is_empty() else Input.CURSOR_ARROW)
