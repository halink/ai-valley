extends RefCounted

const HOURS := 24
const MAX_MINUTE := 1000000000.0
const MAX_VERSION := 9007199254740991.0
const WEATHER := {"sun":"晴", "cloud":"阴", "rain":"雨", "snow":"雪", "mixed":"雨雪混合"}
const SEASONS := ["春", "夏", "秋", "冬"]

static func _number(value: Variant, low: float, high: float) -> bool:
	return (value is int or value is float) and is_finite(value) and value >= low and value <= high

static func _integer(value: Variant, low: float, high: float) -> bool:
	return _number(value, low, high) and float(value) == floorf(value)

static func _eq_number(value: Variant, expected: float) -> bool:
	return (value is int or value is float) and value == expected

static func _eq_string(value: Variant, expected: String) -> bool:
	return value is String and value == expected

static func _exact(value: Variant, fields: Array) -> bool:
	if not value is Dictionary or value.size() != fields.size(): return false
	for key in fields:
		if not value.has(key): return false
	return true

# A ready status alone is insufficient: match the applied scene and authority.
static func authority(snapshot: Dictionary) -> Dictionary:
	var value: Variant = snapshot.get("valleySpirit")
	var world: Variant = snapshot.get("world")
	if not value is Dictionary or not world is Dictionary: return {}
	var world_id: Variant = world.get("id")
	if not world_id is String or world_id.length() > 200 or not world_id.begins_with("godot-mvp-"): return {}
	for ch in world_id:
		if not ch in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_": return {}
	if not _eq_number(value.get("schemaVersion"), 1) or not _eq_string(value.get("mode"), "objective-weather-records") or not _eq_string(value.get("status"), "ready") or not value.get("persistent") is bool or not value.persistent or not _eq_string(value.get("generatedBy"), "fixed-factual-template"):
		return {}
	if not _eq_string(value.get("worldId"), world_id) or not _integer(value.get("permissionVersion"), 1, MAX_VERSION):
		return {}
	if not _number(world.get("minute"), 0, MAX_MINUTE) or not _eq_number(value.get("atMinute"), world.minute) or not _integer(world.get("revision"), 0, MAX_VERSION) or not _eq_number(value.get("worldRevision"), world.revision):
		return {}
	return {"worldId":world_id, "permissionVersion":int(value.permissionVersion), "worldRevision":int(world.revision), "atMinute":float(world.minute)}

static func same_authority(a: Dictionary, b: Dictionary) -> bool:
	return not a.is_empty() and not b.is_empty() and a.worldId == b.worldId and a.permissionVersion == b.permissionVersion

static func latest_range(context: Dictionary) -> Dictionary:
	if context.is_empty(): return {}
	var end := floori(context.atMinute / 60.0)
	return {"fromHour":maxi(0, end - HOURS), "toHour":end} if end > 0 else {}

static func _time(minute: float) -> String:
	var minute_floor := floori(minute)
	var day := floori(minute_floor / 1440.0)
	var season := floori(day / 28.0) % 4
	return "第%d年%s季第%d日 %02d:%02d" % [floori(day / 112.0) + 1, SEASONS[season], day % 28 + 1, floori((minute_floor % 1440) / 60.0), minute_floor % 60]

static func _valid_weather_record(entry: Variant, context: Dictionary, hour: int) -> bool:
	if not _exact(entry, ["entryId", "sourceRef", "permissionVersion", "fromMinute", "toMinute", "fact", "text"]): return false
	var expected_id := "weather-%d-%d" % [context.permissionVersion, hour]
	if not _eq_string(entry.entryId, expected_id) or not _eq_string(entry.sourceRef, context.worldId + "/" + expected_id) or not _eq_number(entry.permissionVersion, context.permissionVersion):
		return false
	if not entry.text is String or entry.text.length() > 300: return false
	var fact: Variant = entry.fact
	if not _exact(fact, ["projectionVersion", "worldId", "worldRevision", "minute", "atUs", "condition", "temperatureDeciC", "relativeHumidityPermille", "cloudPermille", "windPermille", "daylightPermille", "precipitationPermille"]):
		return false
	if not _eq_number(fact.projectionVersion, 1) or not _eq_string(fact.worldId, context.worldId) or not _integer(fact.worldRevision, 0, context.worldRevision): return false
	if not _number(fact.minute, hour * 60.0, context.atMinute) or fact.minute >= (hour + 1) * 60.0 or not _eq_number(entry.fromMinute, fact.minute) or not _eq_number(entry.toMinute, fact.minute):
		return false
	if not fact.atUs is String or fact.atUs.length() > 16 or not fact.atUs.is_valid_int() or str(int(fact.atUs)) != fact.atUs:
		return false
	# JS rounds canonical decimal micro-minutes; allow one micro-minute of
	# binary floating-point error, never substitute a different reading.
	if absf(float(fact.atUs) - roundf(fact.minute * 1000000.0)) > 1.0: return false
	if not fact.condition is String or not WEATHER.has(fact.condition) or not _integer(fact.temperatureDeciC, -300, 450): return false
	for key in ["relativeHumidityPermille", "cloudPermille", "windPermille", "daylightPermille", "precipitationPermille"]:
		if not _integer(fact[key], 0, 1000): return false
	return true

