extends Control

signal dismissed

const Art = preload("res://valley_interface_style.gd")
const Journal = preload("res://journal_records.gd")
const Records = preload("res://relationship_records.gd")
const Snapshot = preload("res://snapshot.gd")

class ProseLabel extends Label:
	const CLOSING := "，。、；：？！）》」』】”"
	var original := ""
	var column_width := 0.0

	func _ready() -> void:
		clip_text = true
		resized.connect(_wrap)
		_wrap.call_deferred()

	func _wrap() -> void:
		if size.x < 32.0 or is_equal_approx(size.x, column_width): return
		column_width = size.x
		var font := get_theme_font("font")
		var point := get_theme_font_size("font_size")
		var paragraph := TextParagraph.new()
		paragraph.width = column_width - point
		paragraph.break_flags = TextServer.BREAK_MANDATORY | TextServer.BREAK_WORD_BOUND | TextServer.BREAK_ADAPTIVE
		paragraph.add_string(original, font, point)
		var lines := PackedStringArray()
		for index in range(paragraph.get_line_count()):
			var span := paragraph.get_line_range(index)
			var line := original.substr(span.x, span.y - span.x).strip_edges()
			if not lines.is_empty() and not line.is_empty() and span.x > 0 and original[span.x - 1] != "\n":
				var last := lines.size() - 1
				while not line.is_empty() and line[0] in CLOSING:
					var joined := lines[last] + line[0]
					if font.get_string_size(joined, HORIZONTAL_ALIGNMENT_LEFT, -1, point).x > column_width: break
					lines[last] = joined
					line = line.substr(1)
			lines.append(line)
		text = "\n".join(lines)

var book: Control
var close_button: Button
var pair_body: VBoxContainer
var pair_message: Label
var history_message: Label
var history_scroll: ScrollContainer
var history_list: VBoxContainer
var unknown_note: Label
var partnership: Label
var portraits: Array[Dictionary] = []
var scores: Array[Array] = []
var directions: Array[Label] = []

var world: Dictionary
var history: Variant
var world_id := ""
var people := {}
var options := {}
var picked: Array[String] = ["", ""]
var displayed_pair: Array[String] = []
var displayed_history: Array[Dictionary] = []
var connected := false

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	var veil := ColorRect.new()
	veil.color = Art.VEIL
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(veil)
	veil.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	book = Art.book_cover()
	book.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(book)
	var pages := HBoxContainer.new()
	pages.add_theme_constant_override("separation", 56)
	book.add_child(pages)
	pages.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	pages.offset_left = 38
	pages.offset_right = -35
	pages.offset_top = 27
	pages.offset_bottom = -29
	_build_pair_page(_column(pages, 15))
	_build_history_page(_column(pages, 12))
	resized.connect(_place_book)
	hide()

func _column(parent: Control, spacing: int) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", spacing)
	parent.add_child(column)
	return column

func _label(parent: Control, text: String, size_px: int, color := Art.INK, wrap := false) -> Label:
	var label := Label.new()
	label.text = text
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", size_px)
	label.add_theme_color_override("font_color", color)
	if wrap: label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	parent.add_child(label)
	return label

func _heading(parent: Control, text: String, size_px: int, color := Art.INK) -> Label:
	var label := _label(parent, text, size_px, color)
	label.add_theme_font_override("font", Art.hand())
	return label

func _stroke(parent: Control, width: int, pigment: Color) -> void:
	var mark := Panel.new()
	mark.add_theme_stylebox_override("panel", Art.brush(pigment))
	mark.custom_minimum_size = Vector2(width, 3)
	mark.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(mark)

func _build_pair_page(page: VBoxContainer) -> void:
	_heading(page, "人物往来", 38)
	_stroke(page, 62, Color(Art.CLAY, .60))
	pair_message = _label(page, "", 17, Art.FADED, true)
	pair_body = _column(page, 16)
	var portraits_line := HBoxContainer.new()
	portraits_line.add_theme_constant_override("separation", 8)
	pair_body.add_child(portraits_line)
	portraits.append(_portrait(_column(portraits_line, 3), 0))
	var crossing := _heading(portraits_line, "⇄", 27, Art.CLAY)
	crossing.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	portraits.append(_portrait(_column(portraits_line, 3), 1))
	partnership = _heading(pair_body, "夫妻", 19, Art.CLAY)
	partnership.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	partnership.hide()

	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 12)
	pair_body.add_child(grid)
	_label(grid, "", 16).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for title: String in Records.METRICS.values():
		var mark := _heading(grid, title, 19, Art.FADED)
		mark.custom_minimum_size.x = 57
		mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	for index in range(2):
		var direction := _heading(grid, "", 19, Art.CLAY if index == 0 else Art.MOSS)
		direction.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		direction.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		directions.append(direction)
		var row := []
		for _key: String in Records.METRICS:
			var score := _label(grid, "", 27)
			score.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			row.append(score)
		scores.append(row)
	unknown_note = _label(pair_body, "— 表示尚无记载", 14, Art.FADED)

