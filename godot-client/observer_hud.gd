extends CanvasLayer

signal overview_requested
signal resident_requested(id: String)
signal residence_requested
signal building_requested(id: String)
signal doorway_requested(id: String)
signal outside_requested
signal locate_requested
signal follow_changed(enabled: bool)
signal zoom_requested(factor: float)
signal reconnect_requested(origin: String)
signal place_labels_changed(enabled: bool)

const Art = preload("res://valley_interface_style.gd")
const ValleyJournal = preload("res://valley_journal.gd")
const ValleyRelationships = preload("res://valley_relationships.gd")
const EnvironmentPreview = preload("res://environment_preview.gd")
const Snapshot = preload("res://snapshot.gd")

# Place-register category sketches, in the palette of the scene meshes.
class RoofSketch extends Control:
	var kind := ""

	func _draw() -> void:
		var at := Vector2((size.x - 64.0) * .5, (size.y - 50.0) * .5)
		# Resource sketches identify a category, never current stock or availability.
		if kind == "bush":
			_shape(at, [Vector2(7,40),Vector2(30,34),Vector2(58,40),Vector2(36,47)], Color(.26,.21,.13,.16))
			draw_line(at + Vector2(32,42), at + Vector2(30,24), Color("78634b"), 4, true)
			_shape(at, [Vector2(8,33),Vector2(5,24),Vector2(14,15),Vector2(24,16),Vector2(31,6),Vector2(42,12),Vector2(43,19),Vector2(54,19),Vector2(59,30),Vector2(48,40),Vector2(24,39)], Color("697953"))
			_shape(at, [Vector2(10,25),Vector2(17,17),Vector2(25,20),Vector2(33,10),Vector2(39,16),Vector2(33,26),Vector2(20,32)], Color("879066"))
			for berry in [Vector2(20,25), Vector2(36,29), Vector2(45,22)]:
				draw_circle(at + berry, 3.2, Color("935b53"), true, -1, true)
				draw_circle(at + berry + Vector2(-.7,-.8), .8, Color("c59a80"), true, -1, true)
			return
		if kind == "spring":
			_shape(at, [Vector2(4,31),Vector2(16,18),Vector2(40,15),Vector2(60,26),Vector2(57,38),Vector2(34,46),Vector2(11,41)], Color("88877a"))
			_shape(at, [Vector2(10,30),Vector2(22,23),Vector2(43,21),Vector2(53,28),Vector2(48,36),Vector2(30,40),Vector2(15,36)], Color("759994"))
			_shape(at, [Vector2(5,27),Vector2(11,16),Vector2(20,17),Vector2(24,25),Vector2(14,29)], Color("b0aa95"))
			_shape(at, [Vector2(41,18),Vector2(47,12),Vector2(56,17),Vector2(58,26),Vector2(48,25)], Color("a19e8b"))
			draw_line(at + Vector2(22,29), at + Vector2(40,27), Color("cad2bc"), 1.5, true)
			draw_line(at + Vector2(28,35), at + Vector2(43,32), Color("b3c6b6"), 1.5, true)
			return
		if kind == "garden":
			# A place-register sketch, not a claim about this plot's crop state.
			_shape(at, [Vector2(3,30),Vector2(33,13),Vector2(62,28),Vector2(32,47)], Color("947359"))
			_shape(at, [Vector2(3,30),Vector2(32,47),Vector2(62,28),Vector2(61,33),Vector2(32,51),Vector2(4,35)], Color("6f5744"))
			for offset in [Vector2(19,29), Vector2(32,22), Vector2(33,36), Vector2(47,28)]:
				draw_line(at + offset, at + offset + Vector2(0,-9), Color("5e7250"), 2, true)
				_shape(at + offset, [Vector2(0,-5),Vector2(-8,-11),Vector2(-6,-4),Vector2(0,-2)], Color("78855c"))
				_shape(at + offset, [Vector2(0,-5),Vector2(6,-13),Vector2(9,-9),Vector2(0,-2)], Color("596e50"))
			return
		var tile := Color("6c6b60") if kind == "lodge" else Color("6c795e")
		if kind in ["store", "workshop", "barn"]: tile = Color("9b735d")
		_shape(at, [Vector2(4,41), Vector2(34,46), Vector2(62,33), Vector2(61,39), Vector2(33,50), Vector2(5,45)], Color(.26,.21,.13,.16))
		_shape(at, [Vector2(10,24),Vector2(36,21),Vector2(37,43),Vector2(10,37)], Color("d2bb96"))
		_shape(at, [Vector2(36,21),Vector2(56,15),Vector2(55,31),Vector2(37,43)], Color("a28d6e"))
		_shape(at, [Vector2(5,23),Vector2(24,10),Vector2(45,9),Vector2(40,29)], tile)
		_shape(at, [Vector2(24,10),Vector2(44,4),Vector2(62,17),Vector2(40,29)], tile.darkened(.18))
		draw_line(at + Vector2(5, 24), at + Vector2(40, 30), Color("79634b"), 2, true)
		draw_line(at + Vector2(24, 10), at + Vector2(44, 4), tile.lightened(.18), 2, true)
		draw_line(at + Vector2(25, 28), at + Vector2(25, 40), Color("685340"), 4 if kind == "lodge" else 3, true)
		draw_line(at + Vector2(36, 30), at + Vector2(37, 44), Color("725b43"), 2, true)

	func _shape(origin: Vector2, points: Array[Vector2], color: Color) -> void:
		var path := PackedVector2Array()
		for point in points: path.append(point + origin)
		draw_colored_polygon(path, color)