# No remote prose enters UI. Only structured, bounded facts or explicit gaps.
static func presentation(value: Variant, context: Dictionary, requested: Dictionary) -> String:
	if context.is_empty() or not _exact(requested, ["fromHour", "toHour"]) or not _exact(value, ["schemaVersion", "status", "mode", "worldId", "permissionVersion", "range", "coverage", "slots", "nextCursor"]): return ""
	if not _eq_number(value.schemaVersion, 1) or not _eq_string(value.status, "ready") or not _eq_string(value.mode, "objective-weather-records") or not _eq_string(value.worldId, context.worldId) or not _eq_number(value.permissionVersion, context.permissionVersion) or typeof(value.nextCursor) != TYPE_NIL: return ""
	if not _integer(requested.fromHour, 0, MAX_MINUTE / 60.0) or not _integer(requested.toHour, 0, MAX_MINUTE / 60.0): return ""
	var start: int = requested.fromHour
	var end: int = requested.toHour
	if start < 0 or end <= start or end - start > HOURS or end > floori(context.atMinute / 60.0): return ""
	for section in [value.range, value.coverage]:
		if not _exact(section, ["fromHour", "toHour"]) or not _eq_number(section.fromHour, start) or not _eq_number(section.toHour, end): return ""
	if not value.slots is Array or value.slots.size() != end - start: return ""
	var lines := PackedStringArray(["天气档案 · 已结束的游戏小时", "%s 至 %s（不含）" % [_time(start * 60.0), _time(end * 60.0)], "只显示实际时点；缺失不补记。", ""])
	for i in range(value.slots.size()):
		var slot: Variant = value.slots[i]
		var hour := start + i
		if not slot is Dictionary or not _eq_number(slot.get("hour"), hour): return ""
		if _eq_string(slot.get("status"), "missing"):
			if not _exact(slot, ["hour", "status"]): return ""
			lines.append("%s · 缺少可读时点" % _time(hour * 60.0))
		elif _eq_string(slot.get("status"), "observed"):
			if not _exact(slot, ["hour", "status", "record"]) or not _valid_weather_record(slot.record, context, hour): return ""
			var fact: Dictionary = slot.record.fact
			lines.append("%s · %s · %.1f℃ / 湿度 %.1f%%" % [_time(fact.minute), WEATHER[fact.condition], fact.temperatureDeciC / 10.0, fact.relativeHumidityPermille / 10.0])
			lines.append("来源：" + slot.record.sourceRef)
		else:
			return ""
	return "\n".join(lines)


# Never use provider prose or display unpublished/foreign data.
static func almanac_presentation(value: Variant, context: Dictionary) -> String:
	if context.is_empty() or not value is Dictionary or not _eq_string(value.get("worldId"), context.worldId) or not _eq_number(value.get("permissionVersion"), context.permissionVersion):
		return ""
	if _eq_string(value.get("status"), "objective-only") and _exact(value, ["status", "worldId", "permissionVersion"]):
		return "暂无已发布的年鉴。客观天气档案仍可读取，不代表模型生成。"
	if not _eq_string(value.get("status"), "ready") or not _exact(value, ["status", "worldId", "permissionVersion", "entry"]): return ""
	var entry: Variant = value.entry
	if not _exact(entry, ["mode", "origin", "entryId", "textVersion", "supersedes", "fromMinute", "throughMinute", "projectionVersion", "permissionVersion", "coverage", "unselectedHourBuckets", "facts", "atmosphere"]): return ""
	if not _eq_string(entry.mode, "curated-verified-weather") or not _eq_string(entry.coverage, "selected-actual-points-only") or not _eq_number(entry.projectionVersion, 1) or not _eq_number(entry.permissionVersion, context.permissionVersion): return ""
	if not _number(entry.fromMinute, 0, context.atMinute) or not _number(entry.throughMinute, entry.fromMinute, context.atMinute) or not _integer(entry.textVersion, 1, 10000): return ""
	if not entry.facts is Array or entry.facts.is_empty() or entry.facts.size() > 24: return ""
	if not _exact(entry.origin, ["schemaVersion", "kind"]) or not _eq_number(entry.origin.schemaVersion, 1): return ""
	var attribution := ""
	if _eq_string(entry.origin.kind, "offline-synthetic"):
		attribution = "离线合成选材，不是真实模型输出。"
	elif _eq_string(entry.origin.kind, "unverified-admission"):
		attribution = "选材来源未核验，不代表真实模型输出。"
	if attribution.is_empty(): return ""
	var lines := PackedStringArray(["谷灵 · 最新已发布年鉴", attribution, "事实字段已核对；以下为获选时点，不代表整段天气。", "文字版本：%d" % int(entry.textVersion), ""])
	var shown := {}
	for fact in entry.facts:
		if not _exact(fact, ["sourceRef", "minute", "field", "value", "text"]) or not _number(fact.minute, entry.fromMinute, entry.throughMinute) or not fact.field is String: return ""
		var hour := floori(float(fact.minute) / 60.0)
		var expected_ref := "%s/weather-%d-%d" % [context.worldId, context.permissionVersion, hour]
		if not _eq_string(fact.sourceRef, expected_ref): return ""
		var key: String = expected_ref + ":" + fact.field
		if shown.has(key): return ""
		shown[key] = true
		var line := ""
		match fact.field:
			"condition":
				if fact.value is String and WEATHER.has(fact.value): line = "天气 %s" % WEATHER[fact.value]
			"temperatureDeciC":
				if _integer(fact.value, -300, 450): line = "气温 %.1f℃" % (fact.value / 10.0)
			"relativeHumidityPermille":
				if _integer(fact.value, 0, 1000): line = "相对湿度 %.1f%%" % (fact.value / 10.0)
		if line.is_empty(): return ""
		lines.append("%s · %s" % [_time(float(fact.minute)), line])
		lines.append("来源：" + expected_ref)
	return "\n".join(lines)