func _portrait(column: VBoxContainer, side: int) -> Dictionary:
	var frame := Control.new()
	frame.custom_minimum_size = Vector2(0, 133)
	column.add_child(frame)
	var image := TextureRect.new()
	image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(image)
	image.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var initial := _heading(frame, "", 58, Art.CLAY if side == 0 else Art.MOSS)
	initial.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	initial.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	initial.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var name_label := _heading(column, "", 25)
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	var choices := OptionButton.new()
	choices.fit_to_longest_item = false
	choices.custom_minimum_size.y = 34
	choices.alignment = HORIZONTAL_ALIGNMENT_CENTER
	choices.accessibility_name = "选择左页人物" if side == 0 else "选择右侧人物"
	choices.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	choices.item_selected.connect(_pick.bind(side))
	column.add_child(choices)
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		choices.add_theme_stylebox_override(state, get_theme_stylebox(state, "QuietButton"))
	choices.add_theme_font_override("font", Art.hand())
	choices.add_theme_font_size_override("font_size", 23)
	var popup := choices.get_popup()
	popup.add_theme_stylebox_override("panel", Art.leaf(Vector4(10, 7, 10, 7)))
	popup.add_theme_color_override("font_color", Art.INK)
	popup.add_theme_color_override("font_hover_color", Art.CLAY)
	popup.add_theme_stylebox_override("hover", Art.brush(Color(Art.CLAY, .15)))
	return {"image": image, "initial": initial, "name": name_label, "choices": choices}

func _build_history_page(page: VBoxContainer) -> void:
	var header := HBoxContainer.new()
	page.add_child(header)
	_heading(header, "关系变迁", 29).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	close_button = Button.new()
	close_button.text = "合上"
	close_button.tooltip_text = "合上人物往来（Esc）"
	close_button.accessibility_name = close_button.tooltip_text
	close_button.theme_type_variation = "QuietButton"
	close_button.custom_minimum_size.y = 39
	close_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close_button.pressed.connect(dismiss)
	header.add_child(close_button)
	_stroke(page, 49, Color(Art.MOSS, .50))
	history_message = _label(page, "", 17, Art.FADED, true)
	history_scroll = ScrollContainer.new()
	history_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	history_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	history_scroll.follow_focus = true
	page.add_child(history_scroll)
	history_list = _column(history_scroll, 15)

func _place_book() -> void:
	book.size = Vector2(minf(972, size.x - 58), minf(576, size.y - 100))
	book.position = (size - book.size) * .5
	book.queue_redraw()

func open(person_id := "") -> void:
	if people.has(person_id):
		if picked[1] == person_id: picked[1] = picked[0]
		picked[0] = person_id
		for id: String in people:
			if _partnership(person_id, id) == "married":
				picked[1] = id
				break
	show()
	_place_book()
	_refresh()
	close_button.grab_focus()

func dismiss() -> void:
	if not visible: return
	hide()
	dismissed.emit()

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if not book.get_rect().has_point(event.position): dismiss()

func present(next_world: Dictionary, next_history: Variant, online: bool) -> void:
	var id: String = next_world.get("id", "")
	if id != world_id:
		world_id = id
		picked.assign(["", ""])
		displayed_pair.clear()
	connected = online
	world = next_world if online else {}
	history = next_history if online else null
	people = {}
	for person in world.get("residents", []):
		people[person.id] = person
	if visible: _refresh()

