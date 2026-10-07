"""Small Blender primitives used only by the offline furniture authoring tool."""

import bpy


def box(name, location, size, mat, bevel=0.025, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    obj.rotation_euler[2] = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("圆角", "BEVEL")
        modifier.width = min(bevel, min(size) / 3)
        modifier.segments = 3
        obj.modifiers.new("加权法线", "WEIGHTED_NORMAL")
    return obj


def sphere(name, location, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def cylinder(name, location, radius, depth, mat):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24, radius=radius, depth=depth, location=location
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    mod = obj.modifiers.new("圆角", "BEVEL")
    mod.width = 0.01
    mod.segments = 2
    obj.modifiers.new("加权法线", "WEIGHTED_NORMAL")
    return obj
