extends SceneTree
# No sockets, server, configuration files, saved worlds, or model calls.
class OfflineClient:
	extends "res://main.gd"
	var polls := 0
	func _poll() -> void:
		polls += 1
var client: Node3D
func _initialize() -> void:
	client = OfflineClient.new()
	root.add_child.call_deferred(client)
	check.call_deferred()
func press_preset(port: String) -> void:
	for button in client.find_children("*", "Button", true, false):
		if button.text.contains(port):
			button.pressed.emit()
			return
	assert(false, "Preset button missing: " + port)
func check() -> void:
	assert(client.polls == 0 and client.active_endpoint == "" and client.timer.is_stopped())
	assert(client.endpoint.text.ends_with(":3414") and client.endpoint_hint.text.contains("临时"))
	press_preset("3415")
	assert(client.polls == 0 and client.timer.is_stopped())
	assert(client.endpoint_hint.text.contains("默认禁用模型"))
	client._connect_server()
	assert(client.polls == 1 and client.active_endpoint.ends_with(":3415"))
	assert(client.connection_label.text.contains("尚未验证"))
	press_preset("3414")
	assert(client.polls == 1 and client.active_endpoint.ends_with(":3415"))
	# A port/preset is not authority: a rule server on 3415 stays a rule server.
	var data := {"world": {"id": "synthetic", "revision": 1, "clock": {"paused": true}, "map": {"width": 1, "height": 1, "tiles": ["grass"]}, "residents": []}, "mvp": {"driver": "local-rules", "ephemeral": true}}
	client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(data).to_utf8_buffer())
	assert(client.connected and client.mode_label.text.contains("规则驱动") and client.mode_label.text.contains("不保存世界"))
	assert(client.connection_label.text.contains(":3415"))
	assert(client.endpoint.text.ends_with(":3414")) # Polling cannot reset pending choice.
	data.mvp = {"driver": "disabled", "ephemeral": false}
	client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(data).to_utf8_buffer())
	assert(client.mode_label.text.contains("模型已禁用") and client.mode_label.text.contains("世界持久保存"))
	data.mvp.driver = "model"
	client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(data).to_utf8_buffer())
	assert(client.mode_label.text.contains("已配置模型") and client.mode_label.text.contains("不等于验收结果"))
	data.erase("mvp")
	client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(data).to_utf8_buffer())
	assert(client.mode_label.text.contains("尚未验证决策来源"))
	client._received(HTTPRequest.RESULT_CANT_CONNECT, 0, PackedStringArray(), PackedByteArray())
	assert(client.connection_label.text.contains("过期") and client.mode_label.text.contains("未知"))
	client._choose_endpoint("http://synthetic.invalid:9999")
	assert(client.endpoint_hint.text.contains("未知"))
	client.endpoint.text = "invalid"
	client._connect_server()
	assert(client.polls == 1 and client.active_endpoint == "" and client.timer.is_stopped())
	assert(client.connection_label.text == "当前连接：无")
	press_preset("3415")
	client._connect_server()
	client._connect_server()
	assert(client.polls == 3)
	client.timer.stop()
	print("PASS: offline launch presets, explicit connect, active/pending separation, authoritative mode, stale and invalid reconnect")
	quit()
