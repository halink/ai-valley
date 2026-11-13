extends SceneTree
const Main = preload("res://main.gd")
var client: Node3D
var elapsed := 0.0
var revision := -1.0
func _initialize() -> void:
	client = Main.new()
	root.add_child.call_deferred(client)
	_start.call_deferred()
func _start() -> void:
	client.endpoint.text = "http://127.0.0.1:3414"
	client._connect_server()
func _process(delta: float) -> bool:
	elapsed += delta
	if client.connected:
		assert(client.world.map.width == 32 and client.world.map.height == 24)
		assert(client.world.residents.size() == 2)
		assert(client.world.buildings.size() == 1)
		assert(client.mode_label.text.contains("不调用大模型"))
		assert(not client.world.clock.paused)
		if revision < 0:
			revision = client.world.revision
		elif client.world.revision > revision:
			client._next_resident()
			assert(not client.selected.is_empty())
			assert(client.detail.text.contains("饥饿"))
			print("PASS: advancing 32x24 MVP snapshot, 2 residents, explicit rule mode, selection")
			quit()
	if elapsed > 12:
		push_error("MVP integration failed: " + client.status.text)
		quit(1)
	return false
