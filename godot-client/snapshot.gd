class_name ValleySnapshot
extends RefCounted

# Full snapshots only. SSE deltas are NOT compatible with this M1 transport.
static func validate(value: Variant) -> String:
	if not value is Dictionary or not value.get("world") is Dictionary:
		return "Missing world"
	if value.has("mvp"):
		if not value.mvp is Dictionary or value.mvp.get("driver") not in ["local-rules", "model", "disabled"] or not value.mvp.get("ephemeral") is bool:
			return "Invalid MVP mode"
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
	if not person.has("activity"):
		return "行为：未知"
	var activity = person.get("activity")
	if not activity is Dictionary:
		return "暂无进行中行为 · 决策状态未知"
	var action_type = activity.get("action", {}).get("type", "unknown")
	var purpose := action_name(str(action_type))
	if not activity.get("path", []).is_empty() or (activity.get("room") is Dictionary and not activity.room.get("path", []).is_empty()):
		return "移动中 · 接下来：" + purpose
	return "到达现场：" + purpose

static func valid_position(at: Variant) -> bool:
	if not at is Dictionary:
		return false
	for axis in ["x", "y"]:
		if not (at.get(axis) is float or at.get(axis) is int) or not is_finite(at[axis]):
			return false
	return true

static func mode_label(snapshot: Dictionary) -> String:
	var mode = snapshot.get("mvp")
	if not mode is Dictionary:
		return "观察接口 · 客户端尚未验证决策来源"
	var label := "模型已禁用 · 不自动改用规则"
	if mode.driver == "local-rules":
		label = "规则驱动合成演示 · 不调用大模型"
	elif mode.driver == "model":
		label = "已配置模型 · 供应商响应不等于验收结果"
	return label + (" · 不保存世界" if mode.ephemeral else " · 世界持久保存")

# Detail formatting never turns missing fields into zero or an inferred decision.
static func number_label(value: Variant) -> String:
	if (value is int or value is float) and is_finite(value):
		return ("%.1f" % value).trim_suffix(".0")
	return "未知"

# Simulation time comes only from the latest snapshot, never the device clock.
static func world_summary(world: Dictionary) -> String:
	var minute = world.get("minute")
	var clock_text := "世界时间未知"
	if (minute is int or minute is float) and is_finite(minute) and minute >= 0 and minute <= 9007199254740991:
		var whole := int(floor(minute))
		var day := int(whole / 1440) + 1
		var within_day := whole % 1440
		clock_text = "第 %d 天 · %02d:%02d（世界时间）" % [day, int(within_day / 60), within_day % 60]
	var resources = world.get("resources")
	if not resources is Array:
		return clock_text + "\n环境资源：未知"
	var berries := 0.0
	var water := 0.0
	var stocked_bushes := 0
	var bush_count := 0
	for source in resources:
		if not source is Dictionary or source.get("kind") not in ["bush", "spring"]:
			continue
		var amount = source.get("amount")
		if not (amount is int or amount is float) or not is_finite(amount) or amount < 0:
			return clock_text + "\n环境资源：未知"
		if source.kind == "bush":
			berries += amount
			bush_count += 1
			# Match scene nonempty-source coloring; not a harvestability claim.
			if amount > 0: stocked_bushes += 1
		else:
			water += amount
	return clock_text + "\n环境浆果 %s · 有果果丛 %d/%d\n泉水余量 %s（不含居民库存）" % [number_label(berries), stocked_bushes, bush_count, number_label(water)]

static func inventory_label(person: Dictionary) -> String:
	var inventory = person.get("inventory")
	if not inventory is Dictionary:
		return "库存：未知"
	var keys: Array = inventory.keys()
	keys.sort()
	var entries: Array[String] = []
	for key in keys:
		var value = inventory[key]
		if number_label(value) == "未知":
			entries.append(item_name(str(key)) + "：未知")
		elif value != 0:
			entries.append(item_name(str(key)) + "：" + number_label(value))
	return "库存：" + (", ".join(entries) if not entries.is_empty() else "空")

static func action_detail(person: Dictionary) -> String:
	var activity = person.get("activity")
	if not activity is Dictionary:
		return activity_label(person)
	var target = activity.get("target")
	var target_text := "未知"
	if valid_position(target):
		target_text = "(%s, %s)" % [target.x, target.y]
	return activity_label(person) + " · 目标位置 " + target_text + " · 剩余工作时间 " + number_label(activity.get("remaining")) + " 世界分钟（不含路程）"

