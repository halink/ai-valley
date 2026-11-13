extends RefCounted
# Untrusted optional observer metadata, never a source of simulation authority.
const Snapshot = preload("res://snapshot.gd")
const MAX_STEPS := 256
const MAX_ACTOR_STEPS := 16
var previous: Dictionary = {}

func reset() -> void:
	previous.clear()

static func integer(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(value) and value == floor(value) and value >= 0 and value <= 9007199254740991.0

static func point(value: Variant, world: Dictionary) -> bool:
	return value is Dictionary and integer(value.get("x")) and integer(value.get("y")) and value.x < world.map.width and value.y < world.map.height

static func same(a: Dictionary, b: Dictionary) -> bool:
	return a.x == b.x and a.y == b.y

static func geometry(world: Dictionary) -> String:
	return str(world.id) + ":" + str(hash(world.map)) + ":" + str(world.get("mapRevision", 0)) + ":" + str(hash(world.get("buildings", [])))

func observe(world: Dictionary, feed: Variant) -> Dictionary:
	var old := previous
	previous = {}
	if not feed is Dictionary or feed.get("version") != 1 or feed.get("worldId") != world.id or feed.get("revision") != world.revision:
		return {}
	if not feed.get("epoch") is String or feed.epoch.is_empty() or feed.get("limit") != MAX_STEPS or not feed.get("steps") is Array:
		return {}
	if not integer(feed.get("firstSeq")) or not integer(feed.get("lastSeq")) or feed.steps.size() > MAX_STEPS or feed.firstSeq != feed.lastSeq - feed.steps.size() + 1:
		return {}
	var seq: float = feed.firstSeq
	var minute := -1.0
	for step in feed.steps:
		if not step is Dictionary or not integer(step.get("seq")) or step.seq != seq or not step.get("actorId") is String or not integer(step.get("minute")) or step.minute < minute:
			return {}
		if not point(step.get("from"), world) or not point(step.get("to"), world) or absf(step.from.x-step.to.x) + absf(step.from.y-step.to.y) != 1:
			return {}
		seq += 1
		minute = step.minute
	var residents := {}
	for person in world.residents:
		if residents.has(person.id): return {}
		residents[person.id] = person
	previous = {"epoch":feed.epoch, "seq":feed.lastSeq, "revision":world.revision, "geometry":geometry(world), "residents":residents.duplicate(true)}
	if old.is_empty() or old.epoch != feed.epoch or old.geometry != previous.geometry or world.revision <= old.revision or feed.lastSeq < old.seq or feed.firstSeq > old.seq + 1 or world.clock.paused:
		return {}
	# Validate the full global range before filtering actors. Membership changes and
	# indoor/hidden transitions cancel this entire batch, never just the bad edge.
	if old.residents.size() != residents.size(): return {}
	var paths := {}
	for id in residents:
		if not old.residents.has(id): return {}
		if Snapshot.visible(residents[id]) != Snapshot.visible(old.residents[id]): return {}
	for step in feed.steps:
		if step.seq <= old.seq: continue
		var id: String = step.actorId
		if not residents.has(id) or not Snapshot.visible(residents[id]) or not Snapshot.visible(old.residents[id]): return {}
		if not paths.has(id): paths[id] = [old.residents[id].at]
		if not same(paths[id][-1], step.from): return {}
		paths[id].append(step.to)
		if paths[id].size() > MAX_ACTOR_STEPS + 1: return {}
	for id in residents:
		var endpoint: Dictionary = paths[id][-1] if paths.has(id) else old.residents[id].at
		if not same(endpoint, residents[id].at): return {}
	return paths
