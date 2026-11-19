extends Node3D

const Valley3D = preload("res://valley_3d.gd")
const EnvironmentPreview = preload("res://environment_preview.gd")
const ObserverHud = preload("res://observer_hud.gd")
const JournalRecords = preload("res://journal_records.gd")
const Snapshot = preload("res://snapshot.gd")
const SeedObservation = preload("res://seed_observation.gd")
const MealObservation = preload("res://meal_observation.gd")
const AgricultureObservation = preload("res://agriculture_observation.gd")
const PreservationObservation = preload("res://preservation_observation.gd")
const ValleySpirit = preload("res://valley_spirit.gd")
const ValleySpiritArchive = preload("res://valley_spirit_archive.gd")
const ValleySpiritLife = preload("res://valley_spirit_life.gd")
const SoilObservation = preload("res://soil_observation.gd")
const GardenObservation = preload("res://garden_observation.gd")
const MovementFeed = preload("res://completed_movement.gd")
const ResidentMovement = preload("res://resident_movement.gd")

var valley: Valley3D
var hud: ObserverHud
var movement_feed := MovementFeed.new()
var resident_movement := ResidentMovement.new()
var http: HTTPRequest
var timer: Timer
var world: Dictionary = {}
var observation: Dictionary = {}
var environment_preview: Dictionary = {}
var soil_observation: Dictionary = {}
var agriculture_observation: Dictionary = {}
var preservation_observation: Dictionary = {}
var resident_weather: Dictionary = {}
var meal_observation: Variant
var valley_spirit_snapshot: Dictionary = {}
var spirit_archive_context: Dictionary = {}
var spirit_archive_request: HTTPRequest
var spirit_life_context: Dictionary = {}
var spirit_life_request: HTTPRequest
var relationship_history: Variant
var selected_resident := ""
var selected_building := ""
var selected_plot := ""
var selected_resource := ""
var active_endpoint := ""
var mode_text := ""
var source_tag := ""
var decision_source := ""
var connected := false
var busy := false
var following := false
var doorway_active := false
var pending_snapshot := {}
var dragging := false
var pointer_start := Vector2.ZERO
var pointer_button := MOUSE_BUTTON_NONE
var hover_checked_at := 0
var notice_until := 0

func _ready() -> void:
	var demo := "--offline-choice-demo" in OS.get_cmdline_user_args()
	if OS.has_feature("web"):
		demo = bool(JavaScriptBridge.eval("new URLSearchParams(window.location.search).get('offlineChoiceDemo') === '1'"))
	if demo:
		var canvas := CanvasLayer.new()
		add_child(canvas)
		canvas.add_child(load("res://offline_choice_demo.gd").new())
		set_process(false)
		set_process_input(false)
		set_process_unhandled_input(false)
		return
	valley = Valley3D.new()
	add_child(valley)
	hud = ObserverHud.new()
	add_child(hud)
	hud.overview_requested.connect(_recenter)
	hud.resident_requested.connect(_choose_resident)
	hud.residence_requested.connect(_view_residence)
	hud.building_requested.connect(_choose_building)
	hud.doorway_requested.connect(_enter_selected_building)
	hud.outside_requested.connect(_leave_room)
	hud.locate_requested.connect(_locate_resident)
	hud.follow_changed.connect(_set_follow)
	hud.zoom_requested.connect(valley.zoom)
	hud.reconnect_requested.connect(_connect_server)
	hud.place_labels_changed.connect(valley.set_place_labels)
	hud.spirit_archive_requested.connect(_request_spirit_archive)
	hud.spirit_almanac_requested.connect(_request_spirit_almanac)
	hud.spirit_life_requested.connect(_request_spirit_life)
	http = HTTPRequest.new()
	http.timeout = 8.0
	http.body_size_limit = 33554432
	http.request_completed.connect(_received)
	add_child(http)
	timer = Timer.new()
	timer.wait_time = Valley3D.SNAPSHOT_SECONDS
	timer.timeout.connect(_poll)
	add_child(timer)
	if OS.has_feature("web"):
		_connect_server.call_deferred("")

