extends RefCounted

const MAX_CLOCK := 1000000000000000
const MAX_VERSION := 9007199254740991.0
const SECTION_PREFIX := "valley-life-section-"
const FACT_NAMES := {
 "arrived": "记录到一次实际到场",
 "conversation-completed": "记录到一次已实际送达的交谈",
 "meal-consumed": "记录到一次实际进餐",
}

static func _exact(value: Variant, keys: Array) -> bool:
	if not value is Dictionary or value.size() != keys.size(): return false
	for key in keys:
		if not value.has(key): return false
	return true

static func _integer(value: Variant, low: int) -> bool:
	return (value is int or value is float) and is_finite(value) and floorf(value) == value and value >= low and value <= MAX_VERSION

static func _equals(value: Variant, expected: String) -> bool:
	return value is String and value == expected

static func _hex_ref(value: Variant, prefix: String) -> bool:
	if not value is String or not value.begins_with(prefix) or value.length() != prefix.length() + 64: return false
	for ch in value.substr(prefix.length()):
		if not ch in "0123456789abcdef": return false
	return true

static func _world_id(value: Variant) -> bool:
	if not value is String or not value.begins_with("godot-mvp-") or value.length() <= 10 or value.length() > 190: return false
	for ch in value:
		if not ch in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_": return false
	return true

static func _clock(value: Variant) -> int:
	if not value is String or value.is_empty() or value.length() > 16: return -1
	for ch in value:
		if not ch in "0123456789": return -1
	var us: int = int(value)
	return us if us <= MAX_CLOCK and str(us) == value else -1

# This marker is minted independently from the weather/archive permission.
# Never infer capability or current authorization from a successful past GET.
static func context(snapshot: Dictionary) -> Dictionary:
	var marker: Variant = snapshot.get("valleySpiritLifeYearbook")
	var world: Variant = snapshot.get("world")
	if not _exact(marker, ["schemaVersion", "status", "generatedBy", "worldId", "worldRevision", "atMinute", "sectionId"]) or not world is Dictionary: return {}
	if not _integer(marker.schemaVersion, 1) or marker.schemaVersion != 1 or not _equals(marker.status, "ready") or not _equals(marker.generatedBy, "offline-synthetic-selection"): return {}
	var world_id: Variant = world.get("id")
	var minute: Variant = world.get("minute")
	var revision: Variant = world.get("revision")
	if not _world_id(world_id) or not _integer(revision, 0) or not (minute is float or minute is int) or not is_finite(minute) or minute < 0 or minute > 1000000000.0: return {}
	if not _integer(marker.worldRevision, 0) or marker.worldRevision != revision or not _equals(marker.worldId, world_id) or not (marker.atMinute is int or marker.atMinute is float) or marker.atMinute != minute: return {}
	if not _hex_ref(marker.sectionId, SECTION_PREFIX): return {}
	return {"worldId": world_id, "sectionId": marker.sectionId, "asOfUs": roundi(float(minute) * 1000000.0)}

static func same_authority(a: Dictionary, b: Dictionary) -> bool:
	return not a.is_empty() and not b.is_empty() and a.worldId == b.worldId and a.sectionId == b.sectionId

@warning_ignore("integer_division")
static func _game_minute(micro: int) -> String:
	var whole := str(micro / 1000000)
	var part := micro % 1000000
	if part == 0: return whole
	var decimal := "%06d" % part
	while decimal.ends_with("0"): decimal = decimal.left(decimal.length() - 1)
	return whole + "." + decimal

# Sealed server text is checked against approved typed wording. No raw
# snippets, inferred people, extra fields, or alternate model attribution.
static func presentation(dto: Variant, authority: Dictionary) -> String:
	if authority.is_empty() or not _exact(dto, ["status", "generatedBy", "worldId", "range", "sectionId", "lines"]): return ""
	if not _equals(dto.status, "ready") or not _equals(dto.generatedBy, "offline-synthetic-selection") or not _equals(dto.worldId, authority.worldId) or not _equals(dto.sectionId, authority.sectionId): return ""
	if not _exact(dto.range, ["fromUs", "throughUs"]): return ""
	var start := _clock(dto.range.fromUs)
	var end := _clock(dto.range.throughUs)
	if start < 0 or end < start or end > authority.asOfUs or end - start > 1440000000: return ""
	if not dto.lines is Array or dto.lines.is_empty() or dto.lines.size() > 3: return ""
	var rendered := PackedStringArray(["生活年鉴 · 离线"])
	var seen := {}
	var previous := start
	for line in dto.lines:
		if not _exact(line, ["sourceRef", "grantVersion", "receiptVersion", "atUs", "kind", "text"]): return ""
		if not _hex_ref(line.sourceRef, authority.worldId + "/life-") or seen.has(line.sourceRef): return ""
		if not _integer(line.grantVersion, 1) or not _integer(line.receiptVersion, 1) or not line.kind is String or not FACT_NAMES.has(line.kind): return ""
		var at := _clock(line.atUs)
		if at < previous or at > end: return ""
		var text := "游戏分钟 " + _game_minute(at) + "：" + str(FACT_NAMES[line.kind]) + "。"
		if not line.text is String or line.text != text: return ""
		seen[line.sourceRef] = true
		previous = at
		rendered.append(text)
	return "\n".join(rendered)
