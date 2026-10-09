"""Small Blender primitives used only by the offline furniture authoring tool."""

import bpy
import bmesh


def mesh_object(name, location, geometry, mat):
    mesh = bpy.data.meshes.new(name)
    geometry.to_mesh(mesh)
    geometry.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    return obj


def box(name, location, size, mat, bevel=0.025, rotation=0):
    geometry = bmesh.new()
    bmesh.ops.create_cube(geometry, size=1)
    for vertex in geometry.verts:
        for axis in range(3):
            vertex.co[axis] *= size[axis]
    obj = mesh_object(name, location, geometry, mat)
    obj.rotation_euler[2] = rotation
    if bevel:
        modifier = obj.modifiers.new("圆角", "BEVEL")
        modifier.width = min(bevel, min(size) / 3)
        modifier.segments = 3
        for face in obj.data.polygons:
            face.use_smooth = True
        obj.modifiers.new("加权法线", "WEIGHTED_NORMAL")
    return obj


def sphere(name, location, scale, mat, segments=24, rings=12):
    geometry = bmesh.new()
    bmesh.ops.create_uvsphere(geometry, u_segments=segments, v_segments=rings, radius=1)
    obj = mesh_object(name, location, geometry, mat)
    obj.scale = scale
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def cylinder(name, location, radius, depth, mat):
    geometry = bmesh.new()
    bmesh.ops.create_cone(geometry, cap_ends=True, cap_tris=False, segments=32,
                          radius1=radius, radius2=radius, depth=depth)
    obj = mesh_object(name, location, geometry, mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    mod = obj.modifiers.new("圆角", "BEVEL")
    mod.width = 0.01
    mod.segments = 2
    obj.modifiers.new("加权法线", "WEIGHTED_NORMAL")
    return obj
