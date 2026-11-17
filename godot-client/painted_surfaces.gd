extends RefCounted
# Original code-authored material recipes; no external asset/license dependency.
const SHADER = preload("res://art/painted_surfaces.gdshader")
const RECIPES := {
	"roof": [0, "68665f"],
	"moss_roof": [0, "626b5d"],
	"clay_roof": [0, "9c735a"],
	"river_roof": [0, "637477"],
	"plum_roof": [0, "876660"],
	"wood": [1, "a17d56"],
	"light_wood": [1, "b18e61"],
	"water": [2, "749f9a"],
	"timber": [1, "745845"],
	"floor": [3, "a38362"],
	"light_floor": [3, "b39670"],
	"woven": [4, "94816a"],
	"indigo": [4, "62798b"],
	"dyed_linen": [4, "a4765d"],
	"cream_linen": [4, "ddcdb0"],
	"sage_linen": [4, "839075"],
	"rose_linen": [4, "a86662"],
	"smoke_floor": [3, "9b866e"],
	"honey_floor": [3, "a08868"],
	"soil": [5, "896c51"],
	"wet_soil": [5, "735444"],
}
var cache := {}
func get_material(kind: String) -> ShaderMaterial:
	assert(RECIPES.has(kind), "Unknown painted surface: " + kind)
	if cache.has(kind): return cache[kind]
	var material := ShaderMaterial.new()
	material.shader = SHADER
	material.set_shader_parameter("surface_kind", RECIPES[kind][0])
	material.set_shader_parameter("pigment", Color(RECIPES[kind][1]))
	material.set_meta("painted_surface", kind)
	cache[kind] = material
	return material