func _connect_server(origin: String) -> void:
	var url := origin.strip_edges().trim_suffix("/")
	if OS.has_feature("web"):
		url = str(JavaScriptBridge.eval("new URL('./', window.location.href).href")).trim_suffix("/")
	if not (url.begins_with("http://") or url.begins_with("https://")) or "@" in url or "?" in url or "#" in url:
		_notice("请填写 HTTP(S) 观察地址")
		return
	http.cancel_request()
	timer.stop()
	busy = false
	connected = false
	active_endpoint = url
	_set_archive_authority({})
	_set_spirit_life_authority({})
	mode_text = "等待新的世界快照"
	movement_feed.reset()
	resident_movement.reset()
	valley.settle_motion()
	_set_follow(false)
	_reset_context()
	environment_preview = {}
	soil_observation = {}
	agriculture_observation = {}
	preservation_observation = {}
	resident_weather = {}
	meal_observation = null
	valley_spirit_snapshot = {}
	valley.agriculture_observation = {}
	valley.environment_preview = {}
	world = {}
	observation = {}
	relationship_history = null
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
	var buffered_world: Dictionary = pending_snapshot.get("world", {})
	var older_than_applied: bool = not world.is_empty() and world.id == parsed.world.id and parsed.world.revision < world.revision
	var older_than_buffered: bool = not buffered_world.is_empty() and buffered_world.id == parsed.world.id and parsed.world.revision < buffered_world.revision
	if older_than_applied or older_than_buffered:
		_connection_lost("收到早于当前画面的快照，正在重试")
		return
	if parsed.world.map.width * parsed.world.map.height > 4096 or parsed.world.residents.size() > 64 or parsed.world.get("resources", []).size() > 256 or parsed.world.get("buildings", []).size() > 64:
		_connection_lost("地图超出当前观察范围")
		return
	if doorway_active:
		_quarantine_pending_spirit_projection(parsed)
		_quarantine_pending_spirit_life(parsed)
		pending_snapshot = parsed
		return
	_apply_snapshot(parsed)

func _apply_snapshot(parsed: Dictionary) -> void:
	var reset: bool = world.is_empty() or world.id != parsed.world.id
	var map_resized: bool = not reset and (world.map.width != parsed.world.map.width or world.map.height != parsed.world.map.height)
	var continuous: bool = connected and not reset
	if reset: _reset_context()
	world = parsed.world
	observation = parsed.get("observation", {}) if parsed.get("observation") is Dictionary else {}
	relationship_history = parsed.get("relationshipHistory")
	valley.room_layouts = Snapshot.room_views(parsed)
	mode_text = Snapshot.mode_label(parsed)
	var mode: Dictionary = parsed.get("mvp", {})
	decision_source = str(mode.get("driver", ""))
	environment_preview = EnvironmentPreview.from_snapshot(parsed)
	soil_observation = SoilObservation.from_snapshot(parsed)
	agriculture_observation = AgricultureObservation.from_snapshot(parsed)
	preservation_observation = PreservationObservation.from_snapshot(parsed)
	meal_observation = mode.get("mealObservation")
	var perceptions: Variant = mode.get("residentWeather")
	resident_weather = perceptions if perceptions is Dictionary else {}
	valley_spirit_snapshot = {"world":{"id":world.id,"revision":world.revision,"minute":world.minute},"valleySpirit":parsed.get("valleySpirit")}
	valley.agriculture_observation = agriculture_observation.get("plots", {})
	valley.environment_preview = environment_preview
	source_tag = {"local-rules": "规则演示 · 非模型", "model": "已配置模型", "disabled": "模型禁用"}.get(decision_source, "")
	if mode.get("fault") == "unresolved_model_request": source_tag = "保护停表"
	connected = true
	_set_archive_authority(ValleySpiritArchive.authority(valley_spirit_snapshot))
	_set_spirit_life_authority(ValleySpiritLife.context(parsed))
	if not continuous:
		notice_until = 0
		hud.show_feedback("")
	if reset or (map_resized and valley.room_id.is_empty()): valley.center(world, true)
	if not selected_resident.is_empty() and _resident(selected_resident).is_empty():
		_choose_resident("")
	if not selected_resource.is_empty() and _resource(selected_resource).is_empty():
		_choose_building("")
	if not selected_plot.is_empty() and _plot(selected_plot).is_empty():
		_choose_building("")
	if not selected_building.is_empty() and _building(selected_building).is_empty():
		_choose_building("")
	var paths: Dictionary = movement_feed.observe(world, parsed.get("movement"))
	var trails := resident_movement.observe(world, parsed.get("residentMovement"), valley.room_layouts)
	if continuous and following and _follow_doorway(trails): return
	if not trails.is_empty() or not valley.room_id.is_empty():
		paths = ResidentMovement.paths_in_scene(trails, valley.room_id)
	valley.show_world(world, selected_resident, continuous, paths)
	if following and not valley.focus_resident(selected_resident):
		_locate_resident()
	_update_hud()

