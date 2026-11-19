extends RefCounted

const SCOPE := "\n只显示近期可核实记录；旧记录或超出范围可能不显示。"
const CULTIVARS := {"spring":"春秋芜菁", "summer":"夏根", "winter":"冬根"}

static func valid_minute(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(value) and value >= 0

static func exact(value: Dictionary, keys: Array) -> bool:
	if value.size() != keys.size(): return false
	for key in keys:
		if not value.has(key): return false
	return true

static func valid_row(row: Variant, kind: String, minute: Variant) -> bool:
	if not row is Dictionary: return false
	if not valid_minute(row.get("at")) or row.at > minute or not valid_minute(row.get("schemaVersion")) or row.schemaVersion != 1 or row.get("kind") != kind: return false
	if not (row.get("meal") is int or row.get("meal") is float) or row.meal != 1: return false
	if kind == "ate": return exact(row, ["schemaVersion", "kind", "meal", "at"])
	return exact(row, ["schemaVersion", "kind", "cultivar", "roots", "water", "meal", "at"]) and row.cultivar is String and CULTIVARS.has(row.cultivar) and (row.roots is int or row.roots is float) and row.roots == 2 and (row.water is int or row.water is float) and row.water == 1

static func details(observation: Variant, actor_id: String, minute: Variant) -> String:
	var text := "最近可核实的做饭：暂无记录\n最近可核实的实际进食：暂无餐食记录" + SCOPE
	if not observation is Dictionary or not valid_minute(minute) or not valid_minute(observation.get("atMinute")): return text
	if not exact(observation, ["schemaVersion", "atMinute", "residents"]) or not valid_minute(observation.schemaVersion) or observation.schemaVersion != 1 or observation.atMinute != minute or not observation.residents is Dictionary: return text
	var person: Variant = observation.residents.get(actor_id)
	if not person is Dictionary or not exact(person, ["cooked", "ate"]): return text
	var cooked := "最近可核实的做饭：暂无记录"
	var ate := "最近可核实的实际进食：暂无餐食记录"
	if valid_row(person.cooked, "cooked", minute):
		var row: Dictionary = person.cooked
		cooked = "最近做饭（游戏分钟 %s）：%d份%s＋%d份清水 → %d份餐食" % [str(row.at), row.roots, CULTIVARS[row.cultivar], row.water, row.meal]
	if valid_row(person.ate, "ate", minute):
		var row: Dictionary = person.ate
		ate = "最近实际进食（游戏分钟 %s）：本人吃下%d份餐食" % [str(row.at), row.meal]
	return cooked + "\n" + ate + "\n两条记录独立，不追溯同一份餐食或田里哪一茬。" + SCOPE
