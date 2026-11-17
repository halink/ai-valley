extends RefCounted

const METRICS := {"affection": "好感", "trust": "信任", "conflict": "矛盾"}
const PER_DIRECTION := 6

static func relation(person: Dictionary, target_id: String) -> Dictionary:
	var relations: Variant = person.get("relations")
	if relations is Array:
		for link in relations:
			if link is Dictionary and link.get("targetId") == target_id: return link
	return {}

static func timeline(world: Dictionary, history: Variant, left: Dictionary, right: Dictionary) -> Array[Dictionary]:
	var people: Dictionary = {left.id: left, right.id: right}
	var ties: Dictionary = {left.id: relation(left, right.id), right.id: relation(right, left.id)}
	var events: Array = world.get("events", [])
	var records: Array
	var sources: Array
	if history is Dictionary and history.get("records") is Array and history.get("sources") is Array:
		records = history.records
		sources = history.sources
	else:
		records = events.duplicate()
		records.reverse()
		sources = events
	var causes := {}
	for event in sources:
		if event is Dictionary and event.get("id") is String: causes[event.id] = event
	var result: Array[Dictionary] = []
	var counts := {}
	var shown := {}
	for event in records:
		if not event is Dictionary or not event.get("id") is String or shown.has(event.id): continue
		var view: Variant = event.get("interpretation")
		if not view is Dictionary: continue
		var from: Variant = view.get("observerId")
		var to: Variant = view.get("targetId")
		if from == to or not people.has(from) or not people.has(to) or counts.get(from, 0) >= PER_DIRECTION: continue
		var last: Variant = ties[from].get("lastInterpretation")
		var note := caption(view.get("text"))
		if note.is_empty() and last is Dictionary and last.get("recordEventId") == event.id:
			note = caption(last.get("text"))
		if note.is_empty(): note = _older_note(event.get("text"))
		result.append(_record(event.id, event.get("at"), from, to, view, note, causes, people[from]))
		counts[from] = counts.get(from, 0) + 1
		shown[event.id] = true
	# Older save/snapshot formats may retain a last interpretation after its event drops out of view.
	for from: String in people:
		var last: Variant = ties[from].get("lastInterpretation")
		if not last is Dictionary or not last.get("recordEventId") is String or shown.has(last.recordEventId): continue
		if counts.get(from, 0) >= PER_DIRECTION: continue
		var to: String = right.id if from == left.id else left.id
		result.append(_record(last.recordEventId, last.get("at"), from, to, last, caption(last.get("text")), causes, people[from]))
	for index in range(result.size()): result[index].order = index
	result.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return a.order < b.order if a.at == b.at else a.at > b.at)
	return result

static func _record(id: String, at: Variant, from: String, to: String, view: Dictionary, note: String, causes: Dictionary, person: Dictionary) -> Dictionary:
	var source_id: Variant = view.get("sourceEventId")
	var origin: Dictionary = causes.get(source_id, {})
	var origin_text := caption(origin.get("text"))
	if origin_text.is_empty():
		var memories: Variant = person.get("memories")
		if memories is Array:
			for memory in memories:
				if memory is Dictionary and source_id is String and memory.get("eventId") == source_id:
					origin_text = caption(memory.get("text"))
					break
	return {
		"id": id, "at": _minute(at), "from": from, "to": to, "note": note,
		"source": str(view.get("source", "")), "source_at": _minute(origin.get("at")),
		"origin": origin_text, "change": _applied_change(view.get("change"))
	}

static func _minute(value: Variant) -> float:
	if (value is int or value is float) and is_finite(value) and value >= 0 and value <= 9007199254740991:
		return float(value)
	return -1.0

static func _applied_change(value: Variant) -> Dictionary:
	if not value is Dictionary: return {}
	var result := {}
	for key: String in METRICS:
		var amount: Variant = value.get(key)
		if not (amount is int or amount is float) or not is_finite(amount) or amount != floor(amount) or abs(amount) > 5:
			return {}
		result[key] = int(amount)
	return result

static func score(value: Variant, minimum: int) -> String:
	if not (value is int or value is float) or not is_finite(value) or value != floor(value) or value < minimum or value > 100:
		return "—"
	return signed(int(value))

static func signed(value: int) -> String:
	if value > 0: return "+" + str(value)
	return "−" + str(-value) if value < 0 else "0"

static func caption(value: Variant) -> String:
	if not value is String: return ""
	var text: String = value.strip_edges()
	return text.left(459) + "…" if text.length() > 460 else text

static func _older_note(value: Variant) -> String:
	if not value is String: return ""
	const OPENING := "形成自己的理解：“"
	const ENDING := "”。这是个人看法，不代表对方也这样想或消息已经核实。"
	var position: int = value.find(OPENING)
	if position >= 0 and value.ends_with(ENDING):
		return caption(value.trim_suffix(ENDING).substr(position + OPENING.length()))
	return caption(value)