func _follow_doorway(trails: Dictionary) -> bool:
	var id := selected_resident
	var path: Array = trails.get(id, [])
	if path.size() < 2 or path[0].roomId != valley.room_id: return false
	var room: String = path[-1].roomId
	if room == valley.room_id: return false
	var cut := 1
	while cut < path.size() and path[cut].roomId == valley.room_id:
		cut += 1
	for index in range(cut, path.size()):
		if path[index].roomId != room: return false
	var offset := Vector3(0, 0, .38 if room.is_empty() else -.38)
	var departure := valley.walk_doorway(id, path.slice(0, cut), offset, false)
	if departure <= 0.0: return false
	var arrival := path.slice(cut)
	var other_paths := ResidentMovement.paths_in_scene(trails, room)
	other_paths.erase(id)
	doorway_active = true
	hud.pass_doorway(departure, Valley3D.DOORWAY_PLAYBACK_SECONDS, func() -> void:
		var size := valley.camera.size
		if room.is_empty():
			valley.leave_room(world)
		else:
			valley.enter_room(world, room)
		valley.show_world(world, id, true, other_paths)
		valley.walk_doorway(id, arrival, offset, true)
		valley.match_follow_view(id, size)
		hud.set_hover("", Vector2.ZERO)
		_update_hud()
	, _finish_doorway)
	return true

func _finish_doorway() -> void:
	doorway_active = false
	var queued := pending_snapshot
	pending_snapshot = {}
	if not queued.is_empty(): _apply_snapshot(queued)

func _cancel_doorway() -> void:
	if not doorway_active: return
	doorway_active = false
	pending_snapshot = {}
	hud.clear_fade()
	valley.settle_motion()
	valley.show_world(world, selected_resident, connected)

func _connection_lost(reason: String) -> void:
	var was_connected := connected
	connected = false
	_set_archive_authority({})
	_set_spirit_life_authority({})
	observation = {}
	relationship_history = null
	mode_text = "数据过期 · 当前决策来源未知"
	movement_feed.reset()
	resident_movement.reset()
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
	_cancel_doorway()
	hud.close_book()
	if not valley.room_id.is_empty(): valley.leave_room(world)
	selected_resident = ""
	selected_building = ""
	selected_plot = ""
	selected_resource = ""
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

func _plot(id: String) -> Dictionary:
	for plot in world.get("plots", []):
		if plot is Dictionary and plot.get("id") == id and id.begins_with("mvp-garden-"): return plot
	return {}

func _choose_plot(id: String, locate := true) -> void:
	if not connected or _plot(id).is_empty():
		_notice("等待新的菜园信息")
		return
	_set_follow(false)
	selected_resident = ""
	selected_building = ""
	selected_plot = id
	selected_resource = ""
	hud.select_resident("")
	valley.select_resident("")
	if not valley.room_id.is_empty(): _leave_room()
	if locate: valley.frame_plot(id)
	_update_place_card()