var root: Control
var environment_plate: PanelContainer
var environment_view: EnvironmentPreview
var brand: VBoxContainer
var clock_label: Label
var dock: HBoxContainer
var lens: HBoxContainer
var tools: HBoxContainer
var source_plate: PanelContainer
var source_label: Label
var settings_button: Button
var feedback: PanelContainer
var feedback_label: Label
var crumb: PanelContainer
var crumb_title: Label
var crumb_caption: Label
var drawer: PanelContainer
var drawer_title: Label
var directory_back: Button
var scroll: ScrollContainer
var panes := {}
var dock_buttons := {}
var spirit_text: Label
var people_list: VBoxContainer
var places_list: VBoxContainer
var journal: ValleyJournal
var relationships: ValleyRelationships
var relation_entry: Button
var residence_entry: Button
var relation_opener: Button
var mode_label: Label
var run_label: Label
var summary_label: Label
var diagnostics_label: Label
var endpoint: LineEdit
var resident_portrait: Dictionary
var resident_title: Label
var resident_location: Label
var resident_action: Label
var resident_detail: Label
var detail_body: VBoxContainer
var detail_button: Button
var locate_button: Button
var follow_button: Button
var place_card: PanelContainer
var place_name: Label
var place_note: Label
var entry_button: Button
var connector: Line2D
var door_marker: Polygon2D
var hover_card: PanelContainer
var hover_label: Label
var event_strip: PanelContainer
var recent_label: Label
var fade: ColorRect
var fade_tween: Tween

var active_pane := ""
var resident_id := ""
var room_open := false
var place_id := ""
var place_anchor := Vector2.ZERO
var place_anchor_visible := false
var place_side := 0
var people_rows := {}
var places_rows := {}
var layout_queued := false

func _ready() -> void:
	layer = 2
	root = Control.new()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.theme = Art.theme()
	add_child(root)
	fade = ColorRect.new()
	fade.color = Color(Art.CREAM, 0)
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(fade)
	fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_build_navigation()
	_build_drawer()
	_build_scene_cards()
	journal = ValleyJournal.new()
	journal.lettering = Art.prose()
	root.add_child(journal)
	journal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	journal.dismissed.connect(func():
		dock_buttons.events.set_pressed_no_signal(false)
		dock_buttons.events.grab_focus()
	)
	relationships = ValleyRelationships.new()
	root.add_child(relationships)
	relationships.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	relationships.dismissed.connect(func():
		dock_buttons.relations.set_pressed_no_signal(false)
		if is_instance_valid(relation_opener) and relation_opener.is_visible_in_tree():
			relation_opener.grab_focus()
	)
	root.resized.connect(_queue_layout)
	_queue_layout()

