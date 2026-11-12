class_name ValleySnapshot
extends RefCounted

# Full snapshots only. SSE deltas are NOT compatible with this M1 transport.
static func validate(value: Variant) -> String:
	if not value is Dictionary or not value.get("world") is Dictionary:
		return "Missing world"
	var world: Dictionary = value.world
	if not world.get("id") is String or not world.get("revision") is float and not world.get("revision") is int:
		return "Invalid world identity"
	if not is_finite(world.revision) or world.revision < 0 or world.revision != floor(world.revision):
		return "Invalid world revision"
	if not world.get("map") is Dictionary or not world.get("residents") is Array:
		return "Not a full snapshot"
	if not world.get("clock") is Dictionary or not world.clock.get("paused") is bool:
		return "Invalid clock"
	var map: Dictionary = world.map
	if map.has("settlement"):
		if not map.settlement is Dictionary:
			return "Invalid settlement"
		for axis in ["x", "y"]:
			if not (map.settlement.get(axis) is float or map.settlement.get(axis) is int):
				return "Invalid settlement position"
			if not is_finite(map.settlement[axis]):
				return "Invalid settlement position"
	var width = map.get("width", 0)
	var height = map.get("height", 0)
	if not (width is float or width is int) or not (height is float or height is int):
		return "Invalid map dimensions"
	if not is_finite(width) or not is_finite(height) or width <= 0 or height <= 0 or width != floor(width) or height != floor(height) or width * height > 1048576:
		return "Unsupported map dimensions"
	if not map.get("tiles") is Array or map.tiles.size() != int(width * height):
		return "Invalid tiles"
	for tile in map.tiles:
		if not tile is String:
			return "Invalid tile"
	for person in world.residents:
		if not person is Dictionary or not person.get("id") is String or not person.get("at") is Dictionary:
			return "Invalid resident"
		if person.has("appearance") and not person.appearance is Dictionary:
			return "Invalid appearance"
		for axis in ["x", "y"]:
			if not (person.at.get(axis) is float or person.at.get(axis) is int):
				return "Invalid resident position"
			if not is_finite(person.at[axis]):
				return "Invalid resident position"
	return ""

static func project(at: Dictionary) -> Vector2:
	return Vector2((at.x - at.y) * 16.0, (at.x + at.y) * 8.0)

static func visible(person: Dictionary) -> bool:
	return person.get("inside") == null and person.get("regionalLocation") == null and person.get("residency") != "outside" and person.get("status") == "alive"
