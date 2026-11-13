extends SceneTree
const Main = preload("res://main.gd")
const Snapshot = preload("res://snapshot.gd")
class Offline:
	extends Main
	func _poll() -> void: pass
var client
func _initialize() -> void:
	client = Offline.new()
	root.add_child.call_deferred(client)
	_check.call_deferred()
func _check() -> void:
	var w := {"id":"small","revision":1,"clock":{"paused":false},"map":{"width":4,"height":4,"tiles":[]},"buildings":[{"id":"home","kind":"lodge","at":{"x":0,"y":0},"width":2,"height":2,"door":{"x":1,"y":2}}],"residents":[{"id":"a","status":"alive","inside":"home","at":{"x":1,"y":2},"roomAt":{"x":2,"y":5},"activity":null},{"id":"b","status":"alive","inside":"home","at":{"x":1,"y":2}}]}
	w.map.tiles.resize(16)
	w.map.tiles.fill("grass")
	var layout := {"buildingId":"home","width":16,"height":15,"entry":{"x":8,"y":13},"slots":[{"key":"bed:0","kind":"bed","at":{"x":2,"y":5}}],"blocked":[{"x":1,"y":3},{"x":2,"y":3},{"x":1,"y":4},{"x":2,"y":4}]}
	var data := {"world":w,"roomViews":{"worldId":"small","revision":1,"rooms":[layout]}}
	assert(Snapshot.room_views(data).size() == 1)
	client.world = w
	client.connected = true
	client.valley.room_layouts = Snapshot.room_views(data)
	client._enter_room()
	assert(client.valley.room_id == "home")
	assert(client.valley.people.size() == 1)
	assert(client.valley.people.a.position == Vector3(2,0,5))
	assert("位置未知居民数：1" in client.room_hint.text)
	assert("床位数：1" in client.room_hint.text and not "home" in client.room_hint.text)
	w.residents[0].roomAt = {"x":3,"y":6}
	client.valley.show_world(w,"a")
	assert(client.valley.people.a.position == Vector3(3,0,6))
	assert(client.valley.motions.is_empty())
	client._leave_room()
	assert(client.valley.people.is_empty())
	client._enter_room()
	client._received(HTTPRequest.RESULT_CANT_CONNECT,0,PackedStringArray(),PackedByteArray())
	assert(client.valley.room_id == "" and client.valley.people.is_empty())
	client._received(HTTPRequest.RESULT_SUCCESS,200,PackedStringArray(),JSON.stringify(data).to_utf8_buffer())
	client._enter_room()
	assert(client.valley.room_id == "home")
	var older: Dictionary = data.duplicate(true)
	older.world.revision = 0
	older.roomViews.revision = 0
	client._received(HTTPRequest.RESULT_SUCCESS,200,PackedStringArray(),JSON.stringify(older).to_utf8_buffer())
	assert(not client.connected and client.world.revision == 1 and client.valley.room_id.is_empty())
	client.connected = true
	data.roomViews.revision = 0
	assert(Snapshot.room_views(data).is_empty())
	data.roomViews.revision = 1
	data.roomViews.worldId = "other"
	assert(Snapshot.room_views(data).is_empty())
	data.roomViews.worldId = "small"
	layout.width = 999999
	assert(Snapshot.room_views(data).is_empty())
	layout.width = 16
	client.valley.room_layouts = Snapshot.room_views(data)
	client._enter_room()
	w.id = "other"
	client.valley.show_world(w,"")
	assert(client.valley.room_id == "" and client.valley.people.is_empty())
	assert(not Snapshot.room_position({"x":-1,"y":4},layout))
	assert(not Snapshot.room_position({"x":2.5,"y":4},layout))
	assert(not Snapshot.resident_room_position({"x":0,"y":0},layout))
	assert(not Snapshot.resident_room_position({"x":2,"y":3},layout))
	print("PASS: authoritative interior, unknown roomAt, dynamic positions, exit, disconnect, world and revision binding")
	quit()
