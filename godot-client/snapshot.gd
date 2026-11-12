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
	for field in ["buildings", "resources", "events"]:
		if world.has(field) and not world[field] is Array:
			return "Invalid " + field
	for building in world.get("buildings", []):
		if not building is Dictionary or not valid_position(building.get("at")) or not valid_position(building.get("door")):
			return "Invalid building position"
		for axis in ["width", "height"]:
			var size = building.get(axis)
			if not (size is float or size is int) or not is_finite(size) or size <= 0 or size > 1024:
				return "Invalid building size"
	for resource in world.get("resources", []):
		if not resource is Dictionary or not valid_position(resource.get("at")) or not resource.get("kind") is String:
			return "Invalid resource"
		var amount = resource.get("amount")
		if not (amount is float or amount is int) or not is_finite(amount) or amount < 0:
			return "Invalid resource amount"
	for entry in world.get("events", []):
		if not entry is Dictionary:
			return "Invalid event"
	for person in world.residents:
		if not person is Dictionary or not person.get("id") is String or not person.get("at") is Dictionary:
			return "Invalid resident"
		if person.has("inventory") and not person.inventory is Dictionary:
			return "Invalid inventory"
		var activity = person.get("activity")
		if activity != null and (not activity is Dictionary or not activity.get("path") is Array or not activity.get("action") is Dictionary):
			return "Invalid activity"
		if activity is Dictionary and activity.get("room") != null and (not activity.room is Dictionary or not activity.room.get("path") is Array):
			return "Invalid room activity"
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

static func activity_label(person: Dictionary) -> String:
	var activity = person.get("activity")
	if not activity is Dictionary:
		return "waiting for decision"
	if not activity.get("path", []).is_empty() or (activity.get("room") is Dictionary and not activity.room.get("path", []).is_empty()):
		return "travelling"
	return "on-site: " + str(activity.get("action", {}).get("type", "unknown"))

static func valid_position(at: Variant) -> bool:
	if not at is Dictionary:
		return false
	for axis in ["x", "y"]:
		if not (at.get(axis) is float or at.get(axis) is int) or not is_finite(at[axis]):
			return false
	return true