func _resource(id: String) -> Dictionary:
	for resource in world.get("resources", []):
		if resource.get("id") == id and resource.get("kind") in ["bush", "spring", "tree", "rock"]: return resource
	return {}

func _resource_title(resource: Dictionary) -> String:
	if resource.is_empty(): return "资源地点"
	var title := Snapshot.resource_place_name(world.map, resource)
	if resource.kind == "spring" and title != Snapshot.resource_name(resource.kind): return title
	return "%s · %d,%d" % [title, int(resource.at.x), int(resource.at.y)]

func _resource_stock(resource: Dictionary) -> String:
	var amount: Variant = resource.get("amount")
	if not (amount is float or amount is int) or not is_finite(float(amount)) or amount < 0:
		return "当前余量未知"
	var capacity: Variant = resource.get("max")
	var stock := "当前已耗尽" if amount == 0 else "当前余量 %s 份" % str(amount)
	if (capacity is float or capacity is int) and is_finite(float(capacity)) and capacity >= amount:
		stock += " · 容量 %s" % str(capacity)
	return stock

func _choose_resource(id: String, locate := true) -> void:
	if not connected or _resource(id).is_empty():
		_notice("等待新的资源信息")
		return
	_set_follow(false)
	selected_resident = ""
	selected_building = ""
	selected_plot = ""
	selected_resource = id
	hud.select_resident("")
	valley.select_resident("")
	if not valley.room_id.is_empty(): _leave_room()
	if locate: valley.frame_resource(id)
	_update_place_card()

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
	selected_plot = ""
	selected_resource = ""
	hud.show_place("", "", "", false)
	hud.select_resident(id)
	valley.select_resident(id)
	_update_resident_card()
	if locate and _can_locate(_resident(id)): _locate_resident()

func _choose_building(id: String, locate := true) -> void:
	if not _resource(id).is_empty():
		_choose_resource(id, locate)
		return
	if not _plot(id).is_empty():
		_choose_plot(id, locate)
		return
	if id.is_empty():
		selected_building = ""
		selected_plot = ""
		selected_resource = ""
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
	selected_plot = ""
	selected_resource = ""
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

func _view_residence() -> void:
	var person := _resident(selected_resident)
	var id := str(person.get("homeId", ""))
	if not connected or not valley.room_layouts.has(id): return
	if valley.room_id == id: return
	_choose_building(id, false)
	_enter_selected_building(id)

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
	_cancel_doorway()
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
	_cancel_doorway()
	following = enabled and _can_locate(_resident(selected_resident))
	if enabled and not following: _notice("这位居民的位置暂不可见")
	if following: _locate_resident()
	_update_resident_card()

# Do not leave the prior public text visible while the scene buffers an
# authority change. Clear both the rendered and the retained projections.
func _quarantine_pending_spirit_projection(parsed: Dictionary) -> void:
	if ValleySpiritArchive.same_authority(spirit_archive_context, ValleySpiritArchive.authority(parsed)): return
	valley_spirit_snapshot = {"publicProjectionPending": true}
	_set_archive_authority({})
	hud.show_spirit(ValleySpirit.text(valley_spirit_snapshot, connected))

func _set_archive_authority(next: Dictionary) -> void:
	var stable := ValleySpiritArchive.same_authority(spirit_archive_context, next)
	spirit_archive_context = next
	if stable: return
	if spirit_archive_request != null:
		spirit_archive_request.cancel_request()
		spirit_archive_request.queue_free()
		spirit_archive_request = null
	hud.show_spirit_archive(not next.is_empty(), false, "")
	hud.show_spirit_almanac(not next.is_empty(), false, "")

