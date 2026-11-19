extends Control

const NOTICE := "离线合成选择，不是真实大模型"
const KEYS := ["springRoot", "fruit", "water", "wood", "meal", "preserve"]
const NAMES := ["春秋芜菁", "鲜果", "水", "木", "餐食", "罐藏"]
var request: HTTPRequest
var address: LineEdit
var status: Label
var content: Label
var selector: OptionButton
var data: Dictionary = {}
var endpoint := ""
var timer: Timer

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var backdrop := ColorRect.new()
	backdrop.color = Color("f0e7d5")
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]: margin.add_theme_constant_override("margin_" + side, 24)
	add_child(margin)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	margin.add_child(column)
	var title := Label.new()
	title.text = NOTICE + "\n预设独立演示，不是当前游戏"
	title.add_theme_color_override("font_color", Color("553927"))
	title.add_theme_font_size_override("font_size", 25)
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(title)
	var row := HBoxContainer.new()
	column.add_child(row)
	address = LineEdit.new()
	address.text = "http://127.0.0.1:3418"
	address.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(address)
	var connect_button := Button.new()
	connect_button.text = "读取独立演示"
	connect_button.pressed.connect(_connect_demo)
	row.add_child(connect_button)
	status = Label.new()
	status.add_theme_color_override("font_color", Color("553927"))
	column.add_child(status)
	selector = OptionButton.new()
	for label in ["已执行：做春秋芜菁餐", "已执行：罐藏鲜果", "已拒绝：非法编号999"]: selector.add_item(label)
	selector.item_selected.connect(func(_index: int): _render())
	column.add_child(selector)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(scroll)
	content = Label.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	content.add_theme_color_override("font_color", Color("302d27"))
	content.add_theme_font_size_override("font_size", 19)
	scroll.add_child(content)
	request = HTTPRequest.new()
	request.timeout = 8
	request.body_size_limit = 65536
	request.request_completed.connect(_received)
	add_child(request)
	timer = Timer.new()
	timer.wait_time = 10
	timer.timeout.connect(_read)
	add_child(timer)
	_clear("未连接独立演示")
	if OS.has_feature("web"):
		address.text = str(JavaScriptBridge.eval("window.location.origin"))
		_connect_demo()

func _clear(message: String) -> void:
	data = {}
	selector.disabled = true
	status.text = message
	content.text = "此页仅比较已结算的预设分支，不提交决定、不推进任何世界。\n没有有效数据，不能视为已执行结果。"

func _connect_demo() -> void:
	request.cancel_request()
	timer.stop()
	_clear("正在读取独立演示…")
	endpoint = address.text.strip_edges().trim_suffix("/")
	if not (endpoint.begins_with("http://") or endpoint.begins_with("https://")) or "@" in endpoint or "?" in endpoint or "#" in endpoint:
		_clear("地址无效：需要独立演示服务的 HTTP(S) 地址")
		return
	timer.start()
	_read()

func _read() -> void:
	if request.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED: return
	if request.request(endpoint + "/ai-town/api/seasonal-model/demo") != OK: _clear("连接失败，旧结果已失效")

static func _number(v: Variant) -> bool:
	return (v is int or v is float) and is_finite(v) and floor(v) == v

static func _stock(v: Variant, negative := false) -> bool:
	if not v is Dictionary or v.size() != KEYS.size(): return false
	for key in KEYS:
		if not _number(v.get(key)) or (not negative and v[key] < 0): return false
	return true

static func valid(v: Variant) -> bool:
	if not v is Dictionary or v.get("schemaVersion") != 1 or v.get("driver") != "synthetic-model-decisions" or v.get("realModelCalls") != 0: return false
	var f: Variant = v.get("fixture")
	if not f is Dictionary or f.get("source") != "generated-fixture" or not f.get("actor") is String or not f.get("initialWorldDigest") is String or f.initialWorldDigest.length() != 64 or not _number(f.get("startMinute")) or not _stock(f.get("stock")): return false
	if not v.get("choices") is Array or v.choices.size() != 2 or not v.get("branches") is Array or v.branches.size() != 3: return false
	for i in range(2):
		var c: Variant = v.choices[i]
		if not c is Dictionary or c.get("id") != ["cook", "preserve"][i] or not c.get("label") is String: return false
		var cost: Variant = c.get("ruleCosts")
		if not cost is Dictionary or cost.get("durationMinutes") != [20,60][i] or not cost.get("items") is Dictionary: return false
		var expected: Dictionary = [{"springRoot":2,"water":1},{"fruit":2,"water":1,"wood":1}][i]
		if cost.items.size() != expected.size(): return false
		for key in expected:
			if cost.items.get(key) != expected[key]: return false
	for i in range(3):
		var b: Variant = v.branches[i]
		if not b is Dictionary or b.get("choiceId") != ["cook","preserve","invalid"][i] or b.get("state") != ["completed","completed","rejected"][i] or b.get("startMinute") != f.startMinute or not _number(b.get("endMinute")) or b.endMinute - b.startMinute != [20,60,0][i]: return false
		if not _stock(b.get("before")) or b.before != f.stock or not _stock(b.get("after")) or not _stock(b.get("changes"),true): return false
		for k in range(KEYS.size()):
			if b.after[KEYS[k]] - b.before[KEYS[k]] != b.changes[KEYS[k]] or b.changes[KEYS[k]] != [[-2,0,-1,0,1,0],[0,-2,-1,-1,0,2],[0,0,0,0,0,0]][i][k]: return false
		var e: Variant = b.get("evidence")
		if not e is Dictionary or e.get("kind") != ["cooked","preserved","choice-rejected"][i] or e.get("minute") != b.endMinute or e.get("quantity") != [1,2,0][i]: return false
		if i == 1 and e.get("expiresAt") != b.endMinute + 56 * 1440: return false
	return true

func _received(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_clear("未连接或数据无效，旧结果已失效")
		return
	var json := JSON.new()
	var parsed := json.parse(body.get_string_from_utf8())
	var value: Variant = json.data
	if parsed != OK or not valid(value):
		_clear("未连接或数据无效，旧结果已失效")
		return
	data = value
	selector.disabled = false
	status.text = "已读取固定回放 · 真实模型调用0次 · 每10秒检查连接"
	_render()

func _render() -> void:
	if data.is_empty(): return
	var b: Dictionary = data.branches[selector.selected]
	var text := "预设厨房已实际花费6木、6石和劳动安装工位；这里展示安装后的共同起点。\n\n共同预设起点：%s，第%d分钟\n起点摘要：%s\n\n合法菜单（原规则成本，不是额外扣费）：\n" % [data.fixture.actor, data.fixture.startMinute, data.fixture.initialWorldDigest]
	text += "① " + data.choices[0].label + "\n② " + data.choices[1].label + "\n"
	text += "\n当前比较：" + selector.get_item_text(selector.selected) + "\n终态：" + ("实际完成" if b.state == "completed" else "拒绝，没有生成行动")
	text += "\n实际游戏时间：%d → %d\n\n库存（前 → 后；净变化）：\n" % [b.startMinute,b.endMinute]
	for i in range(KEYS.size()):
		var key: String = KEYS[i]
		text += "%s：%d → %d（%+d）\n" % [NAMES[i], b.before[key], b.after[key], b.changes[key]]
	if b.choiceId == "preserve": text += "\n实际新增2份罐藏，至第%d分钟到期（56日）。\n" % b.evidence.expiresAt
	text += "\n切换仅比较已结算结果，不会发出行动。\n预设物资不是正常生产积累；不证明模型效果或冬储充足。"
	content.text = text
