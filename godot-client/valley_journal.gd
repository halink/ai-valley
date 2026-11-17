extends Control

signal dismissed

const Art = preload("res://valley_interface_style.gd")
const PINE = preload("res://art/journal-pine-v1.png")
const INK := Color("3c3327")
const OCHRE := Color("7a6647")
const SEAL := Color("943f31")
const ROW_HEIGHT := 70
const ROW_GAP := 4

var lettering: Font
var book: Control
var pages: HBoxContainer
var scene_art: TextureRect
var detail_stack: VBoxContainer
var detail_time: Label
var detail_text: Label
var reset_detail: Button
var rows_list: VBoxContainer
var scroll: ScrollContainer
var day_label: Label
var previous_day: Button
var next_day: Button
var close_button: Button
var zero_state: Label
var day_records := {}
var available_days: Array[int] = []
var current_day := -1
var selected_id := ""
var displayed: Array = []
var row_buttons := {}
var row_views: Array[Dictionary] = []
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
	pages = HBoxContainer.new()
	pages.add_theme_constant_override("separation", 54)
	book.add_child(pages)
	pages.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	pages.offset_left = 35
	pages.offset_right = -35
	pages.offset_top = 27
	pages.offset_bottom = -23
	_add_left_page()
	_add_right_page()
	resized.connect(_place_book)
	hide()

func _label(parent: Control, caption: String, size_in_pixels: int, color := INK, serif := false) -> Label:
	var label := Label.new()
	label.text = caption
	label.add_theme_font_size_override("font_size", size_in_pixels)
	label.add_theme_color_override("font_color", color)
	if serif: label.add_theme_font_override("font", lettering)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _heading(parent: Control, caption: String, font_size: int, color := INK) -> Label:
	var title := _label(parent, caption, font_size, color)
	title.add_theme_font_override("font", Art.hand())
	return title

func _line(parent: Control) -> void:
	var stroke := Panel.new()
	stroke.add_theme_stylebox_override("panel", Art.brush(Color(SEAL, .60)))
	stroke.custom_minimum_size = Vector2(62, 3)
	stroke.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	stroke.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(stroke)