func _panel(style: StyleBox) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.mouse_force_pass_scroll_events = false
	panel.add_theme_stylebox_override("panel", style)
	root.add_child(panel)
	return panel

func _label(parent: Control, value: String, font_size := 15, color := Art.INK, wrap := false) -> Label:
	var label := Label.new()
	label.text = value
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if wrap: label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	parent.add_child(label)
	return label

func _heading(parent: Control, value: String, font_size: int, color := Art.INK) -> Label:
	var title := _label(parent, value, font_size, color)
	title.add_theme_font_override("font", Art.hand())
	return title

func _button(parent: Control, value: String, callback: Callable, kind := "QuietButton", font_size := 17) -> Button:
	var button := Button.new()
	button.text = value
	button.theme_type_variation = kind
	button.add_theme_font_size_override("font_size", font_size)
	button.custom_minimum_size.y = 40
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.pressed.connect(callback)
	parent.add_child(button)
	return button

func _brush_rule(parent: Control, color := Art.CLAY, width := 65.0) -> void:
	var rule := Panel.new()
	rule.add_theme_stylebox_override("panel", Art.brush(Color(color, .60)))
	rule.custom_minimum_size = Vector2(width, 3)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(rule)

func _build_navigation() -> void:
	brand = VBoxContainer.new()
	brand.add_theme_constant_override("separation", 2)
	brand.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(brand)
	var wordmark := _heading(brand, "栖谷", 43)
	_brush_rule(brand, Art.CLAY, 29)
	clock_label = _label(brand, "等待世界时间", 16, Art.INK)
	for ink in [wordmark, clock_label]:
		ink.add_theme_color_override("font_outline_color", Color(Art.CREAM, .82))
		ink.add_theme_constant_override("outline_size", 2)

	environment_plate = _panel(Art.leaf(Vector4(10, 8, 12, 8)))
	environment_plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
	environment_view = EnvironmentPreview.new()
	environment_plate.add_child(environment_view)
	environment_plate.visible = false

	dock = HBoxContainer.new()
	dock.add_theme_constant_override("separation", 5)
	root.add_child(dock)
	var overview := _button(dock, "全景", func(): overview_requested.emit(), "WoodButton", 20)
	overview.custom_minimum_size = Vector2(81, 44)
	overview.tooltip_text = "回到山谷全景"
	for item in [["people", "居民"], ["relations", "往来"], ["places", "场所"], ["events", "手记"], ["spirit", "谷灵"]]:
		var key: String = item[0]
		var button := _button(dock, item[1], _toggle_pane.bind(key), "WoodButton", 20)
		button.custom_minimum_size = overview.custom_minimum_size
		button.toggle_mode = true
		dock_buttons[key] = button
	dock_buttons.relations.tooltip_text = "查看人物关系"
	dock_buttons.relations.accessibility_name = "人物往来"

	lens = HBoxContainer.new()
	lens.add_theme_constant_override("separation", 3)
	root.add_child(lens)
	for spec in [["−", "缩小", 1.18], ["＋", "放大", .85]]:
		var control := _button(lens, spec[0], func(): zoom_requested.emit(spec[2]), "WoodButton", 15)
		control.custom_minimum_size = Vector2(34, 35)
		control.tooltip_text = spec[1]
		control.accessibility_name = spec[1]

	tools = HBoxContainer.new()
	tools.add_theme_constant_override("separation", 13)
	root.add_child(tools)
	source_plate = PanelContainer.new()
	source_plate.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	source_plate.add_theme_stylebox_override("panel", Art.brush(Color("e7d6b3"), Vector2(9, 3)))
	tools.add_child(source_plate)
	source_label = _heading(source_plate, "", 15, Art.CLAY)
	source_plate.hide()
	settings_button = _button(tools, "设置", _toggle_pane.bind("settings"), "WoodButton", 18)
	settings_button.custom_minimum_size = Vector2(77, 38)
	settings_button.toggle_mode = true

	feedback = _panel(Art.leaf(Vector4(15, 7, 16, 8)))
	feedback_label = _heading(feedback, "", 16, Art.CLAY)
	feedback.hide()

	crumb = _panel(Art.cedar(Vector4(9, 3, 17, 4)))
	var crumb_row := HBoxContainer.new()
	crumb.add_child(crumb_row)
	_button(crumb_row, "出屋", func(): outside_requested.emit(), "LightButton", 16).tooltip_text = "返回山谷（Esc）"
	crumb_title = _heading(crumb_row, "", 21, Art.CREAM)
	crumb_caption = _label(crumb_row, "", 14, Art.CREAM)
	crumb.hide()

	event_strip = _panel(Art.leaf(Vector4(7, 4, 12, 6)))
	var story := _button(event_strip, "", _toggle_pane.bind("events"), "QuietButton")
	story.tooltip_text = "翻阅山居手记"
	var annotation := HBoxContainer.new()
	annotation.mouse_filter = Control.MOUSE_FILTER_IGNORE
	story.add_child(annotation)
	annotation.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	annotation.offset_left = 7
	annotation.offset_right = -6
	_heading(annotation, "记", 18, Art.CLAY)
	recent_label = _label(annotation, "", 14, Art.INK)
	recent_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	recent_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	event_strip.hide()

