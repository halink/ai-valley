extends SceneTree
const Valley = preload("res://valley_3d.gd")
const Surfaces = preload("res://painted_surfaces.gd")
var valley: Node3D
func _initialize() -> void:
	valley = Valley.new()
	root.add_child.call_deferred(valley)
	_check.call_deferred()
func count_surface(parent: Node, kind: String) -> int:
	var count := 0
	for child in parent.get_children():
		if child is MeshInstance3D and child.material_override.get_meta("painted_surface", "") == kind: count += 1
	return count
func _check() -> void:
	var factory := Surfaces.new()
	for kind in Surfaces.RECIPES:
		var material: ShaderMaterial = factory.get_material(kind)
		assert(material == factory.get_material(kind))
		assert(material.shader == Surfaces.SHADER)
		assert(material.get_shader_parameter("surface_kind") == Surfaces.RECIPES[kind][0])
		assert(material.get_shader_parameter("pigment") == Color(Surfaces.RECIPES[kind][1]))
	var code: String = Surfaces.SHADER.code
	assert(not "TIME" in code and not "ALPHA" in code and not "discard" in code)
	var world := {"id":"synthetic-materials", "map":{"width":3,"height":2,"tiles":["water","bridge","cliff","grass","path","soil"]}, "residents":[], "buildings":[{"at":{"x":0,"y":0},"width":2,"height":2,"door":{"x":1,"y":2}}],"resources":[{"kind":"spring","at":{"x":2,"y":1},"amount":100}]}
	var unchanged := world.duplicate(true)
	valley.show_world(world, "")
	assert(world == unchanged)
	assert(count_surface(valley.terrain, "roof") == 2)
	assert(count_surface(valley.terrain, "wood") == 2) # bridge + door
	assert(count_surface(valley.terrain, "stone") == 3) # cliff + foundation + step
	assert(count_surface(valley.terrain, "water") == 1)
	assert(count_surface(valley.actors, "water") == 1)
	var cached: Material = valley.painted_surfaces.get_material("roof")
	valley.show_world({}, "")
	valley.show_world(world, "")
	assert(valley.painted_surfaces.get_material("roof") == cached)
	valley.room_id = "room"
	valley.room_world = world.id
	valley.room_layouts = {"room":{"width":4,"height":6,"entry":{"x":2,"y":5},"slots":[],"blocked":[]}}
	valley.show_room(world, "")
	assert(count_surface(valley.terrain, "wood") == 1)
	print("PASS: procedural material recipes/cache, actual roof/wood/water/stone wiring, room floor, no snapshot mutation (not GPU validation)")
	quit()
