extends RefCounted

const WeatherArchive = preload("res://valley_spirit_archive.gd")

# This view is separate from resident knowledge and the ordinary event journal.
static func text(snapshot: Dictionary, connected: bool) -> String:
	if not connected: return "连接已断开。"
	if snapshot.get("publicProjectionPending") == true: return "记录更新中…"
	var value: Variant = snapshot.get("valleySpirit")
	var world: Variant = snapshot.get("world")
	if not value is Dictionary or value.get("schemaVersion") != 1 or not world is Dictionary:
		return "暂无天气记录。"
	if value.get("status") == "revoked": return "天气记录已撤回。"
	if value.get("status") != "ready": return "天气记录暂不可用。"
	if value.get("worldId") != world.get("id") or value.get("atMinute") != world.get("minute") or value.get("worldRevision") != world.get("revision") or value.get("persistent") != true or value.get("generatedBy") != "fixed-factual-template" or value.get("modelNarration") != "disabled-pending-shared-admission-and-request-recovery" or not value.get("records") is Array:
		return "天气记录暂不可用。"
	var lines := PackedStringArray()
	for entry in value.records:
		if not entry is Dictionary or entry.get("permissionVersion") != value.get("permissionVersion") or not entry.get("fact") is Dictionary or not entry.get("sourceRef") is String or not entry.get("text") is String: return "天气记录暂不可用。"
		var fact: Dictionary = entry.fact
		if fact.get("worldId") != world.id or fact.get("projectionVersion") != 1 or not (fact.get("minute") is int or fact.get("minute") is float) or not is_finite(fact.minute) or fact.minute < 0 or fact.minute > world.minute or entry.get("fromMinute") != fact.minute or entry.get("toMinute") != fact.minute: return "天气记录暂不可用。"
		var line := WeatherArchive.weather_line(fact)
		if line.is_empty(): return "天气记录暂不可用。"
		lines.append(line)
	if value.records.is_empty(): lines.append("暂无天气记录。")
	return "\n".join(lines)