func _build_drawer() -> void:
	drawer = _panel(Art.folio())
	drawer.custom_minimum_size.x = 348
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 10)
	drawer.add_child(stack)
	var header := HBoxContainer.new()
	stack.add_child(header)
	drawer_title = _heading(header, "", 29)
	drawer_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	drawer_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	directory_back = _button(header, "‹ 名录", _toggle_pane.bind("people"), "QuietButton", 16)
	header.move_child(directory_back, 0)
	_button(header, "合上", close_drawer, "QuietButton", 16).tooltip_text = "合上册页"
	_brush_rule(stack)
	scroll = ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.mouse_force_pass_scroll_events = false
	stack.add_child(scroll)
	var contents := VBoxContainer.new()
	contents.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(contents)
	for pane in ["resident", "people", "places", "settings", "spirit"]:
		var content := VBoxContainer.new()
		contents.add_child(content)
		content.hide()
		content.minimum_size_changed.connect(_queue_layout)
		panes[pane] = content
	_build_resident_pane(panes.resident)
	people_list = panes.people
	places_list = panes.places
	_label(people_list, "暂无居民记录", 15, Art.FADED)
	_label(places_list, "暂无场所记录", 15, Art.FADED)
	_build_settings(panes.settings)
	spirit_text = _label(panes.spirit, "谷灵记录尚未连接", 15, Art.INK)
	spirit_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	spirit_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	drawer.hide()

func _build_resident_pane(pane: VBoxContainer) -> void:
	pane.add_theme_constant_override("separation", 12)
	var identity := HBoxContainer.new()
	identity.add_theme_constant_override("separation", 15)
	pane.add_child(identity)
	resident_portrait = _portrait(identity, Vector2(112, 115))
	var names := VBoxContainer.new()
	names.alignment = BoxContainer.ALIGNMENT_CENTER
	names.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	names.add_theme_constant_override("separation", 5)
	identity.add_child(names)
	resident_title = _heading(names, "", 28)
	resident_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	resident_location = _label(names, "", 15, Art.FADED, true)
	resident_action = _label(pane, "", 16, Art.MOSS, true)
	var actions := HBoxContainer.new()
	pane.add_child(actions)
	locate_button = _button(actions, "定位", func(): locate_requested.emit(), "WoodButton")
	locate_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	follow_button = _button(actions, "跟随", func(): follow_changed.emit(follow_button.button_pressed), "PaperButton")
	follow_button.toggle_mode = true
	follow_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_brush_rule(pane, Art.MOSS, 47)
	residence_entry = _button(pane, "", func(): residence_requested.emit())
	residence_entry.alignment = HORIZONTAL_ALIGNMENT_LEFT
	residence_entry.hide()
	relation_entry = _button(pane, "人物往来  ›", func(): _open_relations(relation_entry, resident_id))
	relation_entry.alignment = HORIZONTAL_ALIGNMENT_LEFT
	detail_button = _button(pane, "随身物品与经历  ＋", _toggle_resident_detail)
	detail_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	detail_body = VBoxContainer.new()
	pane.add_child(detail_body)
	resident_detail = _label(detail_body, "", 15, Art.INK, true)
	detail_body.hide()

