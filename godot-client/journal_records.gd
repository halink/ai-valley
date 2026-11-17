extends RefCounted

const RECORD_LIMIT := 100
const RULE_GREETING := "〔规则示例问候〕"
const DRINK_REPORT := "自行饮用1份随身清水，库存实际扣减1份，口渴从"
const DRINK_SUFFIX := "；MVP未启用缺水伤害。"
const Snapshot = preload("res://snapshot.gd")

static func from_world(world: Dictionary, driver: String) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var residents := {}
	for person in world.get("residents", []):
		residents[person.id] = Snapshot.resident_name(person)
	var events: Array = world.get("events", [])
	for index in range(events.size() - 1, maxi(-1, events.size() - RECORD_LIMIT - 1), -1):
		var event: Dictionary = events[index]
		var text: Variant = event.get("text")
		if not text is String or text.strip_edges().is_empty():
			continue
		var time := world_time(event.get("at"))
		var words := _observer_sentence(event, text, residents, driver, world.id.begins_with("godot-mvp-"))
		result.append({
			"id": str(event.get("id", index)),
			"day": time.day,
			"time": time.clock,
			"category": words.category,
			"line": _one_line(words.text).left(108),
			"original": text
		})
	return result

static func world_time(value: Variant) -> Dictionary:
	if (value is int or value is float) and is_finite(value) and value >= 0 and value <= 9007199254740991:
		var minute := int(floor(value))
		return {"day": int(minute / 1440) + 1, "clock": "%02d:%02d" % [int((minute % 1440) / 60), minute % 60]}
	return {"day": 0, "clock": "—"}

static func _observer_sentence(event: Dictionary, text: String, names: Dictionary, driver: String, mvp: bool) -> Dictionary:
	var category: String = {
		"conversation": "交谈", "production": "劳作", "construction": "营建",
		"trade": "交换", "care": "照护", "system": "山谷", "hazard": "险情",
		"arrival": "来访", "departure": "离谷", "birth": "出生", "death": "离世",
		"relationship": "往来", "education": "学堂", "duty": "值守", "burial": "安葬",
	}.get(str(event.get("kind")), "日常")
	var actors: Variant = event.get("actors")
	var subject := ""
	if actors is Array and not actors.is_empty() and actors[0] is String:
		subject = names.get(actors[0], "")
	if event.get("kind") == "conversation" and not subject.is_empty():
		var speech: Variant = event.get("speechText")
		if speech is String and not speech.is_empty():
			if driver == "local-rules" and speech.begins_with(RULE_GREETING):
				category = "规则对话"
				speech = speech.trim_prefix(RULE_GREETING)
			return {"category": category, "text": subject + "：「" + speech + "」"}
	if mvp and event.get("kind") == "action" and not subject.is_empty():
		if text.begins_with(subject + DRINK_REPORT) and text.ends_with(DRINK_SUFFIX):
			return {"category": "饮水", "text": subject + "喝了一份随身的清水。"}
	return {"category": category, "text": text}

static func _one_line(text: String) -> String:
	return text.strip_edges().replace("\n", " ").replace("\r", " ").replace("\t", " ")
