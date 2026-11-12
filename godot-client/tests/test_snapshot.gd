extends SceneTree
const Snapshot = preload("res://snapshot.gd")
func _initialize() -> void:
	var good := {"world": {"id": "synthetic", "revision": 1, "clock": {"paused": true}, "map": {"width": 2, "height": 1, "tiles": ["grass", "water"]}, "residents": [{"id": "p", "at": {"x": 0, "y": 0}, "status": "alive"}]}}
	assert(Snapshot.validate(good) == "")
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
	print("PASS: snapshot validation, projection, indoor visibility")
	quit()
