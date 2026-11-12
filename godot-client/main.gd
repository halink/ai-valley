extends Node2D
const Snapshot = preload("res://snapshot.gd")
var world: Dictionary = {}
var selected := ""
var offset := Vector2(640, 180)
var magnification := 1.0
var dragging := false
var active_endpoint := ""
var endpoint: LineEdit
var status: Label
var detail: Label
var events_label: Label
var mode_label: Label
var http: HTTPRequest
var timer: Timer
var busy := false
var connected := false
var first := true

func _ready() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	panel.offset_bottom = 130
	layer.add_child(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	var title := Label.new()
	title.text = "AI Valley · small valley MVP foundation | Read-only · placeholder art"
	box.add_child(title)
	var row := HBoxContainer.new()
	box.add_child(row)
	endpoint = LineEdit.new()
	endpoint.text = "http://127.0.0.1:3414"
	endpoint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(endpoint)
	var connect_button := Button.new()
	connect_button.text = "Connect / reconnect"
	connect_button.pressed.connect(_connect_server)
	row.add_child(connect_button)
	var home := Button.new()
	home.text = "Recenter"
	home.pressed.connect(_recenter)
	row.add_child(home)
	var next_person := Button.new()
	next_person.text = "Next resident (including indoors)"
	next_person.pressed.connect(_next_resident)
	row.add_child(next_person)
	status = Label.new()
	status.text = "Not connected. Start isolated preview, then Connect. Drag: middle mouse · Zoom: wheel · Select: click"
	box.add_child(status)
	detail = Label.new()
	detail.text = "No resident selected. Indoor / off-map residents are not placed outdoors."
	box.add_child(detail)
	mode_label = Label.new()
	mode_label.text = "No simulation connected"
	box.add_child(mode_label)
	events_label = Label.new()
	events_label.text = "Recent events: none received"
	box.add_child(events_label)
	http = HTTPRequest.new()
	http.timeout = 8.0
	http.body_size_limit = 33554432
	http.request_completed.connect(_received)
	add_child(http)
	timer = Timer.new()
	timer.wait_time = 2.0
	timer.timeout.connect(_poll)
	add_child(timer)

func _connect_server() -> void:
	http.cancel_request()
	busy = false
	timer.stop()
	connected = false
	var url := endpoint.text.strip_edges().trim_suffix("/")
	# Explicit public observer address only, never credentials or query tokens.
	if not (url.begins_with("http://") or url.begins_with("https://")) or "@" in url or "?" in url or "#" in url:
		status.text = "Use an HTTP(S) origin without credentials, query or fragment."
		return
	endpoint.text = url
	active_endpoint = url
	world = {}
	selected = ""
	_update_detail()
	status.text = "Connecting · waiting for a new snapshot"
	mode_label.text = "No simulation connected"
	events_label.text = "Recent events: none received"
	first = true
	queue_redraw()
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
		status.text = "Disconnected: request could not start (%s). Last snapshot retained." % error

func _received(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	busy = false
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		connected = false
		status.text = "Disconnected / stale · HTTP %s, transport %s · retrying" % [code, result]
		return
	var parsed = JSON.parse_string(body.get_string_from_utf8())
	var problem: String = Snapshot.validate(parsed)
	if not problem.is_empty():
		connected = false
		status.text = "Rejected snapshot: " + problem + " · previous view is stale"
		return
	if not world.is_empty() and world.id == parsed.world.id and parsed.world.revision < world.revision:
		connected = false
		status.text = "Rejected older revision · previous view is stale · retrying"
		return
	var changed: bool = not world.is_empty() and world.id != parsed.world.id
	world = parsed.world
	connected = true
	if changed:
		selected = ""
		first = true
	if first:
		_recenter()
		first = false
	var paused: bool = world.get("clock", {}).get("paused", false)
	status.text = "Connected · revision %s · %s · full snapshot polling (2s), no SSE yet" % [world.revision, "PAUSED" if paused else "server clock running"]
	mode_label.text = Snapshot.mode_label(parsed)
	if paused:
		mode_label.text += " · reason: " + str(world.clock.get("reason", "unknown"))
	var lines: Array[String] = []
	for entry in world.get("events", []).slice(-3):
		lines.append(str(entry.get("text", "")))
	events_label.text = "Recent events:\n" + "\n".join(lines)
	_update_detail()
	queue_redraw()

func _recenter() -> void:
	if world.is_empty():
		return
	var at: Dictionary = world.map.get("settlement", {"x": world.map.width / 2, "y": world.map.height / 2})
	offset = get_viewport_rect().size * Vector2(0.5, 0.60) - Snapshot.project(at) * magnification
	queue_redraw()

func _update_detail() -> void:
	detail.text = "No resident selected. Indoor / off-map residents are not placed outdoors."
	for person in world.get("residents", []):
		if person.id == selected:
			detail.text = "%s · %s · health %s · %s" % [person.get("name", person.id), person.get("status", "unknown"), person.get("health", "unknown"), person.get("intention", "unknown")]
			detail.text += " · " + Snapshot.activity_label(person) + " · hunger %s · energy %s · berries %s" % [person.get("hunger", "?"), person.get("energy", "?"), person.get("inventory", {}).get("berry", 0)]
			detail.text += " · indoors" if person.get("inside") != null else " · outdoors"
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
	queue_redraw()

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
			var old := magnification
			magnification = clampf(magnification * (1.15 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 1.15), 0.35, 4.0)
			offset = event.position - (event.position - offset) * magnification / old
		if event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			selected = ""
			var nearest := 12.0 * magnification
			for person in world.get("residents", []):
				if not Snapshot.visible(person):
					continue
				var distance: float = (Snapshot.project(person.at) * magnification + offset - Vector2(0, 9) * magnification - event.position).length()
				if distance < nearest:
					nearest = distance
					selected = person.id
			_update_detail()
	if event is InputEventMouseMotion and dragging:
		offset += event.relative
	queue_redraw()

func _draw() -> void:
	if world.is_empty():
		return
	var colors := {"grass": "b0b88b", "water": "71999a", "path": "cbb591", "road": "b6aea0", "bridge": "80624c", "soil": "a68d6d", "sand": "e5d7bb", "cliff": "777477"}
	var map: Dictionary = world.map
	var viewport := get_viewport_rect().grow(40)
	var lower := Vector2(INF, INF)
	var upper := Vector2(-INF, -INF)
	for corner in [viewport.position, Vector2(viewport.end.x, viewport.position.y), viewport.end, Vector2(viewport.position.x, viewport.end.y)]:
		var local: Vector2 = (corner - offset) / magnification
		var grid := Vector2(local.x / 32.0 + local.y / 16.0, local.y / 16.0 - local.x / 32.0)
		lower = lower.min(grid)
		upper = upper.max(grid)
	for y in range(maxi(0, int(floor(lower.y))), mini(int(map.height), int(ceil(upper.y)) + 1)):
		for x in range(maxi(0, int(floor(lower.x))), mini(int(map.width), int(ceil(upper.x)) + 1)):
			var center: Vector2 = Snapshot.project({"x": x, "y": y}) * magnification + offset
			if not get_viewport_rect().grow(40).has_point(center):
				continue
			var points := PackedVector2Array()
			for point in [Vector2(0, -8), Vector2(16, 0), Vector2(0, 8), Vector2(-16, 0)]:
				points.append(center + point * magnification)
			draw_colored_polygon(points, Color(colors.get(map.tiles[y * int(map.width) + x], "b6aea0")))
	# Footprints, not finished buildings: accurately show occupied tiles and door.
	for building in world.get("buildings", []):
		var polygon := PackedVector2Array()
		for step in [Vector2.ZERO, Vector2(building.width, 0), Vector2(building.width, building.height), Vector2(0, building.height)]:
			polygon.append(Snapshot.project({"x": building.at.x + step.x - 0.5, "y": building.at.y + step.y - 0.5}) * magnification + offset)
		draw_colored_polygon(polygon, Color("e5d7bb"))
		polygon.append(polygon[0])
		draw_polyline(polygon, Color("80624c"), 2)
		draw_circle(Snapshot.project(building.door) * magnification + offset, 4 * magnification, Color("80624c"))
	for resource in world.get("resources", []):
		var at: Vector2 = Snapshot.project(resource.at) * magnification + offset
		var color := Color("70866c") if resource.amount > 0 else Color("b6aea0")
		if resource.kind == "spring":
			color = Color("71999a")
		draw_circle(at, 5 * magnification, color)
		draw_string(ThemeDB.fallback_font, at + Vector2(5, -4), str(resource.amount), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("3e382f"))
	for person in world.residents:
		if not Snapshot.visible(person):
			continue
		var foot: Vector2 = Snapshot.project(person.at) * magnification + offset
		var color := Color("a4664f")
		if person.get("appearance", {}).get("shirt") is float or person.get("appearance", {}).get("shirt") is int:
			color = Color.hex(int(person.appearance.shirt) * 256 + 255)
		draw_circle(foot - Vector2(0, 9) * magnification, 6 * magnification, color)
		if person.id == selected:
			draw_arc(foot, 9 * magnification, 0, TAU, 24, Color("3e382f"), 2)
