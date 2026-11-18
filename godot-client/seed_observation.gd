extends RefCounted

# Read-only current snapshot facts, never a resident instruction or stock grant.
static func state(world: Dictionary) -> Dictionary:
	var seeds: Variant = world.get("mvpSeeds")
	if not seeds is Dictionary or seeds.get("version") != 1: return {}
	var stock: Variant = seeds.get("stock")
	if not (stock is int or stock is float) or not is_finite(float(stock)) or stock < 0 or floorf(stock) != stock: return {}
	return seeds

static func stock_label(world: Dictionary) -> String:
	var seeds := state(world)
	if seeds.is_empty(): return "种源记录未知"
	return "种源已领完" if seeds.stock == 0 else "种源余量 %s 份" % int(seeds.stock)

static func details(world: Dictionary) -> String:
	var result := stock_label(world)
	var seeds := state(world)
	if seeds.is_empty(): return result
	var claims: Variant = seeds.get("claimed")
	if claims is Dictionary:
		var entries: PackedStringArray = []
		for person in world.get("residents", []):
			var value: Variant = claims.get(person.get("id"), 0)
			if (value is int or value is float) and is_finite(float(value)) and value >= 0 and floorf(value) == value:
				entries.append("%s %s份" % [str(person.get("name", "居民")).left(12), int(value)])
		result += "\n累计领种：" + " · ".join(entries)
	var saved: Variant = seeds.get("saved")
	if saved is Dictionary:
		var total := 0
		for value in saved.values():
			if (value is int or value is float) and is_finite(float(value)) and value >= 0 and floorf(value) == value: total += int(value)
		result += "\n已完成留种 %s 次" % total
	result += "\n到场领种；有限种源不会刷新\n留种：1份芜菁 → 2份种子\n领种、留种均在室内种台完成"
	return result
