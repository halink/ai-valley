extends RefCounted
const Agriculture = preload("res://agriculture_observation.gd")

# Observer-only facts. This neither grants residents remote knowledge nor predicts harvests.
static func title(world: Dictionary, plot: Dictionary) -> String:
	for person in world.get("residents", []):
		if person.get("id") == plot.get("ownerId"):
			return str(person.get("name", "未具名居民")).left(24) + "的菜园"
	return "菜园 · 归属未知"

static func stage(world: Dictionary, plot: Dictionary, observed: Dictionary = {}) -> String:
	if observed.get("kind") == "climate": return Agriculture.stage(observed)
	var crop: Variant = plot.get("crop")
	if crop == null: return "空田"
	if not crop is Dictionary: return "作物状态未知"
	if crop.has("mvpCrop"): return "作物状态暂不可用"
	var days: Variant = world.get("definitions", {}).get(crop.get("definition", ""), {}).get("data", {}).get("growthDays")
	var growth: Variant = crop.get("growth")
	if not (days is float or days is int) or not (growth is float or growth is int): return "作物状态未知"
	if not is_finite(float(days)) or not is_finite(float(growth)) or days <= 0 or growth < 0: return "作物状态未知"
	if growth >= days: return "已经成熟 · 等待居民收获"
	return "生长 %s / %s 天" % [str(growth), str(days)]

static func details(world: Dictionary, plot: Dictionary, separate_climate := false, observed: Dictionary = {}) -> String:
	if observed.get("kind") == "climate": return Agriculture.details(observed)
	if plot.get("crop") is Dictionary and plot.crop.has("mvpCrop"): return "作物状态暂不可用"
	var result := stage(world, plot)
	var crop: Variant = plot.get("crop")
	if crop is Dictionary:
		var watered: Variant = crop.get("wateredDay")
		if watered is float or watered is int:
			result += "\n今日已浇水" if watered == floorf(float(world.get("minute", 0)) / 1440.0) else "今日未浇水"
		else: result += "\n浇水记录未知"
		if not separate_climate and world.get("weather") == "rain": result += " · 当前下雨"
	return result
