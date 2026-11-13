extends SceneTree
const Main = preload("res://main.gd")
var client: Node3D
var elapsed := 0.0
func _initialize() -> void:
	client = Main.new()
	root.add_child.call_deferred(client)
	_start.call_deferred()
func _start() -> void:
	client.endpoint.text = "http://127.0.0.1:3415"
	client._connect_server()
func _process(delta: float) -> bool:
	elapsed += delta
	if client.connected:
		assert(client.world.map.width == 32 and client.world.map.height == 24)
		assert(client.world.residents.size() == 2)
		assert(client.world.clock.paused)
		assert(client.mode_label.text.contains("模型已禁用"))
		assert(client.mode_label.text.contains("世界持久保存"))
		assert(not client.mode_label.text.contains("规则驱动"))
		client._next_resident()
		assert(not client.selected.is_empty())
		print("PASS: disabled persistent MVP snapshot, paused/no rule fallback, correct UI mode")
		quit()
	if elapsed > 12:
		push_error("Persistent MVP integration failed: " + client.status.text)
		quit(1)
	return false