func _refresh() -> void:
	var ready := connected and people.size() >= 2
	pair_body.visible = ready
	pair_message.visible = not ready
	pair_message.text = "谷中尚未记下两位居民。" if connected else "等待山谷重新连接。"
	if not ready:
		history_scroll.hide()
		history_message.hide()
		return
	var ids := people.keys()
	if not people.has(picked[0]): picked[0] = ids[0]
	if not people.has(picked[1]) or picked[1] == picked[0]:
		picked[1] = ids[0] if ids[0] != picked[0] else ids[1]
	var names := {}
	for id: String in ids:
		names[id] = Snapshot.resident_name(people[id])
	var pair_changed := displayed_pair != picked
	var names_changed := options != names
	_update_options(names)
	var option_ids := options.keys()
	var unknown := false
	for index in range(2):
		var who: String = picked[index]
		var toward: String = picked[1 - index]
		var portrait := portraits[index]
		var picture := Art.portrait(who)
		portrait.image.texture = picture
		portrait.initial.visible = picture == null
		portrait.initial.text = names[who].left(1)
		portrait.name.text = names[who]
		portrait.choices.visible = ids.size() > 2
		portrait.name.visible = not portrait.choices.visible
		portrait.choices.select(option_ids.find(who))
		directions[index].text = names[who] + " → " + names[toward]
		directions[index].tooltip_text = directions[index].text
		var tie := Records.relation(people[who], toward)
		var column := 0
		for metric: String in Records.METRICS:
			var score_text := Records.score(tie.get(metric), 0 if metric == "conflict" else -100)
			scores[index][column].text = score_text
			scores[index][column].add_theme_color_override("font_color", Art.FADED if score_text in ["0", "—"] else Art.INK)
			unknown = unknown or score_text == "—"
			column += 1
	unknown_note.visible = unknown
	partnership.visible = _partnership(picked[0], picked[1]) == "married"
	displayed_pair = picked.duplicate()
	_show_history(Records.timeline(world, history, people[picked[0]], people[picked[1]]), names, pair_changed, names_changed)

func _partnership(left: String, right: String) -> String:
	if left == right or not people.has(left) or not people.has(right): return ""
	var bond: String = Records.relation(people[left], right).get("partner", "")
	return bond if bond == Records.relation(people[right], left).get("partner") else ""

func _update_options(names: Dictionary) -> void:
	if names == options: return
	options = names
	for portrait in portraits:
		var choices: OptionButton = portrait.choices
		choices.clear()
		for id: String in names:
			choices.add_item(names[id])
			choices.set_item_metadata(choices.item_count - 1, id)

func _pick(index: int, side: int) -> void:
	var button: OptionButton = portraits[side].choices
	var next: String = button.get_item_metadata(index)
	if next == picked[1 - side]: picked[1 - side] = picked[side]
	picked[side] = next
	_refresh()

func _show_history(records: Array[Dictionary], names: Dictionary, reset_scroll: bool, names_changed: bool) -> void:
	history_message.visible = records.is_empty()
	history_message.text = "两人还没有留下关系变化的记载。"
	history_scroll.visible = not records.is_empty()
	if records == displayed_history and not reset_scroll and not names_changed: return
	var previous_scroll := 0 if reset_scroll else history_scroll.scroll_vertical
	for section in history_list.get_children():
		history_list.remove_child(section)
		section.queue_free()
	displayed_history = records
	for record in records:
		_add_record(record, names)
	history_scroll.set_deferred("scroll_vertical", previous_scroll)

func _add_record(record: Dictionary, names: Dictionary) -> void:
	var section := _column(history_list, 6)
	var header := HBoxContainer.new()
	section.add_child(header)
	var author: String = names[record.from]
	var pigment := Art.CLAY if record.from == picked[0] else Art.MOSS
	var direction := _heading(header, author + " → " + names[record.to], 22, pigment)
	direction.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	direction.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_label(header, _moment(record.at), 14, Art.FADED).vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var change_ink := Art.FADED if record.change.is_empty() else Art.INK
	_label(section, _change_label(record.change), 15, change_ink, true)
	var source: String = {"self": "亲历", "witness": "目睹", "heard": "听闻"}.get(record.source, "")
	var cause_label := "缘由"
	if not source.is_empty(): cause_label += " · " + source
	if record.source_at >= 0: cause_label += " · " + _moment(record.source_at)
	_label(section, cause_label, 14, Art.FADED, true)
	var cause: String = record.origin if not record.origin.is_empty() else "原始经历暂不可查"
	_add_prose(section, cause)
	if not record.note.is_empty():
		_label(section, author + "的看法", 14, Art.FADED, true)
		_add_prose(section, record.note)
	_stroke(section, 35, Color(Art.CLAY, .30))

func _add_prose(parent: Control, text: String) -> void:
	var label := ProseLabel.new()
	label.original = text
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", 16)
	parent.add_child(label)

func _moment(minute: float) -> String:
	var stamp := Journal.world_time(minute)
	return "第 %d 日  %s" % [stamp.day, stamp.clock] if stamp.day > 0 else "时间未记明"

func _change_label(change: Dictionary) -> String:
	if change.is_empty(): return "旧记载未保留变动数值"
	var marks := PackedStringArray()
	for key: String in Records.METRICS:
		if change[key] != 0: marks.append(Records.METRICS[key] + " " + Records.signed(change[key]))
	return "分值无变化" if marks.is_empty() else "　".join(marks)
