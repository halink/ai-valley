extends SceneTree
const Feed = preload("res://completed_movement.gd")
class OfflineClient:
	extends "res://main.gd"
	func _poll() -> void: pass
var client: Node3D
func _initialize() -> void:
	client = OfflineClient.new()
	root.add_child.call_deferred(client)
	_check.call_deferred()
func fixture() -> Dictionary:
	var tiles: Array = []
	tiles.resize(36)
	tiles.fill("grass")
	return {"world":{"id":"motion", "revision":1, "clock":{"paused":false}, "map":{"width":6,"height":6,"tiles":tiles}, "residents":[{"id":"a","at":{"x":1,"y":1},"status":"alive"},{"id":"b","at":{"x":4,"y":4},"status":"alive"}]}, "movement":{"version":1,"worldId":"motion","revision":1,"epoch":"one","firstSeq":1,"lastSeq":0,"limit":256,"steps":[]}}
func batch() -> Dictionary:
	var s := fixture()
	s.world.revision = 2
	s.movement.revision = 2
	s.world.residents[0].at = {"x":2,"y":2}
	s.world.residents[1].at = {"x":4,"y":3}
	s.movement.steps = [
		{"seq":1,"actorId":"a","minute":1,"from":{"x":1,"y":1},"to":{"x":2,"y":1}},
		{"seq":2,"actorId":"b","minute":1,"from":{"x":4,"y":4},"to":{"x":4,"y":3}},
		{"seq":3,"actorId":"a","minute":2,"from":{"x":2,"y":1},"to":{"x":2,"y":2}}]
	s.movement.lastSeq = 3
	return s
func deliver(s: Dictionary) -> void:
	client._received(HTTPRequest.RESULT_SUCCESS,200,PackedStringArray(),JSON.stringify(s).to_utf8_buffer())
func rejected(s: Dictionary) -> void:
	var reader = Feed.new()
	var initial := fixture()
	assert(reader.observe(initial.world, initial.movement).is_empty())
	assert(reader.observe(s.world, s.movement).is_empty())