func _button(parent: Control, caption: String, help: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = caption
	button.tooltip_text = help
	button.accessibility_name = help
	button.theme_type_variation = "QuietButton"
	button.custom_minimum_size.y = 34
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.pressed.connect(action)
	parent.add_child(button)
	return button

func _page() -> VBoxContainer:
	var page := VBoxContainer.new()
	page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	page.add_theme_constant_override("separation", 13)
	pages.add_child(page)
	return page

func _add_left_page() -> void:
	var page := _page()
	var title := _heading(page, "山居手记", 38)
	title.custom_minimum_size.y = 54
	var navigation := HBoxContainer.new()
	navigation.add_theme_constant_override("separation", 4)
	page.add_child(navigation)
	previous_day = _button(navigation, "‹", "上一个有记录的日期", _turn_day.bind(-1))
	previous_day.custom_minimum_size.x = 34
	day_label = _label(navigation, "", 19, OCHRE, true)
	day_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	day_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	next_day = _button(navigation, "›", "下一个有记录的日期", _turn_day.bind(1))
	next_day.custom_minimum_size.x = 34
	_line(page)
	var margin := Control.new()
	margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	page.add_child(margin)
	scene_art = TextureRect.new()
	scene_art.texture = PINE
	scene_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	scene_art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	scene_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	scene_art.modulate = Color(1, 1, 1, .89)
	margin.add_child(scene_art)
	scene_art.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scene_art.offset_left = 8
	scene_art.offset_right = -4
	scene_art.offset_bottom = -7
	detail_stack = VBoxContainer.new()
	detail_stack.add_theme_constant_override("separation", 11)
	margin.add_child(detail_stack)
	detail_stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var record_header := HBoxContainer.new()
	detail_stack.add_child(record_header)
	var title_for_record := _heading(record_header, "原始记载", 21, SEAL)
	title_for_record.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	reset_detail = _button(record_header, "收起", "关闭原始记载", _pick_row.bind(""))
	detail_time = _label(detail_stack, "", 14, OCHRE)
	var paper_scroll := ScrollContainer.new()
	paper_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	paper_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	detail_stack.add_child(paper_scroll)
	detail_text = _label(paper_scroll, "", 16, INK, true)
	detail_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail_text.add_theme_constant_override("line_spacing", 8)
	detail_stack.hide()

func _add_right_page() -> void:
	var page := _page()
	var header := HBoxContainer.new()
	page.add_child(header)
	var title := _heading(header, "谷中见闻", 28)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	close_button = _button(header, "合上", "合上手记（Esc）", dismiss)
	close_button.custom_minimum_size.x = 34
	_line(page)
	scroll = ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	page.add_child(scroll)
	rows_list = VBoxContainer.new()
	rows_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rows_list.add_theme_constant_override("separation", ROW_GAP)
	scroll.add_child(rows_list)
	zero_state = _label(page, "", 16, OCHRE, true)
	zero_state.size_flags_vertical = Control.SIZE_EXPAND_FILL
	zero_state.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	zero_state.hide()

func _place_book() -> void:
	if book == null: return
	book.size = Vector2(minf(948, size.x - 56), minf(592, size.y - 104))
	book.position = (size - book.size) * 0.5
	book.queue_redraw()

func open() -> void:
	show()
	_place_book()
	_fill_day()
	close_button.grab_focus()

func dismiss() -> void:
	if not visible: return
	hide()
	dismissed.emit()

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if not book.get_rect().has_point(event.position): dismiss()

func present(records: Array[Dictionary], is_connected: bool) -> void:
	var recent_day: int = available_days.back() if not available_days.is_empty() else -1
	var track_latest: bool = current_day == recent_day
	connected = is_connected
	day_records.clear()
	for record in records:
		if not day_records.has(record.day): day_records[record.day] = []
		day_records[record.day].append(record)
	available_days.assign(day_records.keys())
	available_days.sort()
	if available_days.is_empty():
		current_day = -1
	elif track_latest or current_day not in available_days:
		current_day = available_days.back()
	if visible: _fill_day()

func _turn_day(direction: int) -> void:
	var index := available_days.find(current_day) + direction
	if index < 0 or index >= available_days.size(): return
	current_day = available_days[index]
	selected_id = ""
	_fill_day(true)

func _fill_day(reset_scroll := false) -> void:
	var next: Array = day_records.get(current_day, [])
	var index := available_days.find(current_day)
	day_label.text = "第 %d 日" % current_day if current_day > 0 else ("日期未记明" if current_day == 0 else "尚无日期")
	previous_day.disabled = index <= 0
	next_day.disabled = index < 0 or index + 1 >= available_days.size()
	zero_state.visible = next.is_empty()
	zero_state.text = "这页尚未留下记载。" if connected else "等待山谷重新连接。"
	scroll.visible = not next.is_empty()
	if displayed == next and not reset_scroll: return
	var restore := 0
	if scroll.scroll_vertical > 0 and not reset_scroll and not displayed.is_empty():
		var first := mini(floori(float(scroll.scroll_vertical) / (ROW_HEIGHT + ROW_GAP)), displayed.size() - 1)
		var anchor: String = displayed[first].id
		for i in range(next.size()):
			if next[i].id == anchor:
				restore = i * (ROW_HEIGHT + ROW_GAP) + (scroll.scroll_vertical % (ROW_HEIGHT + ROW_GAP))
				break
	row_buttons.clear()
	displayed = next
	while row_views.size() < displayed.size():
		row_views.append(_record_view(row_views.size()))
	for i in range(row_views.size()):
		var view: Dictionary = row_views[i]
		view.button.visible = i < displayed.size()
		if i >= displayed.size(): continue
		var record: Dictionary = displayed[i]
		var label: String = "阅读 " + record.time + " 的原始记载"
		view.button.tooltip_text = label
		view.button.accessibility_name = label
		view.stamp.text = record.time
		view.category.text = record.category
		view.sentence.text = record.line
		row_buttons[record.id] = view.button
	scroll.set_deferred("scroll_vertical", restore)
	_pick_row(selected_id)

func _record_view(index: int) -> Dictionary:
	var row := _button(rows_list, "", "", func():
		if index < displayed.size(): _pick_row(displayed[index].id)
	)
	row.theme_type_variation = "JournalRow"
	row.custom_minimum_size.y = ROW_HEIGHT
	row.toggle_mode = true
	var row_content := HBoxContainer.new()
	row_content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row_content.add_theme_constant_override("separation", 13)
	row.add_child(row_content)
	row_content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row_content.offset_left = 8
	row_content.offset_right = -10
	row_content.offset_top = 7
	row_content.offset_bottom = -5
	var stamp := VBoxContainer.new()
	stamp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stamp.custom_minimum_size.x = 63
	stamp.add_theme_constant_override("separation", 1)
	row_content.add_child(stamp)
	var time := _label(stamp, "", 17, SEAL, true)
	var category := _label(stamp, "", 12, OCHRE)
	var sentence := _label(row_content, "", 17, INK, true)
	sentence.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sentence.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	sentence.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sentence.max_lines_visible = 2
	sentence.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	sentence.add_theme_constant_override("line_spacing", 4)
	return {"button": row, "stamp": time, "category": category, "sentence": sentence}

func _pick_row(id: String) -> void:
	selected_id = ""
	for entry in displayed:
		if entry.id == id:
			selected_id = id
			detail_time.text = entry.time + "  ·  " + entry.category
			detail_text.text = entry.original
			break
	for key in row_buttons:
		row_buttons[key].set_pressed_no_signal(key == selected_id)
	detail_stack.visible = not selected_id.is_empty()
	scene_art.visible = selected_id.is_empty()
