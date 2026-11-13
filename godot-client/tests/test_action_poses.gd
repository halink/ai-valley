extends SceneTree
const Resident = preload("res://painterly_resident.gd")
func _initialize() -> void:
	var actor := Resident.new()
	actor.construct({"id":"lin"})
	actor.position = Vector3(3,0,4)
	var anchor := actor.transform
	var person := {"activity":{"action":{"type":"gather"},"path":[],"remaining":5}}
	for action in ["gather", "eat", "mvpDrink"]:
		person.activity.action.type = action
		actor.set_activity_pose(person,true)
		assert(actor.activity_pose != "idle")
		assert(actor.get_node("Hand1").transform != actor.rest_transforms["Hand1"])
		assert(actor.transform == anchor)
		actor.set_activity_pose(person,false)
		assert(actor.get_node("Hand1").transform == actor.rest_transforms["Hand1"])
	person.activity.path = [{"x":1,"y":2}]
	assert(Resident.onsite_pose(person) == "idle")
	person.activity.path = []
	person.activity.room = {"path":[],"mode":"exit"}
	assert(Resident.onsite_pose(person) == "idle")
	person.activity.erase("room")
	person.activity.action.type = "sleep"
	assert(Resident.onsite_pose(person) == "idle")
	person.inside = "lodge"
	person.roomAt = {"x":2,"y":2}
	assert(Resident.onsite_pose(person) == "rest")
	actor.set_activity_pose(person,true)
	assert(actor.get_node("Head").transform != actor.rest_transforms["Head"])
	actor.present_pose(true,PI/2)
	assert(actor.get_node("Boot1").transform != actor.rest_transforms["Boot1"])
	assert(actor.transform == anchor)
	actor.set_activity_pose({},false)
	for label in actor.rest_transforms:
		assert(actor.get_node(NodePath(label)).transform == actor.rest_transforms[label])
	for remaining in [0,-1,NAN,"5"]:
		person.activity.remaining = remaining
		assert(Resident.onsite_pose(person) == "idle")
	actor.free()
	print("PASS: authoritative action poses, travel gating, reset, bounded gait and unchanged root; synthetic, not GPU acceptance")
	quit()