func _build_settings(pane: VBoxContainer) -> void:
	mode_label = _label(pane, "", 16, Art.INK, true)
	run_label = _label(pane, "", 15, Art.FADED, true)
	summary_label = _label(pane, "", 14, Art.FADED, true)
	diagnostics_label = _label(pane, "", 14, Art.FADED, true)
	_brush_rule(pane, Art.MOSS, 46)
	var labels := Button.new()
	labels.theme_type_variation = "PaperButton"
	labels.text = "资源与菜园标记　已隐藏"
	labels.custom_minimum_size.y = 42
	labels.toggle_mode = true
	labels.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	labels.toggled.connect(func(on: bool):
		labels.text = "资源与菜园标记　" + ("已显示" if on else "已隐藏")
		place_labels_changed.emit(on)
	)
	pane.add_child(labels)
	_label(pane, "拖动平移，滚轮缩放。\n点地图上的人物或建筑查看。\nEsc 返回室外或合上册页。", 14, Art.FADED, true)
	endpoint = LineEdit.new()
	endpoint.text = "http://127.0.0.1:3414"
	if OS.has_feature("web"): endpoint.hide()
	pane.add_child(endpoint)
	_button(pane, "重新连接", func(): reconnect_requested.emit(endpoint.text), "WoodButton")

func _build_scene_cards() -> void:
	connector = Line2D.new()
	connector.width = 1.4
	connector.antialiased = true
	connector.default_color = Color("7d6244")
	root.add_child(connector)
	door_marker = Polygon2D.new()
	door_marker.color = Art.CLAY
	door_marker.polygon = PackedVector2Array([Vector2(0,-4),Vector2(4,0),Vector2(0,4),Vector2(-4,0)])
	root.add_child(door_marker)
	place_card = _panel(Art.cedar(Vector4(13, 7, 13, 10)))
	place_card.custom_minimum_size.x = 210
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 5)
	place_card.add_child(content)
	var header := HBoxContainer.new()
	content.add_child(header)
	place_name = _heading(header, "", 23, Art.CREAM)
	place_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	place_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var close := _button(header, "收", func(): building_requested.emit(""), "LightButton", 15)
	close.tooltip_text = "收起场所信息"
	close.accessibility_name = "收起场所信息"
	close.custom_minimum_size = Vector2(34, 34)
	place_note = _label(content, "", 14, Art.CREAM, true)
	entry_button = _button(content, "进入室内", func(): doorway_requested.emit(place_id), "PaperButton", 17)
	place_card.hide()
	place_card.minimum_size_changed.connect(_queue_layout)
	connector.hide()
	door_marker.hide()

	hover_card = _panel(Art.leaf(Vector4(9, 5, 10, 6)))
	hover_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hover_label = _heading(hover_card, "", 15)
	hover_card.hide()

func _portrait(parent: Control, footprint: Vector2) -> Dictionary:
	var frame := Control.new()
	frame.custom_minimum_size = footprint
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(frame)
	var illustration := TextureRect.new()
	illustration.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	illustration.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	illustration.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(illustration)
	illustration.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var name_stamp := PanelContainer.new()
	name_stamp.add_theme_stylebox_override("panel", Art.brush(Color(Art.CLAY, .18)))
	name_stamp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(name_stamp)
	name_stamp.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	name_stamp.offset_left = 9
	name_stamp.offset_right = -9
	name_stamp.offset_top = 9
	name_stamp.offset_bottom = -9
	var initial := _heading(name_stamp, "", 27, Art.CLAY)
	initial.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	initial.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return {"image": illustration, "fallback": name_stamp, "initial": initial}

func _paint_portrait(view: Dictionary, id: String, name_text: String) -> void:
	var picture := Art.portrait(id)
	view.image.texture = picture
	view.image.visible = picture != null
	view.fallback.visible = picture == null
	view.initial.text = name_text.left(1)

