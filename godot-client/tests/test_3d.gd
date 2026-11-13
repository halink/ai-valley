extends SceneTree
const Valley = preload("res://valley_3d.gd")
var valley: Node3D
func _initialize() -> void:
	valley = Valley.new()
	root.add_child.call_deferred(valley)
	_check.call_deferred()
func _check() -> void:
	var world := {"id":"synthetic-3d", "map":{"width":4,"height":4,"tiles":[]}, "residents":[{"id":"a","at":{"x":1,"y":2},"status":"alive"},{"id":"b","at":{"x":2,"y":2},"status":"alive","inside":"home"}],"buildings":[{"at":{"x":0,"y":0},"width":2,"height":2,"door":{"x":1,"y":2}}],"resources":[{"kind":"bush","at":{"x":3,"y":3},"amount":5},{"kind":"spring","at":{"x":3,"y":1},"amount":100}]}
	world.map.tiles.resize(16)
	world.map.tiles.fill("grass")
	valley.show_world(world, "a")
	valley.center(world)
	assert(valley.camera is Camera3D)
	assert(valley.people.size() == 1)
	assert(valley.people.a.position == Vector3(1,0,2))
	assert(valley.terrain.get_child_count() > 16)
	assert(valley.mat("ffffff",true).albedo_texture != null)
	world.residents[0].at.x = 3
	valley.show_world(world, "a")
	assert(valley.people.a.position.x == 3)
	valley.show_world({}, "")
	assert(valley.people.is_empty() and valley.terrain.get_child_count() == 0)
	print("PASS: true 3D scene, textured materials, authoritative movement, indoors hidden, reconnect clear")
	quit()
