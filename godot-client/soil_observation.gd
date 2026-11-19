extends RefCounted
const ClimateView = preload("res://environment_preview.gd")

# Only finite display projections are consumed here. Exact ledger numerators stay
# strings on the server; this observer never recomputes water or changes a plot.
static func from_snapshot(snapshot: Dictionary) -> Dictionary:
	if ClimateView.from_snapshot(snapshot).is_empty(): return {}
	var world: Variant = snapshot.get("world")
	var mode: Variant = snapshot.get("mvp")
	if not world is Dictionary or not mode is Dictionary or mode.get("driver") != "local-rules": return {}
	var climate: Variant = world.get("mvpClimate")
	if world.get("mode") != "validation" or not climate is Dictionary: return {}
	var agriculture: bool = climate.get("schemaVersion") == 3 and climate.get("capability") == "agriculture-v1"
	if not agriculture and (climate.get("schemaVersion") != 2 or climate.get("capability") != "soil-water-v1"): return {}
	var soil: Variant = mode.get("soil")
	if not soil is Dictionary or soil.get("schemaVersion") != (2 if agriculture else 1) or soil.get("denominator") != "1440000000000000": return {}
	if not soil.get("atUs") is String or soil.atUs != climate.get("lastUs") or climate.get("lastMinute") != world.get("minute"): return {}
	if not soil.get("plots") is Array: return {}
	var result := {}
	for plot in soil.plots:
		if not plot is Dictionary or not plot.get("plotId") is String or result.has(plot.plotId): return {}
		for field in ["paw", "snowWater", "initialPaw", "rainIn", "snowIn", "melt", "irrigation", "evaporation", "drainage", "cropUse"]:
			var value: Variant = plot.get(field)
			if not (value is int or value is float) or not is_finite(value) or value < 0: return {}
		if plot.paw > 100 or plot.initialPaw != 50 or (not agriculture and plot.cropUse != 0): return {}
		result[plot.plotId] = plot
	return result

static func details(plot: Dictionary) -> String:
	if plot.is_empty(): return ""
	return "\n土壤有效水 %.3f / 100\n雪水 %.3f\n累计：雨入 %.3f · 雪入 %.3f\n融雪 %.3f · 已灌溉 %.3f\n蒸发 %.3f · 排水 %.3f\n累计作物耗水 %.3f" % [plot.paw, plot.snowWater, plot.rainIn, plot.snowIn, plot.melt, plot.irrigation, plot.evaporation, plot.drainage, plot.cropUse]
