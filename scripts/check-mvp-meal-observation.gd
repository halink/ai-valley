extends SceneTree

const Meal = preload("res://meal_observation.gd")

func _init() -> void:
	var cooked := {"schemaVersion":1, "kind":"cooked", "cultivar":"spring", "roots":2, "water":1, "meal":1, "at":990.5}
	var ate := {"schemaVersion":1, "kind":"ate", "meal":1, "at":1000}
	var row := {"schemaVersion":1, "atMinute":1000, "residents":{"lin":{"cooked":cooked, "ate":ate}}}
	var label := Meal.details(row, "lin", 1000)
	assert(label.contains("2份春秋芜菁＋1份清水 → 1份餐食"))
	assert(label.contains("990.5") and label.contains("本人吃下1份餐食"))
	assert(label.contains("两条记录独立") and label.contains("旧记录或超出范围可能不显示"))
	assert(not Meal.details(row, "qiao", 1000).contains("春秋芜菁"))
	assert(not Meal.details(row, "lin", 1001).contains("本人吃下"))
	assert(not Meal.details(row, "lin", INF).contains("本人吃下"))
	assert(Meal.details(null, "lin", 1000).contains("暂无餐食记录"))
	cooked.roots = 500
	assert(not Meal.details(row, "lin", 1000).contains("芜菁"))
	assert(Meal.details(row, "lin", 1000).contains("本人吃下1份餐食"))
	ate.schemaVersion = 99
	assert(not Meal.details(row, "lin", 1000).contains("本人吃下"))
	ate.schemaVersion = 1
	ate.at = 1001
	assert(not Meal.details(row, "lin", 1000).contains("本人吃下"))
	row.schemaVersion = 99
	assert(Meal.details(row, "lin", 1000).contains("暂无餐食记录"))
	print("meal labels: separate facts, legacy, malformed, future and stale")
	quit()
