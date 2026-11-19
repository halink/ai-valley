extends RefCounted
const ClimateView = preload("res://environment_preview.gd")
const REASONS := {"empty":"尚未播种", "legacy":"生长中", "mature":"成熟可收获", "temperature":"温度限制生长", "water":"土壤水分限制生长", "temperature-and-water":"温度与水分共同限制", "none":"当前温水条件适宜"}

static func from_snapshot(snapshot: Dictionary) -> Dictionary:
	if ClimateView.from_snapshot(snapshot).is_empty(): return {}
	var world: Dictionary = snapshot.world
	var climate: Dictionary = world.get("mvpClimate", {})
	if climate.get("schemaVersion") != 3 or climate.get("capability") != "agriculture-v1": return {}
	var value: Variant = snapshot.mvp.get("agriculture")
	if not value is Dictionary or value.get("schemaVersion") != 1 or value.get("atUs") != climate.get("lastUs"): return {}
	if not value.get("plots") is Array or not value.get("seedStock") is Array: return {}
	var plots := {}
	for plot in value.plots:
		if not plot is Dictionary or not plot.get("plotId") is String or plots.has(plot.plotId): return {}
		if plot.get("kind") not in ["empty", "legacy", "climate"] or plot.get("limitedBy") not in REASONS: return {}
		if not plot.get("mature") is bool: return {}
		for field in ["growthDays", "targetDays", "progressPermille", "temperatureFactorPermille", "waterFactorPermille"]:
			var number: Variant = plot.get(field)
			if not (number is int or number is float) or not is_finite(number) or number < 0: return {}
		for field in ["progressPermille", "temperatureFactorPermille", "waterFactorPermille"]:
			if plot[field] > 1000 or floor(plot[field]) != plot[field]: return {}
		if plot.kind == "climate":
			if plot.get("cultivar") not in ["spring", "summer", "winter"] or not plot.get("instanceId") is String or not plot.get("name") is String or plot.targetDays <= 0: return {}
		plots[plot.plotId] = plot
	var cultivars := {}
	for seed in value.seedStock:
		if not seed is Dictionary or seed.get("cultivar") not in ["spring", "summer", "winter"] or cultivars.has(seed.cultivar): return {}
		if not seed.get("name") is String or not seed.get("canSow") is bool: return {}
		for field in ["initial", "stock"]:
			var number: Variant = seed.get(field)
			if not (number is int or number is float) or not is_finite(number) or number < 0 or floor(number) != number: return {}
		cultivars[seed.cultivar] = true
	return {"plots":plots,"seedStock":value.seedStock}

static func stage(plot: Dictionary) -> String:
	return "%s · %s" % [plot.name, "成熟可收获" if plot.mature else "生长 %.1f%%" % (plot.progressPermille / 10.0)]

static func details(plot: Dictionary) -> String:
	return stage(plot) + "\n生长 %.3f / %.3f 天\n%s" % [plot.growthDays, plot.targetDays, REASONS[plot.limitedBy]]

static func seeds(value: Dictionary) -> String:
	if value.is_empty(): return "三季公共种源观测暂缺"
	var lines: PackedStringArray = ["三季公共种源（实际余量）"]
	for seed in value.seedStock:
		lines.append("%s %s 份 · %s" % [seed.name, str(seed.stock), "当季可播" if seed.canSow else "当前不可播"])
	return "\n".join(lines)