# The current accepted plan is an explicit game artifact, not hidden model reasoning.
# Never fall back to person.intention: that text can outlive its completed plan.
static func plan_summary(person: Dictionary) -> String:
	if not person.has("plan"):
		return "行为计划：未知"
	var plan = person.get("plan")
	if plan == null:
		return "行为计划：当前没有待执行计划（不代表居民没有意愿）"
	if not plan is Dictionary or not plan.get("actions") is Array:
		return "行为计划：未知"
	var intention = plan.get("intention")
	var declared := "未提供"
	if intention is String and not intention.strip_edges().is_empty():
		# Plain Label text, bounded and single-line; never render markup or links.
		declared = intention.replace("\n", " ").replace("\r", " ").replace("\t", " ").strip_edges().left(240)
		if intention.length() > 240: declared += "…"
	var queued: Array[String] = []
	for action in plan.actions.slice(0, 5):
		queued.append(action_name(str(action.get("type", ""))) if action is Dictionary else "未知行为")
	var next := "无后续动作"
	if not queued.is_empty():
		next = " → ".join(queued)
		if plan.actions.size() > 5: next += " → …"
	return "行为计划 · 已提交意图：" + declared + "\n后续队列：" + next + "\n当前动作见上方；队列尚未完成，可能失败或改变。不是模型思维记录。"

static func failure_label(person: Dictionary) -> String:
	if not person.has("lastFailure"):
		return "上次行为失败：未知"
	# Match whole engine-owned strings only; never echo arbitrary/model text.
	if person.lastFailure == null:
		return "上次行为失败：无记录"
	var reasons := {
		"没有这份可以食用的实际食品": "所选食品不存在、不可食用或数量不足",
		"没有携带一份实际清水": "随身清水不足",
		"资源已不足，须重新决定": "目标资源不足，需要重新决定",
		"资源或实际位置已经变化": "资源或实际位置已变化，需要重新决定",
		"尚未找到这处资源": "目标资源不存在或尚未被居民发现",
		"目标目前没有可达路线": "目标目前没有可达路线",
		"泉水已淤塞，须退水后实际清理才可安全取用": "泉水淤塞，暂不能取水",
		"尚未拥有可使用的真实床位，当前住处存在床位缺口": "当前没有可用床位",
		"MVP当前没有可使用的真实自有床位": "当前没有可用自有床位",
		"真实床位已经失效，须留在当前位置重新决定": "原床位已失效，需要重新决定",
		"原床位已经改变，须留在当前位置重新决定": "原床位已改变，需要重新决定",
		"实际床位或室内路线已阻断，须留在当前位置重新决定": "床位或室内路线受阻",
		"真实床位仍被其他居民实际占用，须重新决定": "床位被其他居民占用"
	}
	var reason := "有记录（未识别原因，详情已隐藏）"
	if person.lastFailure is String:
		reason = reasons.get(person.lastFailure, reason)
	return "上次行为失败：" + reason + "（历史记录，不代表当前仍受阻）"

static func status_number(value: Variant, integer: bool = false) -> String:
	if number_label(value) == "未知" or value < 0:
		return "未知"
	if integer and value != floor(value):
		return "未知"
	return ("%.1f" % value).trim_suffix(".0")

static func model_status(observation: Dictionary, actor_id: String = "") -> String:
	var model = observation.get("model")
	if not model is Dictionary:
		return "模型请求／冷却／上次错误：未知"
	var parts: Array[String] = []
	if observation.get("paused") is bool:
		parts.append("已暂停" if observation.paused else "世界时钟运行中")
	else:
		parts.append("时钟：未知")
	var ids = model.get("requestActorIds")
	var valid_ids: bool = ids is Array
	if valid_ids:
		for id in ids:
			if not id is String:
				valid_ids = false
	if not actor_id.is_empty():
		return ("该居民模型请求处理中" if actor_id in ids else "该居民无进行中模型请求") if valid_ids else "该居民模型请求：未知"
	parts.append("进行中请求数：" + status_number(model.get("requestCount"), true))
	parts.append("冷却中的供应商通道数：" + status_number(model.get("cooldownProviders"), true))
	parts.append("快照时最长剩余冷却：" + status_number(model.get("cooldownRemainingMs")) + " ms")
	var failure = model.get("lastFailure", "unknown")
	var allowed := ["http_429", "http_error", "invalid_response", "unresolved_request", "other_failure"]
	parts.append("最近模型错误：" + ("当前状态无记录" if failure == null else (error_name(str(failure)) if failure in allowed else "未知")))
	return " · ".join(parts)

static func thirst_label(world: Dictionary, person_id: String) -> String:
	var state = world.get("mvpDrinking")
	if not state is Dictionary or state.get("version") != 1 or not state.get("thirst") is Dictionary:
		return "口渴：未启用／未知"
	return "口渴：" + number_label(state.thirst.get(person_id)) + "/100（MVP 暂无脱水伤害）"

# Optional room projection is accepted only for this exact snapshot. Fail closed.
static func room_views(value: Dictionary) -> Dictionary:
	var result := {}
	var view = value.get("roomViews")
	var w: Dictionary = value.world
	if not view is Dictionary or view.get("worldId") != w.id or view.get("revision") != w.revision or not view.get("rooms") is Array or view.rooms.size() > 64:
		return result
	for room in view.rooms:
		if not room is Dictionary or not room.get("buildingId") is String:
			return {}
		var found := false
		for b in w.get("buildings", []):
			if b.get("id") == room.buildingId and b.get("kind") in ["home", "lodge"]: found = true
		if not found or result.has(room.buildingId): return {}
		for axis in ["width", "height"]:
			var n = room.get(axis)
			if not (n is int or n is float) or not is_finite(n) or n != floor(n) or n < 6 or n > 64: return {}
		if not room.get("slots") is Array or room.slots.size() > 128 or not room.get("blocked") is Array or room.blocked.size() > 4096 or not room_position(room.get("entry"), room): return {}
		for slot in room.slots:
			if not slot is Dictionary or not slot.get("key") is String or not slot.get("kind") is String or not room_position(slot.get("at"), room): return {}
		for at in room.blocked:
			if not room_position(at, room): return {}
		result[room.buildingId] = room
	return result

