extends SceneTree
# Offline layout/state test, not a GPU screenshot or desktop usability acceptance.
func _initialize() -> void:
	check.call_deferred()
func check() -> void:
	var client = load("res://main.gd").new()
	root.add_child(client)
	var panel = client.find_child("ObserverPanel", true, false)
	assert(panel.theme.default_font != null)
	assert(panel.theme.default_font.has_char("居".unicode_at(0)))
	assert(panel.theme.default_font.has_char("民".unicode_at(0)))
	# All current UI Chinese text, plus dynamic names outside fixed UI strings.
	for source in ["res://main.gd", "res://valley_3d.gd"]:
		for character in FileAccess.get_file_as_string(source):
			var code = character.unicode_at(0)
			if code >= 0x3400 and code <= 0x9fff:
				assert(panel.theme.default_font.has_char(code), "Missing Chinese glyph: " + character)
	for character in "龘麤淼焱鑫翊曦繁體龍门庭𠀋":
		assert(panel.theme.default_font.has_char(character.unicode_at(0)), "Missing dynamic-text sample: " + character)
	var scroll = client.find_child("ObserverScroll", true, false)
	var long_event = "记录事件，保持服务端事实，不推断行为结果。".repeat(250)
	client.events_label.text = long_event
	client.detail.text = "居民库存、正在进行的行为与剩余时间。".repeat(100)
	client.selected = "lin"
	await process_frame
	await process_frame
	assert(is_equal_approx(panel.size.x, 480.0))
	assert(scroll.horizontal_scroll_mode == ScrollContainer.SCROLL_MODE_DISABLED)
	assert(client.events_label.autowrap_mode == TextServer.AUTOWRAP_WORD_SMART)
	assert(client.events_label.size.x <= 480)
	assert(scroll.get_v_scroll_bar().max_value > scroll.size.y)
	scroll.scroll_vertical = 100
	await process_frame
	assert(scroll.scroll_vertical > 0)
	assert(client.events_label.text == long_event and client.selected == "lin")
	assert(client.active_endpoint == "" and client.timer.is_stopped())
	print("PASS: bounded desktop panel wraps/scrolls without deleting state")
	client.queue_free()
	quit()
