extends SceneTree
const Snapshot = preload("res://snapshot.gd")
class OfflineClient:
	extends "res://main.gd"
	func _poll() -> void:
		pass
var client: Node3D
func _initialize() -> void:
	assert(Snapshot.thirst_label({}, "a").contains("未知"))
	assert(Snapshot.thirst_label({"mvpDrinking": {"version": 1, "thirst": {"a": 50}}}, "a").contains("50/100"))
	assert(Snapshot.activity_label({"activity": {"action": {"type": "mvpDrink"}}}).contains("饮水"))
	assert(Snapshot.inventory_label({}) == "库存：未知")
	assert(Snapshot.inventory_label({"inventory": {}}) == "库存：空")
	assert(Snapshot.inventory_label({"inventory": {"berry": 0, "water": 2, "wood": 3}}) == "库存：水：2, 木材：3")
	assert(Snapshot.inventory_label({"inventory": {"water": "bad"}}).contains("水：未知"))
	assert(Snapshot.activity_label({}) == "行为：未知")
	assert(Snapshot.activity_label({"activity": null}).contains("暂无进行中行为"))
	assert(Snapshot.status_number(-1) == "未知")
	assert(Snapshot.status_number(1.5, true) == "未知")
	assert(Snapshot.action_detail({"activity": {"path": [], "action": {"type": "gather"}, "target": {"x": 2, "y": 3}, "remaining": 4}}).contains("目标位置 (2, 3) · 剩余工作时间 4"))
	assert(Snapshot.failure_label({"lastFailure": "SECRET"}).contains("详情已隐藏"))
	assert(not Snapshot.failure_label({"lastFailure": "SECRET"}).contains("SECRET"))
	assert(Snapshot.model_status({}).contains("未知"))
	assert(Snapshot.model_status({"model": {"requestActorIds": [1]}}, "a").contains("请求：未知"))
	assert(Snapshot.resident_name({"id": "internal-secret-id"}) == "未命名居民")
	assert(Snapshot.inventory_label({"inventory": {"internal-secret-id": 3}}) == "库存：未知物品：3")
	assert(Snapshot.action_name("internal-secret-id") == "未知行为")
	assert(Snapshot.resource_name("spring") == "泉水")
	assert(Snapshot.model_status({"model": {"lastFailure": "SECRET"}}).contains("最近模型错误：未知"))
	assert(not Snapshot.model_status({"model": {"lastFailure": "SECRET"}}).contains("SECRET"))
	client = OfflineClient.new()
	root.add_child.call_deferred(client)
	check.call_deferred()
func deliver(value: Dictionary) -> void:
	client._received(HTTPRequest.RESULT_SUCCESS, 200, PackedStringArray(), JSON.stringify(value).to_utf8_buffer())
func check() -> void:
	var data := {"world": {"id": "synthetic", "revision": 1, "clock": {"paused": true}, "map": {"width": 1, "height": 1, "tiles": ["grass"]}, "residents": [{"id": "a", "at": {"x": 0, "y": 0}, "inventory": {"water": 2}, "lastFailure": "SECRET"}, {"id": "b", "at": {"x": 0, "y": 0}, "inventory": {}}]}, "observation": {"paused": true, "model": {"requestActorIds": ["a"], "requestCount": 1, "cooldownProviders": 1, "cooldownRemainingMs": 123, "lastFailure": "http_429"}}}
	deliver(data)
	client._next_resident()
	assert(client.detail.text.contains("库存：水：2"))
	assert(client.detail.text.contains("请求处理中") and client.detail.text.contains("HTTP 429"))
	assert(not client.detail.text.contains("SECRET"))
	client._next_resident()
	assert(client.detail.text.contains("库存：空") and client.detail.text.contains("无进行中请求"))
	assert(not client.detail.text.contains("水：2"))
	client.endpoint.text = "invalid"
	client._connect_server()
	assert(client.observation.is_empty() and not client.detail.text.contains("HTTP 429"))
	deliver(data)
	client._received(HTTPRequest.RESULT_CANT_CONNECT, 0, PackedStringArray(), PackedByteArray())
	assert(client.observation.is_empty())
	assert(not client.detail.text.contains("HTTP 429") and client.detail.text.contains("过期"))
	data.erase("observation")
	data.world.revision = 2
	deliver(data)
	assert(client.detail.text.contains("未知") and not client.detail.text.contains("HTTP 429"))
	data.world.id = "restarted"
	data.world.revision = 0
	deliver(data)
	assert(client.selected == "" and client.observation.is_empty())
	client._connect_server()
	assert(client.observation.is_empty())
	client.timer.stop()
	print("PASS: synthetic observability, inventory, action, redaction, selection, stale/reconnect/restart")
	quit()