func _directory_row(list: VBoxContainer, id: String, action: Signal, is_person: bool) -> Dictionary:
	var row := _button(list, "", func(): action.emit(id), "DirectoryEntry")
	row.custom_minimum_size.y = 87 if is_person else 67
	var content := HBoxContainer.new()
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.add_theme_constant_override("separation", 14)
	row.add_child(content)
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	content.offset_left = 7
	content.offset_right = -9
	content.offset_top = 4
	content.offset_bottom = -4
	var view := {}
	if is_person:
		view.portrait = _portrait(content, Vector2(73, 78))
	else:
		var house := RoofSketch.new()
		house.mouse_filter = Control.MOUSE_FILTER_IGNORE
		house.custom_minimum_size.x = 70
		content.add_child(house)
		view.roof = house
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 3)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.add_child(column)
	var who := _heading(column, "", 24)
	who.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	var where := _label(column, "", 15, Art.FADED)
	where.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	view.button = row
	view.title = who
	view.note = where
	return view

func _queue_layout() -> void:
	if layout_queued: return
	layout_queued = true
	_layout.call_deferred()

func _layout() -> void:
	layout_queued = false
	var size := root.size
	brand.position = Vector2(29, 18)
	environment_plate.position = Vector2(24, 119)
	environment_plate.reset_size()
	tools.position = Vector2(size.x - tools.size.x - 22, 20)
	dock.position = Vector2((size.x - dock.size.x) * .5, size.y - dock.size.y - 21)
	lens.position = Vector2(size.x - lens.size.x - 22, size.y - lens.size.y - 22)
	event_strip.position = Vector2(22, size.y - event_strip.size.y - 21)
	var nav_gap := dock.position.x - event_strip.position.x
	var recent := event_strip.get_child(0) as Button
	var ink_width := Art.prose().get_string_size(recent_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x
	recent.custom_minimum_size.x = clampf(minf(nav_gap - 30, ink_width + 42), 110, 360)
	event_strip.reset_size()
	event_strip.visible = nav_gap >= 180 and not recent_label.text.is_empty()
	crumb.reset_size()
	crumb.position = Vector2((size.x - crumb.size.x) * .5, 20)
	feedback.reset_size()
	feedback.position = Vector2((size.x - feedback.size.x) * .5, 82 if room_open else 24)
	if drawer.visible:
		var content: Control = panes.get(_visible_pane())
		if content != null:
			scroll.custom_minimum_size.y = clampf(content.get_combined_minimum_size().y + 4, 33, maxf(33, size.y - 244))
			drawer.reset_size()
		drawer.position = Vector2(size.x - drawer.size.x - 22, 80)
	place_card.reset_size()
	_layout_place()

func _toggle_pane(pane: String) -> void:
	if pane == "events":
		if journal.visible:
			journal.dismiss()
		else:
			relationships.dismiss()
			set_hover("", Vector2.ZERO)
			journal.open()
			dock_buttons.events.set_pressed_no_signal(true)
		return
	if pane == "relations":
		if relationships.visible: relationships.dismiss()
		else: _open_relations(dock_buttons.relations)
		return
	active_pane = "" if active_pane == pane else pane
	set_hover("", Vector2.ZERO)
	_refresh_drawer()

func _open_relations(opener: Button, person_id := "") -> void:
	journal.dismiss()
	set_hover("", Vector2.ZERO)
	relation_opener = opener
	relationships.open(person_id)
	dock_buttons.relations.set_pressed_no_signal(true)

func _visible_pane() -> String:
	if not active_pane.is_empty(): return active_pane
	return "resident" if not resident_id.is_empty() else ""

func _refresh_drawer() -> void:
	var visible_pane := _visible_pane()
	var titles := {"people":"居民名录", "places":"场所", "settings":"观察设置", "spirit":"谷灵客观手记"}
	drawer_title.text = titles.get(visible_pane, "")
	directory_back.visible = visible_pane == "resident"
	settings_button.set_pressed_no_signal(active_pane == "settings")
	for key in panes:
		panes[key].visible = key == visible_pane
	for key in dock_buttons:
		dock_buttons[key].set_pressed_no_signal(key == active_pane
			or (key == "events" and journal.visible) or (key == "relations" and relationships.visible))
	drawer.visible = not visible_pane.is_empty()
	scroll.scroll_vertical = 0
	_queue_layout()

func close_drawer() -> void:
	if not active_pane.is_empty():
		active_pane = ""
		_refresh_drawer()
	elif not resident_id.is_empty():
		resident_requested.emit("")

func has_drawer() -> bool:
	return drawer.visible

func select_resident(id: String) -> void:
	if id != resident_id:
		resident_id = id
		detail_body.hide()
		detail_button.text = "随身物品与经历  ＋"
	active_pane = ""
	_refresh_drawer()

func show_resident(person: Dictionary, location: String, action: String, details: String, available: bool, following: bool, residence := "") -> void:
	if person.is_empty(): return
	var name_text := Snapshot.resident_name(person)
	_paint_portrait(resident_portrait, str(person.id), name_text)
	resident_title.text = name_text
	resident_location.text = location
	resident_action.text = action
	resident_detail.text = details
	residence_entry.visible = not residence.is_empty()
	residence_entry.text = residence + "  ›"
	residence_entry.accessibility_name = "查看住处 " + residence
	locate_button.disabled = not available
	follow_button.disabled = not available
	follow_button.set_pressed_no_signal(following)
	follow_button.text = "跟随中" if following else "跟随"
	_queue_layout()

func _toggle_resident_detail() -> void:
	detail_body.visible = not detail_body.visible
	detail_button.text = "随身物品与经历  " + ("−" if detail_body.visible else "＋")
	_queue_layout()

func update_directory(people: Dictionary, places: Dictionary) -> void:
	_update_rows(people_list, people, people_rows, resident_requested, true)
	_update_rows(places_list, places, places_rows, building_requested, false)

func _update_rows(list: VBoxContainer, entries: Dictionary, rows: Dictionary, action: Signal, is_person: bool) -> void:
	if rows.keys() != entries.keys():
		for child in list.get_children():
			list.remove_child(child)
			child.queue_free()
		rows.clear()
		if entries.is_empty():
			_label(list, "暂无居民记录" if is_person else "暂无场所记录", 15, Art.FADED)
		for id in entries:
			rows[id] = _directory_row(list, id, action, is_person)
	if entries.is_empty(): return
	for id in entries:
		var entry: Dictionary = entries[id]
		var view: Dictionary = rows[id]
		view.title.text = entry.title
		view.note.text = entry.note
		view.button.accessibility_name = str(entry.title) + "，" + str(entry.note)
		view.button.tooltip_text = view.button.accessibility_name
		if is_person:
			_paint_portrait(view.portrait, id, entry.title)
		elif view.roof.kind != entry.kind:
			view.roof.kind = entry.kind
			view.roof.queue_redraw()
	_queue_layout()

func show_place(id: String, title: String, note: String, can_enter: bool) -> void:
	if id != place_id:
		place_id = id
		place_anchor_visible = false
		place_side = 0
		active_pane = ""
		_refresh_drawer()
	place_name.text = title
	place_name.tooltip_text = title
	place_note.custom_minimum_size.x = 266 if "\n" in note else 0
	place_note.text = note
	entry_button.visible = can_enter
	place_card.visible = not id.is_empty() and not room_open and place_anchor_visible
	_queue_layout()

func position_place(at: Vector2, on_screen: bool) -> void:
	if on_screen == place_anchor_visible and place_anchor.distance_squared_to(at) < .16 and place_card.visible == (on_screen and not place_id.is_empty()):
		return
	place_anchor_visible = on_screen
	place_anchor = at
	_layout_place()

func _layout_place() -> void:
	place_card.visible = place_anchor_visible and not room_open and not place_id.is_empty()
	connector.visible = place_card.visible
	door_marker.visible = place_card.visible
	if not place_card.visible: return
	if place_side == 0: place_side = -1 if place_anchor.x < root.size.x * .5 else 1
	var left_edge := place_anchor.x - place_card.size.x - 30
	var right_edge := place_anchor.x + 30
	var right_limit := root.size.x - 22
	if drawer.visible: right_limit = drawer.position.x - 12
	var left := right_edge
	if (place_side < 0 and left_edge >= 22) or right_edge + place_card.size.x > right_limit:
		left = left_edge
	left = clampf(left, 22, root.size.x - place_card.size.x - 22)
	var top := place_anchor.y + 20
	var floor := dock.position.y - 12
	if top + place_card.size.y > floor:
		top = place_anchor.y - place_card.size.y - 20
	top = clampf(top, 80, maxf(80, floor - place_card.size.y))
	place_card.position = Vector2(left, top)
	var attachment := Vector2(place_anchor.x, place_anchor.y)
	if place_anchor.y < top: attachment.y = top
	elif place_anchor.y > top + place_card.size.y: attachment.y = top + place_card.size.y
	attachment.x = clampf(attachment.x, left + 9, left + place_card.size.x - 9)
	connector.points = PackedVector2Array([place_anchor, attachment])
	door_marker.position = place_anchor

func show_room(title: String, caption: String) -> void:
	room_open = not title.is_empty()
	crumb.visible = room_open
	crumb_title.text = title
	crumb_caption.text = caption
	_queue_layout()

func close_book() -> bool:
	if relationships.visible:
		relationships.dismiss()
		return true
	if journal.visible:
		journal.dismiss()
		return true
	return false

func show_relations(world: Dictionary, history: Variant, connected: bool) -> void:
	relationships.present(world, history, connected)

func show_history(records: Array[Dictionary], connected: bool) -> void:
	journal.present(records, connected)
	recent_label.text = str(records[0].line) if not records.is_empty() else ""
	_queue_layout()

func show_environment(value: Dictionary, minute: float, stale: bool) -> void:
	environment_view.present(value, minute, stale)
	environment_plate.visible = environment_view.visible
	_queue_layout()

func show_transport(clock: String, mode: String, status_text: String, world_summary: String, diagnostics: String, source: String) -> void:
	clock_label.text = clock.replace(" · ", "　")
	source_label.text = source
	source_plate.visible = not source.is_empty()
	tools.reset_size()
	mode_label.text = mode
	run_label.text = status_text
	summary_label.text = world_summary
	diagnostics_label.text = diagnostics
	brand.reset_size()
	_queue_layout()

func show_feedback(message: String) -> void:
	feedback_label.text = message
	feedback.visible = not message.is_empty()
	_queue_layout()

func set_hover(caption: String, at: Vector2) -> void:
	hover_card.visible = not caption.is_empty()
	if caption.is_empty(): return
	hover_label.text = caption
	hover_card.reset_size()
	hover_card.position = Vector2(minf(at.x + 13, root.size.x - hover_card.size.x - 10), maxf(10, at.y - hover_card.size.y - 11))

func covers_screen_point(at: Vector2) -> bool:
	if journal.visible or relationships.visible: return true
	for surface in [brand, dock, lens, tools, feedback, crumb, drawer, place_card, event_strip]:
		if surface != null and surface.visible and surface.get_global_rect().has_point(at): return true
	return false

func clear_fade() -> void:
	if fade_tween != null: fade_tween.kill()
	fade_tween = null
	fade.color = Color(Art.CREAM, 0)

func dissolve() -> void:
	clear_fade()
	fade.color.a = .68
	fade_tween = create_tween()
	fade_tween.tween_property(fade, "color:a", 0.0, .24).set_trans(Tween.TRANS_SINE)

func pass_doorway(departure: float, arrival: float, swap_scene: Callable, finished: Callable) -> void:
	clear_fade()
	fade.color = Color(Art.INK, 0)
	var cover := minf(.19, departure)
	fade_tween = create_tween().set_trans(Tween.TRANS_SINE)
	fade_tween.tween_interval(departure - cover)
	fade_tween.tween_property(fade, "color:a", .9, cover)
	fade_tween.tween_callback(swap_scene)
	fade_tween.tween_property(fade, "color:a", 0.0, .24)
	fade_tween.tween_interval(maxf(arrival - .24, 0.0))
	fade_tween.tween_callback(finished)

func show_spirit(text: String) -> void:
	if spirit_text.text != text:
		spirit_text.text = text
		_queue_layout()
