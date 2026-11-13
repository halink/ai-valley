extends SceneTree
const Snapshot = preload("res://snapshot.gd")
func _initialize() -> void:
	var good := {"world": {"id": "synthetic", "revision": 1, "clock": {"paused": true}, "map": {"width": 2, "height": 1, "tiles": ["grass", "water"]}, "residents": [{"id": "p", "at": {"x": 0, "y": 0}, "status": "alive"}]}}
	assert(Snapshot.validate(good) == "")
	assert(Snapshot.validate({"world": good.world, "mvp": {"driver": "unknown", "ephemeral": false}}) != "")
	assert(Snapshot.validate({"world": good.world, "mvp": {"driver": "disabled", "ephemeral": false}}) == "")
	assert(Snapshot.validate({"world": {"id": "synthetic", "revision": 2}}) != "")
	assert(Snapshot.validate(null) != "")
	assert(Snapshot.project({"x": 1, "y": 1}) == Vector2(0, 16))
	assert(Snapshot.visible(good.world.residents[0]))
	good.world.residents[0].inside = "home"
	assert(not Snapshot.visible(good.world.residents[0]))
	good.world.revision = -1.5
	assert(Snapshot.validate(good) != "")
	good.world.revision = 1
	good.world.residents[0].at.x = INF
	assert(Snapshot.validate(good) != "")
	good.world.residents[0].at.x = 0
	good.world.map.settlement = {"x": INF, "y": 0}
	assert(Snapshot.validate(good) != "")
	good.world.map.erase("settlement")
	good.world.map.width = 2.5
	assert(Snapshot.validate(good) != "")
	good.world.map.width = 2
	good.world.clock = null
	assert(Snapshot.validate(good) != "")
	good.world.clock = {"paused": true}
	good.world.map.settlement = null
	assert(Snapshot.validate(good) != "")
	good.world.map.erase("settlement")
	good.world.residents[0].appearance = null
	assert(Snapshot.validate(good) != "")
	good.world.residents[0].erase("appearance")
	good.world.buildings = [{"at": {"x": 1, "y": 1}, "door": {"x": 1, "y": 2}, "width": 2, "height": 2}]
	assert(Snapshot.validate(good) == "")
	good.world.buildings[0].width = -1
	assert(Snapshot.validate(good) != "")
	good.world.erase("buildings")
	good.world.resources = [{"at": {"x": 1, "y": 1}, "kind": "bush", "amount": -1}]
	assert(Snapshot.validate(good) != "")
	assert(Snapshot.activity_label({"activity": {"path": [{"x": 1, "y": 1}], "action": {"type": "gather"}}}) == "移动中")
	assert(Snapshot.activity_label({"activity": {"path": [], "action": {"type": "gather"}}}) == "到达现场：采集")
	assert(Snapshot.mode_label({"mvp": {"driver": "disabled", "ephemeral": false}}).contains("模型已禁用"))
	assert(Snapshot.mode_label({"mvp": {"driver": "model", "ephemeral": false}}).contains("已配置模型"))
	assert(Snapshot.mode_label({"mvp": {"driver": "local-rules", "ephemeral": true}}).contains("不调用大模型"))
	assert(not Snapshot.mode_label({"mvp": {"driver": "model", "ephemeral": false}}).contains("不保存世界"))
	print("PASS: snapshot validation, projection, indoor visibility")
	quit()