func _request_spirit_archive() -> void:
	if not connected or spirit_archive_context.is_empty() or spirit_archive_request != null: return
	var requested := ValleySpiritArchive.latest_range(spirit_archive_context)
	if requested.is_empty():
		hud.show_spirit_archive(true, false, "还没有已结束的游戏小时。")
		return
	var request := HTTPRequest.new()
	request.timeout = 6.0
	request.body_size_limit = 65536
	request.max_redirects = 0
	add_child(request)
	spirit_archive_request = request
	request.request_completed.connect(_spirit_archive_received.bind(request, spirit_archive_context.duplicate(), requested))
	hud.show_spirit_archive(true, true, "正在读取天气档案…")
	var endpoint := active_endpoint + "/ai-town/api/valley-spirit/archive?fromHour=%d&toHour=%d&limit=24" % [requested.fromHour, requested.toHour]
	if request.request(endpoint) != OK:
		_spirit_archive_received(HTTPRequest.RESULT_CANT_CONNECT, 0, PackedStringArray(), PackedByteArray(), request, spirit_archive_context, requested)

func _spirit_archive_received(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, request: HTTPRequest, grant: Dictionary, requested: Dictionary) -> void:
	if request != spirit_archive_request: return
	spirit_archive_request = null
	request.queue_free()
	if not connected or not ValleySpiritArchive.same_authority(grant, spirit_archive_context):
		hud.show_spirit_archive(false, false, "")
		return
	var text := ""
	if result == HTTPRequest.RESULT_SUCCESS and code == 200:
		text = ValleySpiritArchive.presentation(JSON.parse_string(body.get_string_from_utf8()), spirit_archive_context, requested)
	if text.is_empty(): text = "天气档案暂不可读；不保留旧数据。"
	hud.show_spirit_archive(true, false, text)

func _request_spirit_almanac() -> void:
	if not connected or spirit_archive_context.is_empty() or spirit_archive_request != null: return
	var request := HTTPRequest.new()
	request.timeout = 6.0
	request.body_size_limit = 65536
	request.max_redirects = 0
	add_child(request)
	spirit_archive_request = request
	request.request_completed.connect(_spirit_almanac_received.bind(request, spirit_archive_context.duplicate()))
	hud.show_spirit_almanac(true, true, "正在读取年鉴…")
	if request.request(active_endpoint + "/ai-town/api/valley-spirit/almanac/latest") != OK:
		_spirit_almanac_received(HTTPRequest.RESULT_CANT_CONNECT, 0, PackedStringArray(), PackedByteArray(), request, spirit_archive_context)

func _spirit_almanac_received(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, request: HTTPRequest, grant: Dictionary) -> void:
	if request != spirit_archive_request: return
	spirit_archive_request = null
	request.queue_free()
	if not connected or not ValleySpiritArchive.same_authority(grant, spirit_archive_context):
		hud.show_spirit_almanac(false, false, "")
		return
	var display := ""
	if result == HTTPRequest.RESULT_SUCCESS and code == 200:
		display = ValleySpiritArchive.almanac_presentation(JSON.parse_string(body.get_string_from_utf8()), spirit_archive_context)
	if display.is_empty(): display = "年鉴暂不可读；不保留旧数据。"
	hud.show_spirit_almanac(true, false, display)

func _quarantine_pending_spirit_life(parsed: Dictionary) -> void:
	if not ValleySpiritLife.same_authority(spirit_life_context, ValleySpiritLife.context(parsed)):
		_set_spirit_life_authority({})

func _set_spirit_life_authority(next: Dictionary) -> void:
	var stable := ValleySpiritLife.same_authority(spirit_life_context, next)
	spirit_life_context = next
	if stable: return
	if spirit_life_request != null:
		spirit_life_request.cancel_request()
		spirit_life_request.queue_free()
		spirit_life_request = null
	hud.show_spirit_life(not next.is_empty(), false, "")

