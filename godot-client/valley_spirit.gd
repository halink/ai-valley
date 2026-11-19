extends RefCounted

# This view is separate from resident knowledge and the ordinary event journal.
static func text(snapshot: Dictionary, connected: bool) -> String:
	if not connected: return "谷灵 · 客观天气手记\n连接已断开，历史发布权限尚未重新核验。"
	if snapshot.get("publicProjectionPending") == true: return "谷灵 · 客观天气手记\n等待重新核验公开权限；不显示旧记录。"
	var value: Variant = snapshot.get("valleySpirit")
	var world: Variant = snapshot.get("world")
	if not value is Dictionary or value.get("schemaVersion") != 1 or not world is Dictionary:
		return "谷灵 · 客观天气手记\n当前入口未接入持久公共记录。"
	if value.get("status") == "revoked": return "谷灵 · 客观天气手记\n公共天气发布已撤回；历史记录与来源暂不可读取。"
	if value.get("status") != "ready": return "谷灵 · 客观天气手记\n独立记录暂不可用；不影响山谷继续生活。"
	if value.get("worldId") != world.get("id") or value.get("atMinute") != world.get("minute") or value.get("worldRevision") != world.get("revision") or value.get("persistent") != true or value.get("generatedBy") != "fixed-factual-template" or value.get("modelNarration") != "disabled-pending-shared-admission-and-request-recovery" or not value.get("records") is Array:
		return "谷灵记录未通过同源检查。"
	var lines := PackedStringArray(["谷灵 · 客观天气手记", "只记公开天气；固定事实模板，非模型生成。", "每游戏小时至多留一个实际时点，不补造缺失时段。", "模型叙事尚未启用，居民不会自动获知这些记录。", ""])
	for entry in value.records:
		if not entry is Dictionary or entry.get("permissionVersion") != value.get("permissionVersion") or not entry.get("fact") is Dictionary or not entry.get("sourceRef") is String or not entry.get("text") is String: return "谷灵记录未通过来源检查。"
		var fact: Dictionary = entry.fact
		if fact.get("worldId") != world.id or fact.get("projectionVersion") != 1 or not (fact.get("minute") is int or fact.get("minute") is float) or not is_finite(fact.minute) or fact.minute < 0 or fact.minute > world.minute or entry.get("fromMinute") != fact.minute or entry.get("toMinute") != fact.minute: return "谷灵记录未通过时点检查。"
		lines.append(entry.text)
		lines.append("来源：" + entry.sourceRef)
		lines.append("提交版本：" + str(fact.get("worldRevision", "未知")) + " · 权限版本：" + str(entry.permissionVersion))
		lines.append("")
	if value.records.is_empty(): lines.append("暂无当前权限版本的已留存时点。")
	return "\n".join(lines)
