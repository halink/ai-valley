extends SceneTree
const Resident = preload("res://painterly_resident.gd")
func _initialize() -> void:
	var first := Resident.new()
	first.construct({"id":"lin","appearance":{"shirt":0xaabbcc}})
	var second := Resident.new()
	second.construct({"id":"qiao"})
	assert(first.get_meta("silhouette") != second.get_meta("silhouette"))
	assert(first.get_child_count() > 15)
	assert(first.get_node("Tunic").mesh == first.garments[2].mesh)
	for resident in [first, second]:
		var triangles := 0
		var min_height := INF
		var max_height := -INF
		for node in resident.get_children():
			assert(node is MeshInstance3D and node.mesh is ArrayMesh)
			var arrays: Array = node.mesh.surface_get_arrays(0)
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
			triangles += vertices.size()/3
			for index in range(vertices.size()):
				var position: Vector3 = node.transform * vertices[index]
				min_height = minf(min_height, position.y)
				max_height = maxf(max_height, position.y)
				assert(position.y >= -0.001 and position.y <= 1.8)
				assert(absf(position.x) < 0.48 and absf(position.z) < 0.48)
				assert(normals[index].is_finite())
				var radial := Vector3(vertices[index].x,0,vertices[index].z)
				assert(normals[index].dot(radial) >= -0.001)
			assert(node.material_override.vertex_color_use_as_albedo)
			assert(node.mesh.generate_triangle_mesh() != null)
		assert(triangles < 2200)
		assert(is_equal_approx(min_height, 0.025))
		assert(max_height <= 1.74001)
	first.update_appearance({"id":"lin","appearance":{"shirt":0xff0000}})
	for garment in first.garments:
		assert(garment.material_override.albedo_color == Color("ff0000"))
	var material: Material = first.garments[0].material_override
	first.update_appearance({"id":"lin","appearance":{"shirt":0xff0000,"hair":0x112233,"skin":0xccaabb}})
	assert(first.garments[0].material_override == material)
	assert(first.get_node("Hair").material_override.albedo_color == Color("112233"))
	assert(first.get_node("Head").material_override.albedo_color == Color("ccaabb"))
	assert(first.get_node("Hand-1").material_override == first.get_node("Head").material_override)
	second.update_appearance({"id":"qiao","appearance":{"hair":0x224466}})
	assert(second.get_node("HairKnot").material_override == second.get_node("Hair").material_override)
	assert(second.get_node("Hair").material_override.albedo_color == Color("224466"))
	var clone := Resident.new()
	clone.construct({"id":"lin"})
	assert(clone.get_node("Head").mesh == first.get_node("Head").mesh)
	assert(clone.get_meta("silhouette") == first.get_meta("silhouette"))
	first.free(); second.free(); clone.free()
	print("PASS: original real 3D character meshes, bounded scale, two silhouettes, cached geometry, pigment materials, live appearance; not rendered visual acceptance")
	quit()