func _request_spirit_life() -> void:
	if not connected or spirit_life_context.is_empty() or spirit_life_request != null: return
	var request := HTTPRequest.new()
	request.timeout = 6.0
	request.body_size_limit = 65536
	request.max_redirects = 0
	add_child(request)
	spirit_life_request = request
	request.request_completed.connect(_spirit_life_received.bind(request, spirit_life_context.duplicate()))
	hud.show_spirit_life(true, true, "正在查阅生活年鉴…")
	var endpoint := active_endpoint + "/ai-town/api/valley-spirit/almanac/life/latest?worldId=" + str(spirit_life_context.worldId).uri_encode()
	if request.request(endpoint) != OK:
		_spirit_life_received(HTTPRequest.RESULT_CANT_CONNECT, 0, PackedStringArray(), PackedByteArray(), request, spirit_life_context)

func _spirit_life_received(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, request: HTTPRequest, expected: Dictionary) -> void:
	if request != spirit_life_request: return
	spirit_life_request = null
	request.queue_free()
	if not connected or not ValleySpiritLife.same_authority(expected, spirit_life_context):
		return
	var text := ""
	if result == HTTPRequest.RESULT_SUCCESS and code == 200:
		text = ValleySpiritLife.presentation(JSON.parse_string(body.get_string_from_utf8()), spirit_life_context)
	if text.is_empty():
		# The attached view denied the latest read or its response was not current.
		# Do not offer cached data; only a newly received marker can restore access.
		_set_spirit_life_authority({})
		return
	hud.show_spirit_life(true, false, text)