static func room_position(at: Variant, room: Dictionary) -> bool:
	return valid_position(at) and at.x == floor(at.x) and at.y == floor(at.y) and at.x >= 0 and at.y >= 0 and at.x < room.width and at.y < room.height

static func resident_room_position(at: Variant, room: Dictionary) -> bool:
	return room_position(at, room) and at.x >= 1 and at.y >= 4 and at.x < room.width-1 and at.y < room.height-1

# Central vocabulary for protocol enums; extend here when adding actions/items.
# Unknown protocol identifiers are not user-facing names.
static func item_name(code: String) -> String:
	return {"seed": "种子", "turnip": "根菜", "berry": "浆果", "water": "水", "wood": "木材", "stone": "石头", "fish": "鱼", "grain": "谷物", "meat": "肉", "bread": "面包"}.get(code, "未知物品")

static func action_name(code: String) -> String:
	return {"plant": "播种", "water": "浇水", "harvest": "收获", "wait": "等待", "gather": "采集", "eat": "进食", "mvpDrink": "饮水", "rest": "休息", "move": "移动", "sleep": "睡觉", "fish": "钓鱼", "talk": "交谈"}.get(code, "未知行为")

static func error_name(code: String) -> String:
	return {"http_429": "请求受限（HTTP 429）", "http_error": "服务响应错误", "invalid_response": "响应格式无效", "unresolved_request": "请求未完成", "other_failure": "其他错误"}.get(code, "未知")

static func resident_name(person: Dictionary) -> String:
	var value = person.get("name")
	return value if value is String and not value.strip_edges().is_empty() else "未命名居民"

static func resident_status(person: Dictionary) -> String:
	return {"alive": "存活", "dead": "死亡"}.get(person.get("status", ""), "状态未知")

static func resource_name(code: String) -> String:
	return {"spring": "泉水", "bush": "浆果丛", "tree": "树木", "rock": "岩石"}.get(code, "未知资源")

# Observer-visible facts only, not a resident's memory or a complete history.
static func event_summary(world: Dictionary, selected: String, resident_only: bool, connected: bool) -> String:
	if not connected:
		return "近期事件：未连接／数据过期，等待新快照"
	if resident_only and selected.is_empty():
		return "近期事件：请先选择一位居民"
	var lines: Array[String] = []
	var entries: Array = world.get("events", [])
	for i in range(entries.size() - 1, -1, -1):
		var entry = entries[i]
		if not entry is Dictionary or not entry.get("text") is String:
			continue
		if resident_only and (not entry.get("actors") is Array or not selected in entry.actors):
			continue
		var at = entry.get("at")
		var when := "时间未知"
		if (at is int or at is float) and is_finite(at) and at >= 0 and at <= 9007199254740991:
			var whole := int(floor(at))
			when = "第 %d 天 %02d:%02d" % [int(whole / 1440) + 1, int((whole % 1440) / 60), whole % 60]
		lines.append("[%s] %s" % [when, entry.text])
		if lines.size() == 8:
			break
	var scope := "所选居民参与" if resident_only else "全谷"
	if lines.is_empty():
		return "近期事件（%s）：当前快照无记录，不代表从未发生" % scope
	return "近期事件（%s，最新在前，最多 8 条）：\n" % scope + "\n".join(lines) + "\n仅展示当前快照，不是完整历史或个人记忆。"

# Only the resident's delivered records; never fill gaps from the world ledger.
static func memory_summary(person: Dictionary) -> String:
	var memories = person.get("memories")
	if not memories is Array:
		return "本人近期经历：未知"
	var records: Array = []
	for memory in memories:
		if not memory is Dictionary or not memory.get("text") is String:
			continue
		var received = memory.get("receivedAt")
		if not (received is int or received is float) or not is_finite(received) or received < 0:
			continue
		records.append(memory)
	records.sort_custom(func(a, b): return a.receivedAt > b.receivedAt)
	var lines: Array[String] = ["本人近期经历 · 最多3条已收到记录"]
	for memory in records.slice(0, 3):
		var source: String = {"self": "亲历", "witness": "目睹", "heard": "听闻"}.get(memory.get("source"), "来源未知")
		var excerpt: String = memory.text.replace("\n", " ").replace("\r", " ").replace("\t", " ").strip_edges().left(180)
		if memory.text.length() > 180: excerpt += "…"
		lines.append("收到于世界分钟 %s · %s：%s" % [number_label(memory.receivedAt), source, excerpt])
	if records.is_empty(): lines.append("当前快照无可显示记录，不代表没有经历。")
	lines.append("仅为居民收到的记录节选，不是完整记忆、模型思维或事实核验。")
	return "\n".join(lines)
