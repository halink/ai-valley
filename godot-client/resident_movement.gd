extends RefCounted

const Movement = preload("res://completed_movement.gd")
const Snapshot = preload("res://snapshot.gd")
var previous := {}

func reset() -> void:
	previous.clear()

static func _point(value: Variant, world: Dictionary, rooms: Dictionary) -> Dictionary:
	if not value is Dictionary or not value.has("roomId"): return {}
	var room: Variant = value.roomId
	if room == null:
		if not Movement.point(value, world): return {}
		room = ""
	elif not room is String or not rooms.has(room) or not Snapshot.resident_room_position(value, rooms[room]):
		return {}
	return {"x":value.x, "y":value.y, "roomId":room}

static func _edge(from: Dictionary, to: Dictionary, rooms: Dictionary, doors: Dictionary) -> bool:
	if from.is_empty() or to.is_empty(): return false
	if from.roomId == to.roomId:
		return absf(from.x - to.x) + absf(from.y - to.y) == 1
	if from.roomId.is_empty() == to.roomId.is_empty(): return false
	var indoor: Dictionary = to if from.roomId.is_empty() else from
	var outdoor: Dictionary = from if from.roomId.is_empty() else to
	return doors.has(indoor.roomId) and Movement.same(indoor, rooms[indoor.roomId].entry) and Movement.same(outdoor, doors[indoor.roomId])

func observe(world: Dictionary, feed: Variant, rooms: Dictionary) -> Dictionary:
	var old := previous
	previous = {}
	if not feed is Dictionary or feed.get("version") != 2 or feed.get("worldId") != world.id or feed.get("revision") != world.revision:
		return {}
	if not feed.get("epoch") is String or feed.epoch.is_empty() or feed.get("limit") != Movement.MAX_STEPS or not feed.get("steps") is Array:
		return {}
	if not Movement.integer(feed.get("firstSeq")) or not Movement.integer(feed.get("lastSeq")) or feed.steps.size() > Movement.MAX_STEPS or feed.firstSeq != feed.lastSeq - feed.steps.size() + 1:
		return {}
	var doors := {}
	for building in world.get("buildings", []):
		if Movement.point(building.get("door"), world): doors[building.id] = building.door
	var positions := {}
	for person in world.residents:
		if positions.has(person.id): return {}
		var at: Variant = person.at if person.get("inside") == null else person.get("roomAt")
		var point := {}
		if at is Dictionary and person.get("status") == "alive" and person.get("regionalLocation") == null and person.get("residency") != "outside":
			point = _point({"x":at.get("x"), "y":at.get("y"), "roomId":person.get("inside")}, world, rooms)
		positions[person.id] = point
	var geometry := Movement.geometry(world) + ":" + str(hash(rooms))
	var continuous: bool = (
		not old.is_empty() and old.epoch == feed.epoch and old.geometry == geometry
		and world.revision > old.revision and feed.lastSeq >= old.seq and feed.firstSeq <= old.seq + 1
		and not world.clock.paused
	)
	var paths := {}
	var seq: float = feed.firstSeq
	var minute := -1.0
	for step in feed.steps:
		if (
			not step is Dictionary or not Movement.integer(step.get("seq")) or step.seq != seq
			or not step.get("actorId") is String or not Movement.nonnegative_number(step.get("minute")) or step.minute < minute
		):
			return {}
		var from := _point(step.get("from"), world, rooms)
		var to := _point(step.get("to"), world, rooms)
		if not _edge(from, to, rooms, doors): return {}
		seq += 1
		minute = step.minute
		if not continuous or step.seq <= old.seq: continue
		var id: String = step.actorId
		if not positions.has(id) or not old.positions.has(id): return {}
		if not paths.has(id): paths[id] = [old.positions[id]]
		if paths[id][-1] != from or paths[id].size() > Movement.MAX_ACTOR_STEPS: return {}
		paths[id].append(to)
	previous = {"epoch":feed.epoch, "seq":feed.lastSeq, "revision":world.revision, "geometry":geometry,
		"positions":positions}
	if not continuous or old.positions.size() != positions.size(): return {}
	for id in positions:
		if not old.positions.has(id): return {}
		var end: Dictionary = paths[id][-1] if paths.has(id) else old.positions[id]
		if end != positions[id]: return {}
	return paths

static func paths_in_scene(paths: Dictionary, room_id: String) -> Dictionary:
	var result := {}
	for id in paths:
		var path: Array = paths[id]
		if path[-1].roomId != room_id: continue
		var start := path.size() - 1
		while start > 0 and path[start - 1].roomId == room_id:
			start -= 1
		if start < path.size() - 1: result[id] = path.slice(start)
	return result
