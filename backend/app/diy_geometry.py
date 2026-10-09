"""与 Three.js DIY 预览相同的部件构建规则，Y 为高度。"""

import math

import numpy as np
import trimesh

from .diy_schema import DiyDesign, design_bounds


def design_meshes(design: DiyDesign, dimensions=None):
    low, high = design_bounds(design.parts)
    original = np.array(high) - np.array(low)
    scale = np.diag([*(np.array(dimensions or original) / original)[[0, 2, 1]], 1])
    for part in design.parts:
        if part.shape == "box":
            mesh = trimesh.creation.box(extents=[part.width, part.height, part.depth])
        elif part.shape == "cylinder":
            mesh = trimesh.creation.cylinder(radius=0.5, height=1, sections=32)
            mesh.apply_transform(
                trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
            )
            mesh.apply_scale([part.width, part.height, part.depth])
        else:
            mesh = trimesh.creation.icosphere(subdivisions=2, radius=0.5)
            mesh.apply_scale([part.width, part.height, part.depth])
        transform = trimesh.transformations.rotation_matrix(
            -math.radians(part.rotation), [0, 1, 0]
        )
        transform[:3, 3] = [
            part.x - (low[0] + high[0]) / 2,
            part.z + part.height / 2 - low[2],
            part.y - (low[1] + high[1]) / 2,
        ]
        mesh.apply_transform(scale @ transform)
        color = [int(part.color[i : i + 2], 16) for i in [1, 3, 5]] + [255]
        material = trimesh.visual.material.PBRMaterial(
            name=f"DIY_{part.id}",
            baseColorFactor=color,
            roughnessFactor=part.roughness,
            metallicFactor=part.metallic,
        )
        mesh.visual = trimesh.visual.TextureVisuals(material=material)
        yield part, mesh, material


def design_glb(design):
    scene = trimesh.Scene()
    for part, mesh, _ in design_meshes(design):
        scene.add_geometry(
            mesh,
            node_name=part.id,
            geom_name=part.id,
            metadata={"diy_part_id": part.id},
        )
    return scene.export(file_type="glb")
