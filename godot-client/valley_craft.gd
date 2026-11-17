extends RefCounted

const PaintedSurfaces = preload("res://painted_surfaces.gd")
const PLASTER = preload("res://art/plaster-gouache-v1.png")

var painted := PaintedSurfaces.new()
var washes := {}
var primitive_meshes := {}
var rock_forms := {}

func mat(color: String) -> StandardMaterial3D:
	if not washes.has(color):
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(color)
		material.albedo_texture = PLASTER
		material.roughness = 1.0
		material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
		material.uv1_triplanar = true
		material.uv1_world_triplanar = true
		material.uv1_scale = Vector3.ONE * .42
		washes[color] = material
	return washes[color]

func mesh(parent: Node3D, shape: Mesh, at: Vector3, material: Material) -> MeshInstance3D:
	var item := MeshInstance3D.new()
	item.mesh = shape
	item.position = at
	item.material_override = material
	parent.add_child(item)
	return item

func box(parent: Node3D, at: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	if not primitive_meshes.has(size):
		var shape := BoxMesh.new()
		shape.size = size
		primitive_meshes[size] = shape
	return mesh(parent, primitive_meshes[size], at, material)

func orb(parent: Node3D, at: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	if not primitive_meshes.has("orb"):
		var shape := SphereMesh.new()
		shape.radial_segments = 14
		shape.rings = 8
		shape.radius = .5
		shape.height = 1.0
		primitive_meshes["orb"] = shape
	var item := mesh(parent, primitive_meshes["orb"], at, material)
	item.scale = size
	return item

func rod(parent: Node3D, from: Vector3, to: Vector3, radius: float, taper: float, material: Material, sides := 9) -> MeshInstance3D:
	var shaft := CylinderMesh.new()
	shaft.height = from.distance_to(to)
	shaft.bottom_radius = radius
	shaft.top_radius = radius * taper
	shaft.radial_segments = sides
	shaft.rings = 1
	var item := mesh(parent, shaft, (from + to) * .5, material)
	item.quaternion = Quaternion(Vector3.UP, (to - from).normalized())
	return item

func beam(parent: Node3D, from: Vector3, to: Vector3, width: float, material: Material) -> MeshInstance3D:
	var item := box(parent, (from + to) * .5, Vector3(width, from.distance_to(to), width), material)
	item.quaternion = Quaternion(Vector3.UP, (to - from).normalized())
	return item

# Low irregular bevels give both banks and stone walls broad painted planes.
func stone(parent: Node3D, at: Vector3, size: Vector3, material: Material, variant: int) -> MeshInstance3D:
	var form := posmod(variant, 5)
	if not rock_forms.has(form):
		var surface := SurfaceTool.new()
		surface.begin(Mesh.PRIMITIVE_TRIANGLES)
		var rim: Array[Vector3] = []
		for row in range(3):
			for corner in range(7):
				var angle := TAU * corner / 7.0
				var jitter := sin(corner * 5.4 + form * 1.9)
				var radius: float = [.34, .49, .36][row] + jitter * .045
				var height: float = [-.50, -.07, .40][row] + .09 * cos(angle * 2.0 + form)
				rim.append(Vector3(cos(angle) * radius + row * jitter * .013, height, sin(angle) * radius))
		for row in range(2):
			for corner in range(7):
				var a := row * 7 + corner
				var b := row * 7 + (corner + 1) % 7
				surface.set_smooth_group(-1)
				for index in [a, b + 7, a + 7, a, b, b + 7]:
					surface.add_vertex(rim[index])
		for corner in range(7):
			for vertex in [Vector3(0, .43, 0), rim[14 + corner], rim[14 + (corner + 1) % 7]]:
				surface.add_vertex(vertex)
		surface.generate_normals()
		surface.index()
		rock_forms[form] = surface.commit()
	var item := mesh(parent, rock_forms[form], at, material)
	item.scale = size
	return item

# Combine opaque decoration by material. Keep the same geometry for ray picking.
func batch(parent: Node3D) -> void:
	var batches := {}
	for part in parent.get_children():
		if not part is MeshInstance3D or part.mesh == null or part.has_meta("foliage_pixels"): continue
		var material: Material = part.material_override
		if not batches.has(material): batches[material] = []
		batches[material].append(part)
	for material in batches:
		var pieces: Array = batches[material]
		if pieces.size() == 1: continue
		var surface := SurfaceTool.new()
		surface.begin(Mesh.PRIMITIVE_TRIANGLES)
		for part in pieces:
			var arrays: Array = part.mesh.surface_get_arrays(0)
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
			var uv: Variant = arrays[Mesh.ARRAY_TEX_UV]
			var indices: Variant = arrays[Mesh.ARRAY_INDEX]
			var indexed: bool = indices is PackedInt32Array and not indices.is_empty()
			var order: int = indices.size() if indexed else vertices.size()
			var pose: Transform3D = part.transform
			var normal_basis := pose.basis.inverse().transposed()
			for i in range(order):
				var index: int = indices[i] if indexed else i
				surface.set_normal((normal_basis * normals[index]).normalized())
				surface.set_uv(uv[index] if uv is PackedVector2Array else Vector2.ZERO)
				surface.add_vertex(pose * vertices[index])
			parent.remove_child(part)
			part.queue_free()
		surface.index()
		mesh(parent, surface.commit(), Vector3.ZERO, material)
