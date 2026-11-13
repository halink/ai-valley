extends SceneTree
const Valley = preload("res://valley_3d.gd")
var valley: Node3D
func _initialize() -> void:
	valley = Valley.new()
	root.add_child.call_deferred(valley)
	_check.call_deferred()
func at_point(point: Vector3) -> String:
	return valley.pick(valley.camera.unproject_position(point))
func _check() -> void:
	root.size = Vector2i(1000, 700)
	var world := {"id":"synthetic-picking","revision":1,"map":{"width":10,"height":10,"tiles":[]},"residents":[{"id":"a","at":{"x":4,"y":2},"status":"alive"}],"buildings":[{"at":{"x":3,"y":3},"width":3,"height":3,"door":{"x":4,"y":6}}],"resources":[]}
	world.map.tiles.resize(100)
	world.map.tiles.fill("grass")
	valley.show_world(world, "a")
	valley.camera.position = Vector3(4,8,16)
	valley.camera.look_at(Vector3(4,0,4))
	valley.camera.size = 14
	# Ray crosses the actual sloped roof/walls, not a ground footprint.
	assert(at_point(Vector3(4,0.9,2)) == "")
	assert(at_point(Vector3(4,1.6,2)) == "")
	# Remove the occluder in a snapshot: same resident is now clickable.
	world.buildings = []
	valley.show_world(world, "a")
	assert(at_point(Vector3(4,0.9,2)) == "a")
	# No 28px halo, and selection ring is not part of the person geometry.
	assert(at_point(Vector3(4.8,0.9,2)) == "")
	assert(at_point(Vector3(4.47,0.04,2)) == "")
	valley.zoom(0.65)
	valley.pan(Vector2(30,-20))
	assert(at_point(Vector3(4,0.9,2)) == "a")
	# Change viewing direction; triangle queries use current camera transforms.
	valley.camera.position = Vector3(4,8,-10)
	valley.camera.look_at(Vector3(4,0,4))
	assert(at_point(Vector3(4,0.9,2)) == "a")
	# Resources are opaque too, and results refresh without a physics tick.
	valley.camera.position = Vector3(4,0.55,-10)
	valley.camera.look_at(Vector3(4,0.55,2))
	world.resources = [{"kind":"bush","at":{"x":4,"y":1},"amount":5}]
	valley.show_world(world, "a")
	assert(at_point(Vector3(4,0.55,2)) == "")
	world.resources = []
	world.residents.append({"id":"front","at":{"x":4,"y":0},"status":"alive"})
	valley.show_world(world, "a")
	assert(at_point(Vector3(4,0.9,2)) == "front")
	world.residents.pop_back()
	world.residents[0].inside = "home"
	valley.show_world(world, "a")
	assert(at_point(Vector3(4,0.9,2)) == "")
	world.residents[0].erase("inside")
	valley.show_world(world, "a")
	# Simulate an in-flight completed edge: use visual position, not target.
	valley.people.a.position = Vector3(5.5,0,2)
	valley.people.a.rotation.y = 0.7
	assert(at_point(Vector3(5.5,0.9,2)) == "a")
	assert(at_point(Vector3(4,0.9,2)) == "")
	valley.show_world({}, "")
	assert(at_point(Vector3(5.5,0.9,2)) == "")
	print("PASS: mesh-accurate resident selection, roof/wall/resource occlusion, no halo/ring picking, zoom/pan/reverse camera, indoor/removal, current moving transforms, clear")
	quit()
