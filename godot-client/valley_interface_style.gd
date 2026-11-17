extends RefCounted

const SANS = preload("res://art/fonts/ValleyCJK-Regular.otf")
const SERIF = preload("res://art/fonts/ValleySerif-Medium.otf")
const KAI = preload("res://art/fonts/ValleyHand-Regular.ttf")
const LEAF = preload("res://art/interface/cloth-bound-leaf-v1.png")
const CEDAR = preload("res://art/interface/cedar-slip-v1.png")
const LIN = preload("res://art/interface/lin-portrait-v1.png")
const QIAO = preload("res://art/interface/qiao-portrait-v1.png")
const HOUSEHOLD = preload("res://art/interface/household-portraits-v1.png")

const INK := Color("352b21")
const FADED := Color("595644")
const CLAY := Color("8e4634")
const CREAM := Color("f8e8c8")
const MOSS := Color("3e5143")
const VEIL := Color(.13, .16, .12, .52)
const WOOD_REGION := Rect2(.004, .201, .992, .597)
const PAGE_REGION := Rect2(.034, .030, .952, .943)

static var lettering: FontVariation
static var reading: FontVariation
static var portraits := {}

class BookCover extends Control:
	var cover: StyleBox
	var paper: StyleBox

	func _draw() -> void:
		var edge := Rect2(Vector2.ZERO, size)
		for spread in [Vector2(10, 12), Vector2(6, 8), Vector2(3, 5)]:
			draw_rect(edge.grow_individual(spread.x, 0, spread.x, spread.y), Color(0.16, 0.11, 0.06, .09))
		draw_style_box(cover, edge.grow(3))
		draw_style_box(paper, edge.grow(-5))
		var middle := size.x * .5
		for step in range(13):
			var alpha := .16 * pow(1.0 - step / 13.0, 2.1)
			draw_rect(Rect2(middle - step - 1, 8, 1, size.y - 16), Color(.43, .28, .14, alpha))
			draw_rect(Rect2(middle + step, 8, 1, size.y - 16), Color(.43, .28, .14, alpha * 0.7))
		for y in [30.0, size.y - 30.0]:
			draw_line(Vector2(middle - 5, y), Vector2(middle + 5, y), Color("7c5941"), 2.0, true)

static func book_cover() -> BookCover:
	var book := BookCover.new()
	book.cover = cedar(Vector4.ZERO, Color(1.03, 1.0, .96))
	book.paper = leaf(Vector4.ZERO, Color(1.14, 1.13, 1.12))
	return book

# A modest dab of pigment with dry, tapering ends.
class BrushBox extends StyleBox:
	var dye: Color
	var underline: bool

	func _draw(canvas: RID, rect: Rect2) -> void:
		var start := rect.position
		var extent := rect.size
		if underline:
			extent = Vector2(minf(68, extent.x * .64), 4)
			start += Vector2((rect.size.x - extent.x) * .5, rect.size.y - 5)
		var points := PackedVector2Array()
		for p: Vector2 in [
			Vector2(.00,.33), Vector2(.06,.16), Vector2(.28,.06), Vector2(.65,.07),
			Vector2(.95,.23), Vector2(1.0,.53), Vector2(.96,.72), Vector2(.58,.92),
			Vector2(.21,.98), Vector2(.022,.77)
		]:
			points.append(start + extent * p)
		RenderingServer.canvas_item_add_polygon(canvas, points, PackedColorArray([dye]))

static func hand() -> FontVariation:
	if lettering == null:
		lettering = FontVariation.new()
		lettering.base_font = KAI
		lettering.fallbacks = [SERIF, SANS]
	return lettering

static func prose() -> FontVariation:
	if reading == null:
		reading = FontVariation.new()
		reading.base_font = SERIF
		reading.fallbacks = [SANS]
	return reading

static func _image_region(source: Texture2D, percent: Rect2) -> Rect2:
	var pixels := source.get_size()
	return Rect2(percent.position * pixels, percent.size * pixels)

static func _stock(source: Texture2D, region: Rect2, insets: Vector4, tint: Color) -> StyleBoxTexture:
	var background := StyleBoxTexture.new()
	background.texture = source
	background.region_rect = _image_region(source, region)
	background.modulate_color = tint
	background.set_content_margin(SIDE_LEFT, insets.x)
	background.set_content_margin(SIDE_TOP, insets.y)
	background.set_content_margin(SIDE_RIGHT, insets.z)
	background.set_content_margin(SIDE_BOTTOM, insets.w)
	return background

static func folio() -> StyleBoxTexture:
	return _stock(LEAF, PAGE_REGION, Vector4(24, 21, 36, 23), Color(1.04, 1.035, 1.02))

static func leaf(insets: Vector4, tint := Color.WHITE) -> StyleBoxTexture:
	return _stock(LEAF, Rect2(.011, .018, .922, .968), insets, tint)

static func cedar(insets: Vector4, tint := Color.WHITE) -> StyleBoxTexture:
	return _stock(CEDAR, WOOD_REGION, insets, tint)

