extends SceneTree
# The legacy 3413 preview is 640x480, deliberately outside the 3D MVP budget.
# This test proves explicit rejection, not rendering/selection of the old world.
const Main = preload("res://main.gd")
var client: Node3D
var elapsed := 0.0
func _initialize() -> void:
	client = Main.new()
	root.add_child.call_deferred(client)
	_start.call_deferred()
func _start() -> void:
	client.endpoint.text = "http://127.0.0.1:3413"
	client._connect_server()
func _process(delta: float) -> bool:
	elapsed += delta
	if client.status.text.contains("3D MVP limit"):
		assert(not client.connected)
		assert(client.world.is_empty())
		assert(client.valley.people.is_empty())
		assert(client.valley.terrain.get_child_count() == 0)
		print("PASS: legacy full-size HTTP preview explicitly rejected without creating 3D world nodes")
		quit()
	elif client.connected:
		push_error("Expected legacy oversized preview, received supported small world instead")
		quit(1)
	elif elapsed > 12:
		push_error("Legacy rejection integration not verified: " + client.status.text)
		quit(1)
	return false
