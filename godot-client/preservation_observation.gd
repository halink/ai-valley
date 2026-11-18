extends RefCounted

static func from_snapshot(snapshot: Dictionary) -> Dictionary:
	var world: Variant = snapshot.get("world")
	var mode: Variant = snapshot.get("mvp")
	if not world is Dictionary or not mode is Dictionary: return {}
	var state: Variant = world.get("mvpPreservation")
	var value: Variant = mode.get("preservation")
	if not state is Dictionary or state.get("schemaVersion") != 1 or state.get("lastMinute") != world.get("minute"): return {}
	if not value is Dictionary or value.get("schemaVersion") != 1 or value.get("atMinute") != world.get("minute"): return {}
	if not value.get("installed") is bool or value.get("installed") != (state.get("installed") != null): return {}
	if value.get("storageScope") != "new-canned-lots-only" or value.get("rawFoodPerishability") != "unmodeled" or value.get("winterReady") != false: return {}
	if not value.get("residents") is Array: return {}
	var people := {}
	for person in value.residents:
		if not person is Dictionary or not person.get("actorId") is String or people.has(person.actorId): return {}
		for field in ["unknownFreshness", "knownQuantity", "knownNutrition", "workOrdersToday"]:
			var number: Variant = person.get(field)
			if not (number is int or number is float) or not is_finite(number) or number < 0 or floor(number) != number: return {}
		if person.get("container") not in ["person", "sealed-estate"]: return {}
		if not person.get("lots") is Array: return {}
		var total := 0.0
		for lot in person.lots:
			if not lot is Dictionary or not lot.get("id") is String: return {}
			for field in ["quantity", "producedAt", "expiresAt"]:
				var number: Variant = lot.get(field)
				if not (number is int or number is float) or not is_finite(number) or number < 0: return {}
			if lot.quantity <= 0 or floor(lot.quantity) != lot.quantity or lot.producedAt > value.atMinute or lot.expiresAt != lot.producedAt + 56 * 1440 or lot.expiresAt <= value.atMinute: return {}
			total += lot.quantity
		if total != person.knownQuantity or total * 26 != person.knownNutrition: return {}
		people[person.actorId] = person
	return {"installed":value.installed, "atMinute":value.atMinute, "people":people}

static func station(value: Dictionary) -> String:
	if value.is_empty(): return "罐藏观测暂缺"
	return "罐藏工位：" + ("已实际安装" if value.installed else "尚未安装（需6木6石及劳动）") + "\n新制罐藏有56日到期批次\n鲜食腐坏未模拟 · 非冬储充分证明"

static func details(value: Dictionary, actor_id: String) -> String:
	if value.is_empty() or not value.people.has(actor_id): return "罐藏观测暂缺"
	var person: Dictionary = value.people[actor_id]
	var text := ("封存遗产" if person.container == "sealed-estate" else "本人") + "罐藏：已知批次 %d 份 · 旧鲜度未知 %d 份" % [int(person.knownQuantity), int(person.unknownFreshness)]
	if not person.lots.is_empty():
		var nearest: float = INF
		for lot in person.lots: nearest = minf(nearest, float(lot.expiresAt))
		text += "\n最近到期：还有 %.2f 游戏日" % ((nearest - float(value.atMinute)) / 1440.0)
	else: text += "\n暂无具有已知到期时间的本人罐藏"
	return text + "\n今日已开始 %d 张准备工作单\n鲜食腐坏未模拟 · 非冬储充分证明" % int(person.workOrdersToday)
