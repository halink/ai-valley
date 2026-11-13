extends SceneTree
# Only transport is replaced: reconnect/state/input use the actual client methods.
# This suite never opens a socket or reads a model configuration.
class OfflineClient:
	extends "res://main.gd"
	var poll_count := 0
	func _poll() -> void:
		poll_count += 1
var client: Node3D
func _initialize() -> void:
	client = OfflineClient.new()
	root.add_child.call_deferred(client)
	_check.call_deferred()
func deliver(snapshot: Dictionary) -> void:
	client._received(HTTPRequest.RESULT_SUCCESS,200,PackedStringArray(),JSON.stringify(snapshot).to_utf8_buffer())
func _check() -> void:
	client.endpoint.text = "http://synthetic.invalid:3414"
	client._connect_server()
	assert(client.poll_count == 1)
	var original: String = client.active_endpoint
	client.endpoint.text = "http://not-connected.invalid"
	assert(client.active_endpoint == original)
	var snapshot := {"world":{"id":"synthetic-3d","revision":1,"clock":{"paused":true},"map":{"width":2,"height":2,"tiles":["grass","grass","grass","water"]},"residents":[{"id":"a","name":"Synthetic resident","at":{"x":1,"y":1},"status":"alive"}]}}
	deliver(snapshot)
	assert(client.connected and client.valley.people.size() == 1)
	# Actual input handler, including zoomed camera projection, not only pick().
	client.valley.zoom(0.5)
	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.pressed = true
	click.position = client.valley.camera.unproject_position(Vector3(1,0.9,1))
	client._unhandled_input(click)
	assert(client.selected == "a")
	assert(client.detail.text.contains("Synthetic resident"))
	client._received(HTTPRequest.RESULT_SUCCESS,200,PackedStringArray(),"{}".to_utf8_buffer())
	assert(not client.connected and client.world.revision == 1)
	assert(client.valley.people.has("a") and client.status.text.contains("过期"))
	snapshot.world.revision = 0
	deliver(snapshot)
	assert(not client.connected and client.world.revision == 1)
	# New world may start at a lower revision; stale selection must be cleared.
	snapshot.world.id = "replacement-synthetic-world"
	deliver(snapshot)
	assert(client.connected and client.world.revision == 0)
	assert(client.selected.is_empty() and client.detail.text.begins_with("尚未选择居民"))
	client.dragging = true
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_MIDDLE
	release.pressed = false
	client._input(release)
	assert(not client.dragging)
	client.dragging = true
	client._notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	assert(not client.dragging)
	# Oversized input leaves the last accepted world visible, marked stale.
	snapshot.world.revision = 2
	snapshot.world.map.width = 65
	snapshot.world.map.height = 65
	snapshot.world.map.tiles.resize(65*65)
	snapshot.world.map.tiles.fill("grass")
	deliver(snapshot)
	assert(not client.connected and client.world.revision == 0)
	assert(client.status.text.contains("3D MVP 上限"))
	client.selected = "a"
	client._update_detail()
	client.endpoint.text = original
	client._connect_server()
	assert(client.poll_count == 2)
	assert(client.world.is_empty() and client.selected.is_empty())
	assert(client.valley.people.is_empty() and client.valley.terrain.get_child_count() == 0)
	assert(client.detail.text.begins_with("尚未选择居民"))
	assert(client.status.text.begins_with("正在连接"))
	assert(client.mode_label.text == "尚未连接模拟世界")
	assert(client.events_label.text == "近期事件：尚未收到")
	client.timer.stop()
	print("PASS: offline 3D bridge, zoomed input selection, stale preservation, endpoint freeze, revision/world replacement, drag release/focus, map limit and reconnect clear")
	quit()
