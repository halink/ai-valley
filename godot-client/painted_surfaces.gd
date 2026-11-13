extends RefCounted
# Original code-authored material recipes; no external asset/license dependency.
const SHADER = preload("res://art/painted_surfaces.gdshader")
const RECIPES := {
	"roof": [0, "686a70"],
	"wood": [1, "91704f"],
	"water": [2, "78a3a6"],
	"stone": [3, "929389"],
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
