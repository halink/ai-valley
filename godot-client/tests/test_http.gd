extends SceneTree
const Main = preload("res://main.gd")
var client: Node2D
var elapsed := 0.0
func _initialize() -> void:
	client = Main.new()
	root.add_child.call_deferred(client)
	_start.call_deferred()
func _start() -> void:
	client._connect_server()
func _process(delta: float) -> bool:
	elapsed += delta
	if client.connected:
		assert(not client.world.is_empty())
		assert(client.world.clock.paused)
		assert(client.world.residents.size() > 0)
		client.selected = client.world.residents[0].id
		client._update_detail()
		assert(client.detail.text.contains(client.world.residents[0].name))
		var newer: Dictionary = {"world": client.world.duplicate(true)}
		newer.world.revision = 10
		client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(newer).to_utf8_buffer())
		var older: Dictionary = newer.duplicate(true)
		older.world.revision = 9
		client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(older).to_utf8_buffer())
		assert(client.world.revision == 10 and not client.connected)
		# A genuinely different world can begin at a lower revision.
		older.world.id = "replacement-synthetic-world"
		older.world.revision = 1
		client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(older).to_utf8_buffer())
		assert(client.world.revision == 1 and client.connected and client.selected.is_empty())
		var original: String = client.active_endpoint
		client.endpoint.text = "http://not-connected.invalid"
		assert(client.active_endpoint == original)
		var revision = client.world.revision
		client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), "{}".to_utf8_buffer())
		assert(not client.connected and client.world.revision == revision)
		assert(client.status.text.contains("stale"))
		client.dragging = true
		var release := InputEventMouseButton.new()
		release.button_index = MOUSE_BUTTON_MIDDLE
		release.pressed = false
		client._input(release)
		assert(not client.dragging)
		client.dragging = true
		client._notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
		assert(not client.dragging)
		for person in client.world.residents:
			if preload("res://snapshot.gd").visible(person):
				client.magnification = 4.0
				var click := InputEventMouseButton.new()
				click.button_index = MOUSE_BUTTON_LEFT
				click.pressed = true
				click.position = preload("res://snapshot.gd").project(person.at) * 4.0 + client.offset - Vector2(0, 36)
				client._unhandled_input(click)
				assert(not client.selected.is_empty())
				break
		client.endpoint.text = original
		client._connect_server()
		assert(client.world.is_empty() and client.selected.is_empty())
		assert(client.detail.text.begins_with("No resident selected"))
		assert(client.status.text.begins_with("Connecting"))
		print("PASS: Godot HTTPRequest -> isolated TS preview -> validated full snapshot -> selection")
		quit()
	elif elapsed > 12:
		push_error("Preview connection failed: " + client.status.text)
		quit(1)
	return false