func _check() -> void:
	client.valley.set_process(false)
	var initial := fixture()
	var s := batch()
	var reader = Feed.new()
	assert(reader.observe(initial.world, initial.movement).is_empty())
	var paths: Dictionary = reader.observe(s.world,s.movement)
	assert(paths.a.size() == 3 and paths.b.size() == 2)
	assert(reader.observe(s.world,s.movement).is_empty()) # duplicate
	var bad := batch()
	bad.movement.steps.reverse()
	rejected(bad)
	bad = batch(); bad.movement.steps.remove_at(1) # global gap from OTHER resident
	rejected(bad)
	bad = batch(); bad.movement.steps[1].seq = 1 # duplicate
	rejected(bad)
	bad = batch(); bad.movement.steps = bad.movement.steps.slice(1); bad.movement.firstSeq = 2
	rejected(bad) # truncated unseen history
	bad = batch(); bad.movement.epoch = "restart"
	rejected(bad)
	bad = batch(); bad.movement.worldId = "other"
	rejected(bad)
	bad = batch(); bad.movement.revision = 3
	rejected(bad)
	bad = batch(); bad.world.map.tiles[0] = "water"
	rejected(bad)
	bad = batch(); bad.world.residents[0].at.x = 3
	rejected(bad) # endpoint mismatch
	bad = batch(); bad.movement.steps[0].from.x = 0
	rejected(bad)
	bad = batch(); bad.world.residents[0].inside = "home"
	rejected(bad)
	bad = batch(); bad.world.residents.remove_at(1)
	rejected(bad)
	bad = batch(); bad.world.clock.paused = true
	rejected(bad)
	bad = batch(); bad.movement.steps[0].to.x = 1.5
	rejected(bad)
	bad = batch(); bad.movement.steps[0].to.x = 99
	rejected(bad)
	bad = batch(); bad.movement.steps[0].minute = -1
	rejected(bad)
	bad = batch(); bad.movement.steps[0].actorId = "unknown"
	rejected(bad)
	bad = batch(); bad.world.buildings = [{"at":{"x":0,"y":0},"width":1,"height":1,"door":{"x":0,"y":1}}]
	rejected(bad)
	bad = batch(); bad.movement.steps[0].to.x = NAN
	rejected(bad)
	bad = batch(); bad.world.revision = 0; bad.movement.revision = 0
	rejected(bad)
	bad = batch(); bad.movement.limit = 257
	rejected(bad)
	bad = batch(); bad.movement.steps.resize(257)
	rejected(bad)
	# Per-resident queue cap, even with fully connected valid endpoints.
	bad = fixture(); bad.world.revision = 2; bad.movement.revision = 2
	for i in range(18):
		bad.movement.steps.append({"seq":i+1,"actorId":"a","minute":i,"from":{"x":1+i%2,"y":1},"to":{"x":2-i%2,"y":1}})
	bad.movement.lastSeq = 18
	rejected(bad)
	# An observed closed loop is still movement; cap duration rather than discard.
	var loop := bad.duplicate(true)
	loop.movement.steps = loop.movement.steps.slice(0,16)
	loop.movement.lastSeq = 16
	var loop_reader = Feed.new()
	loop_reader.observe(initial.world, initial.movement)
	assert(loop_reader.observe(loop.world, loop.movement).a.size() == 17)
	client.endpoint.text = "http://synthetic.invalid"
	client._connect_server(); client.timer.stop()
	deliver(initial); deliver(loop)
	assert(client.valley.motions.a.duration <= 1.4)
	client.valley._process(2.0)
	assert(client.valley.motions.is_empty() and client.valley.people.a.position == Vector3(1,0,1))
	client._connect_server(); client.timer.stop()
	# Client plays actual corner in order, never a straight diagonal.
	deliver(initial)
	var actor: Node3D = client.valley.people.a
	deliver(s)
	assert(client.valley.people.a == actor and client.valley.motions.size() == 2)
	client.valley._process(0.175)
	assert(actor.position.is_equal_approx(Vector3(1.5,0,1)))
	assert(is_equal_approx(actor.rotation.y,-PI/4))
	client.selected = "a"
	client.valley.show_world(client.world,client.selected)
	assert(actor.position.is_equal_approx(Vector3(1.5,0,1)))
	assert(actor.get_node("Selection").visible)
	assert(client.valley.pick(client.valley.camera.unproject_position(actor.position+Vector3(0,0.9,0))) == "a")
	client.valley._process(0.35)
	assert(actor.position.is_equal_approx(Vector3(2,0,1.5)))
	client.valley._process(10.0)
	assert(actor.position == Vector3(2,0,2) and client.valley.motions.is_empty())
	client.valley._process(10.0)
	assert(actor.position == Vector3(2,0,2))
	# New batch during playback cannot grow a queue / visual lag.
	client.endpoint.text = "http://synthetic.invalid"
	client._connect_server(); client.timer.stop(); deliver(initial); deliver(s)
	var next := s.duplicate(true)
	next.world.revision = 3; next.movement.revision = 3
	next.world.residents[0].at = {"x":3,"y":2}
	next.movement.steps.append({"seq":4,"actorId":"a","minute":3,"from":{"x":2,"y":2},"to":{"x":3,"y":2}})
	next.movement.lastSeq = 4
	deliver(next)
	assert(client.valley.people.a.position == Vector3(3,0,2) and client.valley.motions.is_empty())
	# Reset client for each disruption; recovery's first response never replays.
	for failure in ["transport", "invalid", "pause", "restart", "legacy", "duplicate", "indoor"]:
		client.endpoint.text = "http://synthetic.invalid"
		client._connect_server(); client.timer.stop()
		deliver(initial); deliver(s)
		assert(client.valley.motions.size() == 2)
		client.valley._process(0.1)
		assert(client.valley.people.a.get_node("Boot1").transform != client.valley.people.a.rest_transforms["Boot1"])
		if failure == "transport":
			client._received(HTTPRequest.RESULT_CANT_CONNECT,0,PackedStringArray(),PackedByteArray())
		elif failure == "invalid":
			bad = s.duplicate(true); bad.movement.steps.reverse(); deliver(bad)
		elif failure == "pause":
			bad = s.duplicate(true); bad.world.clock.paused = true; deliver(bad)
		elif failure == "restart":
			bad = s.duplicate(true); bad.movement.epoch = "new"; deliver(bad)
		elif failure == "legacy":
			bad = s.duplicate(true); bad.erase("movement"); deliver(bad)
		elif failure == "duplicate": deliver(s)
		else:
			bad = s.duplicate(true); bad.world.revision = 3; bad.movement.revision = 3
			bad.world.residents[0].inside = "home"; deliver(bad)
		assert(client.valley.motions.is_empty())
		for resident in client.valley.people.values():
			assert(resident.get_node("Boot1").transform == resident.rest_transforms["Boot1"])
	# Selecting a retained stale snapshot must never restore work poses.
	client._connect_server(); client.timer.stop()
	bad = fixture()
	bad.world.residents[0].activity = {"action":{"type":"gather"},"path":[],"remaining":5}
	deliver(bad)
	client._next_resident()
	assert(client.valley.people.a.activity_pose == "gather")
	client._received(HTTPRequest.RESULT_CANT_CONNECT,0,PackedStringArray(),PackedByteArray())
	client._next_resident()
	assert(client.valley.people.a.activity_pose == "idle")
	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.pressed = true
	click.position = Vector2.ZERO
	client._unhandled_input(click)
	assert(client.valley.people.a.activity_pose == "idle")
	# Legacy adjacent snapshots snap too, no inferred fallback.
	client._connect_server(); client.timer.stop()
	bad = fixture(); bad.erase("movement"); deliver(bad)
	bad.world.revision = 2; bad.world.residents[0].at.x = 2; deliver(bad)
	assert(client.valley.people.a.position == Vector3(2,0,1) and client.valley.motions.is_empty())
	bad.world.residents[0].appearance = {"shirt":0xff0000}; deliver(bad)
	for garment in client.valley.people.a.get_meta("garments"):
		assert(garment.material_override.albedo_color == Color("ff0000"))
	client._connect_server(); client.timer.stop()
	assert(client.valley.people.is_empty() and client.valley.motions.is_empty())
	print("PASS: completed global feed/actor chains, bounded corner playback, disruptions, restart, truncation, invalid data, legacy snapping, identity and appearance")
	quit()