func _update_hud() -> void:
	hud.show_spirit(ValleySpirit.text(valley_spirit_snapshot, connected))
	var people := {}
	var places := {}
	for person in world.get("residents", []):
		people[person.id] = {"title": Snapshot.resident_name(person), "note": _location(person)}
	for building in world.get("buildings", []):
		var id := str(building.get("id", ""))
		if id.is_empty(): continue
		var kind := "可看室内" if valley.room_layouts.has(id) else "仅外观"
		var layout: Dictionary = valley.room_layouts.get(id, {})
		if layout.get("style") == "hall":
			kind = "四人共用 · 做饭与用餐"
		elif layout.get("style") in ["grower", "craft", "family"]:
			var names := PackedStringArray()
			for resident in building.get("residents", []):
				var person := _resident(str(resident))
				if not person.is_empty(): names.append(Snapshot.resident_name(person))
			if not names.is_empty(): kind = "、".join(names) + ("的卧室" if names.size() == 1 else "同住")
		places[id] = {"title": _building_name(building), "note": kind, "kind": str(building.get("kind", ""))}
	for plot in world.get("plots", []):
		if not plot is Dictionary or not str(plot.get("id", "")).begins_with("mvp-garden-"): continue
		places[plot.id] = {"title": GardenObservation.title(world, plot), "note": GardenObservation.stage(world, plot, agriculture_observation.get("plots", {}).get(plot.id, {})) if connected else "状态已过期", "kind": "garden"}
	for resource in world.get("resources", []):
		if resource.get("kind") not in ["bush", "spring", "tree", "rock"]: continue
		places[resource.id] = {"title": _resource_title(resource), "note": _resource_stock(resource) if connected else "状态已过期", "kind": resource.kind}
	hud.update_directory(people, places)
	var summary := Snapshot.world_summary(world) if connected else ""
	var clock := summary.get_slice("\n", 0).trim_suffix("（世界时间）") if connected else "世界时间未知"
	var transport := "已断开"
	if connected:
		transport = "世界已暂停" if world.clock.paused else "世界运行中"
		transport += " · 快照 " + Snapshot.number_label(world.revision)
		if world.clock.paused and notice_until == 0: hud.show_feedback("世界已暂停")
		elif notice_until == 0: hud.show_feedback("")
	hud.show_environment(environment_preview, float(world.get("minute", 0)), not connected)
	hud.show_transport(clock, mode_text, transport, summary.get_slice("\n", 1), Snapshot.model_status(observation), source_tag if connected else "")
	_update_resident_card()
	_update_place_card()
	_update_history()
	hud.show_relations(world, relationship_history, connected)

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
		details += Snapshot.resident_weather_label(resident_weather, person, world.get("minute")) + "\n"
		if person.get("plan") is Dictionary: details += Snapshot.plan_summary(person) + "\n"
		details += PreservationObservation.details(preservation_observation, str(person.id)) + "\n\n"
		if world.get("mode") == "validation":
			details += MealObservation.details(meal_observation, str(person.id), world.get("minute")) + "\n\n"
		details += Snapshot.memory_summary(person)
	var home_id := str(person.get("homeId", ""))
	var residence := _building_name(_building(home_id)) if connected and valley.room_layouts.has(home_id) else ""
	hud.show_resident(person, location, action, details, _can_locate(person), following, residence)

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
		var caption := "%s 人在室内" % _occupants(valley.room_id)
		if valley.room_id == "mvp-home": caption += " · " + ("三季公共种源" if world.get("mvpClimate", {}).get("schemaVersion") == 3 else SeedObservation.stock_label(world))
		hud.show_room(_building_name(room), caption)
	if connected and not selected_resource.is_empty():
		var resource := _resource(selected_resource)
		if not resource.is_empty():
			var note := _resource_stock(resource) + Snapshot.resource_renewal(world, resource) + "\n采集须居民亲自到达并完成行动\n是否前往由居民自己决定\n资源余量不等于随身库存"
			hud.show_place(selected_resource, _resource_title(resource), note, false)
			return
	if connected and not selected_plot.is_empty():
		var plot := _plot(selected_plot)
		if not plot.is_empty():
			hud.show_place(selected_plot, GardenObservation.title(world, plot), GardenObservation.details(world, plot, not environment_preview.is_empty() or (world.get("mode") == "validation" and world.has("mvpClimate")), agriculture_observation.get("plots", {}).get(selected_plot, {})) + SoilObservation.details(soil_observation.get(selected_plot, {})), false)
			return
	if building.is_empty() or not connected:
		hud.show_place("", "", "", false)
		return
	var can_enter: bool = valley.room_layouts.has(selected_building)
	var note := "%s 人在室内" % _occupants(selected_building) if can_enter else "室内暂不可观察"
	if selected_building == "mvp-home": note += "\n" + (AgricultureObservation.seeds(agriculture_observation) if world.get("mvpClimate", {}).get("schemaVersion") == 3 else SeedObservation.details(world))
	if selected_building == "mvp-home": note += "\n" + PreservationObservation.station(preservation_observation)
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
	if following and not valley.focus_resident(selected_resident) and not doorway_active:
		_set_follow(false)
	if not selected_resource.is_empty() and valley.room_id.is_empty() and connected:
		var screen: Vector2 = valley.resource_screen_position(selected_resource)
		hud.position_place(screen, get_viewport().get_visible_rect().grow(-10).has_point(screen))
	if not selected_plot.is_empty() and valley.room_id.is_empty() and connected:
		var screen: Vector2 = valley.plot_screen_position(selected_plot)
		hud.position_place(screen, get_viewport().get_visible_rect().grow(-10).has_point(screen))
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
		if not hud.close_book():
			if not valley.room_id.is_empty(): _leave_room()
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
	elif target.has("resource"):
		_choose_resource(target.resource, false)
	elif target.has("plot"):
		_choose_plot(target.plot, false)
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
	elif target.has("resource") and target.resource != selected_resource:
		caption = _resource_title(_resource(target.resource))
	elif target.has("plot") and target.plot != selected_plot:
		caption = GardenObservation.title(world, _plot(target.plot))
	elif target.has("building") and target.building != selected_building:
		caption = _building_name(_building(target.building))
	hud.set_hover(caption, position)
	Input.set_default_cursor_shape(Input.CURSOR_POINTING_HAND if not target.is_empty() else Input.CURSOR_ARROW)
