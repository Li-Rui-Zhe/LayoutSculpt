"""与 Three.js DIY 预览相同的部件构建规则，Y 为高度。"""

import math

import numpy as np
import trimesh
from PIL import Image

from .diy_schema import DIY_MATERIALS, DiyDesign, design_bounds
from .surface_materials import ROOT


def design_meshes(design: DiyDesign, dimensions=None):
    low, high = design_bounds(design.parts)
    original = np.array(high) - np.array(low)
    scale = np.diag([*(np.array(dimensions or original) / original)[[0, 2, 1]], 1])
    for part in design.parts:
        if part.shape == "box":
            mesh = trimesh.creation.box(extents=[part.width, part.height, part.depth])
        elif part.shape == "rounded_box":
            extents = np.array([part.width, part.height, part.depth])
            radius = min(extents) * 0.16
            sphere = trimesh.creation.uv_sphere(radius=radius, count=[12, 12]).vertices
            corners = np.array(
                [[x, y, z] for x in [-1, 1] for y in [-1, 1] for z in [-1, 1]]
            ) * (extents / 2 - radius)
            mesh = trimesh.convex.convex_hull(
                np.concatenate([sphere + corner for corner in corners])
            )
        elif part.shape == "cone":
            mesh = trimesh.creation.cone(radius=0.5, height=1, sections=32)
            mesh.apply_translation([0, 0, -0.5])
            mesh.apply_transform(
                trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
            )
            mesh.apply_scale([part.width, part.height, part.depth])
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
        if part.material_id:
            item = DIY_MATERIALS[part.material_id]
            if item.get("opacity", 1) < 1:
                material.baseColorFactor = [*color[:3], round(item["opacity"] * 255)]
                material.alphaMode = "BLEND"
                material.doubleSided = True
            surface = item.get("surface") or {
                "wood": "planks",
                "stone": "stone",
                "linen": "linen",
            }.get(item.get("texture"))
            if surface:
                with Image.open(
                    ROOT / f"public/materials/{surface}_color.png"
                ) as image:
                    material.baseColorTexture = image.copy()
                normal = ROOT / f"public/materials/{surface}_normal.png"
                if normal.is_file():
                    with Image.open(normal) as image:
                        material.normalTexture = image.copy()
        mesh = mesh.copy()
        mesh.unmerge_vertices()
        uv = np.zeros((len(mesh.vertices), 2))
        for face, normal in zip(mesh.faces, mesh.face_normals):
            axes = [i for i in range(3) if i != int(np.argmax(np.abs(normal)))]
            uv[face] = mesh.vertices[face][:, axes]
        mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
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