static func brush(color: Color, padding := Vector2.ZERO, underline := false) -> StyleBox:
	var wash := BrushBox.new()
	wash.dye = color
	wash.underline = underline
	wash.set_content_margin(SIDE_LEFT, padding.x)
	wash.set_content_margin(SIDE_RIGHT, padding.x)
	wash.set_content_margin(SIDE_TOP, padding.y)
	wash.set_content_margin(SIDE_BOTTOM, padding.y)
	return wash

static func portrait(id: String) -> Texture2D:
	if id not in ["lin", "qiao", "yan", "tang"]: return null
	if not portraits.has(id):
		var view := AtlasTexture.new()
		view.atlas = {"lin":LIN, "qiao":QIAO, "yan":HOUSEHOLD, "tang":HOUSEHOLD}[id]
		var region: Rect2 = {"lin":Rect2(.014,.011,.972,.989), "qiao":Rect2(.071,.006,.862,.994),
			"yan":Rect2(0,0,.499,1), "tang":Rect2(.501,0,.499,1)}[id]
		view.region = _image_region(view.atlas, region)
		view.filter_clip = true
		portraits[id] = view
	return portraits[id]

static func theme() -> Theme:
	var field := Theme.new()
	field.default_font = prose()
	field.default_font_size = 15
	field.set_color("font_color", "Label", INK)
	field.set_constant("line_spacing", "Label", 5)
	field.set_constant("separation", "HBoxContainer", 9)
	field.set_constant("separation", "VBoxContainer", 8)
	for kind in ["Button", "WoodButton", "PaperButton", "QuietButton", "LightButton", "DirectoryEntry", "JournalRow"]:
		if kind != "Button": field.set_type_variation(kind, "Button")
		field.set_font("font", kind, hand())
		_button_style(field, kind)
	for state in ["scroll", "scroll_focus"]:
		var track := StyleBoxFlat.new()
		track.bg_color = Color(INK, .08)
		track.set_content_margin_all(4)
		field.set_stylebox(state, "VScrollBar", track)
	for state in ["grabber", "grabber_highlight", "grabber_pressed"]:
		var handle := StyleBoxFlat.new()
		handle.bg_color = Color(CLAY, .46 if state == "grabber" else .65)
		handle.content_margin_left = 3
		handle.content_margin_right = 3
		field.set_stylebox(state, "VScrollBar", handle)
	field.set_stylebox("normal", "LineEdit", leaf(Vector4(8, 4, 8, 4)))
	field.set_stylebox("focus", "LineEdit", brush(CLAY, Vector2.ZERO, true))
	field.set_color("font_color", "LineEdit", INK)
	field.set_color("caret_color", "LineEdit", INK)
	field.set_stylebox("panel", "TooltipPanel", leaf(Vector4(8, 5, 9, 5)))
	field.set_color("font_color", "TooltipLabel", INK)
	return field

static func _button_style(field: Theme, kind: String) -> void:
	var normal := brush(Color.TRANSPARENT, Vector2(9, 5))
	var hover := brush(Color(MOSS, .115), Vector2(9, 5))
	var pressed := brush(Color(CLAY, .16), Vector2(9, 5))
	var disabled := normal
	var ink_color := INK
	var selected := CLAY
	var muted := Color("796c54")
	var edges := Vector4(15, 5, 15, 6)
	if kind == "WoodButton":
		normal = cedar(edges)
		hover = cedar(edges, Color(1.23, 1.17, 1.08))
		pressed = cedar(edges, Color(1.33, 1.02, .83))
		disabled = cedar(edges, Color(1.08, 1.05, .98, .58))
		ink_color = CREAM
		selected = Color("ffeece")
		muted = Color("eddfc8")
	elif kind == "LightButton":
		hover = brush(Color(CREAM, .14), Vector2(8, 5))
		pressed = brush(Color(CREAM, .19), Vector2(8, 5))
		ink_color = CREAM
		selected = CREAM
		muted = Color("dac9a9")
	elif kind == "PaperButton":
		normal = leaf(edges, Color("ead8bc"))
		hover = leaf(edges, Color("fff5dc"))
		pressed = leaf(edges, Color("ebc8a9"))
		disabled = leaf(edges, Color(.94, .88, .81, .70))
	field.set_stylebox("normal", kind, normal)
	field.set_stylebox("hover", kind, hover)
	field.set_stylebox("pressed", kind, pressed)
	field.set_stylebox("hover_pressed", kind, pressed)
	field.set_stylebox("disabled", kind, disabled)
	field.set_stylebox("focus", kind, brush(Color(CREAM if kind in ["WoodButton", "LightButton"] else CLAY, .85), Vector2.ZERO, true))
	field.set_color("font_color", kind, ink_color)
	field.set_color("font_hover_color", kind, ink_color)
	field.set_color("font_focus_color", kind, ink_color)
	field.set_color("font_pressed_color", kind, selected)
	field.set_color("font_hover_pressed_color", kind, selected)
	field.set_color("font_disabled_color", kind, muted)
