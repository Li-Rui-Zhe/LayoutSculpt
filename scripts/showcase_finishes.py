"""Deterministic, compact finishes for the authored showcase; no network assets."""

import numpy as np
import trimesh
from PIL import Image


def travertine_texture():
    rng = np.random.default_rng(27)
    y, x = np.mgrid[:512, :512]
    veins = np.sin(y / 22 + 0.65 * np.sin(x / 71)) * 3
    veins += np.sin(y / 4.2 + np.sin(x / 95)) * 1.2
    pores = np.maximum(0, rng.normal(0, 1, (512, 512)) - 1.65) * 16
    rgb = np.array([220, 208, 184]) + (veins - pores)[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def cushion_mesh(radii):
    """Soft squared cushions, with continuous normals instead of spherical blobs."""
    mesh = trimesh.creation.uv_sphere(count=[24, 32])
    points = mesh.vertices.copy()
    mesh.vertices = np.sign(points) * np.abs(points) ** 0.65 * np.array(radii)
    return mesh


def vessel_mesh():
    # A hollow rim and sculpted shoulder, rather than a solid cylinder.
    profile = np.array([
        [0, 0], [0.064, 0], [0.078, 0.025], [0.085, 0.10],
        [0.076, 0.18], [0.045, 0.22], [0.043, 0.275],
        [0.032, 0.275], [0.032, 0.23], [0.061, 0.18],
        [0.07, 0.10], [0.056, 0.025], [0, 0.025],
    ])
    return trimesh.creation.revolve(profile, sections=40)


def olive_tree():
    """Five reusable meshes; layered foliage without hundreds of draw calls."""
    rng = np.random.default_rng(87)
    scene = trimesh.Scene()

    def add(name, mesh, rgb, roughness=0.85):
        mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=name, baseColorFactor=[*(round((c / 255) ** 2.2 * 255) for c in rgb), 255],
            roughnessFactor=roughness, metallicFactor=0))
        scene.add_geometry(mesh, node_name=name, geom_name=name)

    pot = trimesh.creation.revolve(np.array([
        [0, 0], [0.13, 0], [0.18, 0.30], [0.18, 0.32],
        [0.155, 0.32], [0.15, 0.29], [0.115, 0.025], [0, 0.025],
    ]), sections=48)
    pot.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    add("植栽_砂岩陶盆", pot, [189, 173, 147])
    soil = trimesh.creation.cylinder(radius=0.15, height=0.012, sections=32)
    soil.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    soil.apply_translation([0, 0.29, 0])
    add("植栽_种植土", soil, [65, 52, 37])
    branches, leaves = [], [[], [], []]
    trunk_start, trunk_end = np.array([0, 0.25, 0]), np.array([0.025, 1.48, 0.02])
    branches.append(trimesh.creation.cylinder(radius=0.018, segment=[trunk_start, trunk_end], sections=10))
    for i in range(15):
        angle = i * 2.399
        start = np.array([0.015, 0.68 + i * 0.047, 0.01])
        reach = 0.22 + 0.07 * np.sin(i / 4)
        end = start + [np.cos(angle) * reach, 0.16, np.sin(angle) * reach]
        branches.append(trimesh.creation.cylinder(radius=0.004, segment=[start, end], sections=6))
        for j in range(14):
            center = start + (end - start) * rng.uniform(0.3, 1.1)
            center += rng.normal(0, 0.055, 3)
            leaf = trimesh.creation.icosphere(subdivisions=1)
            leaf.apply_scale([0.025, rng.uniform(0.055, 0.082), 0.006])
            leaf.apply_transform(trimesh.transformations.rotation_matrix(rng.uniform(-1.2, 1.2), [1, 0, 1]))
            leaf.apply_transform(trimesh.transformations.rotation_matrix(angle + j, [0, 1, 0]))
            leaf.apply_translation(center)
            leaves[j % 3].append(leaf)
    add("植栽_橄榄枝干", trimesh.util.concatenate(branches), [107, 88, 61])
    for i, rgb in enumerate([[70, 92, 59], [101, 119, 75], [134, 145, 99]]):
        add(f"植栽_橄榄叶_{i}", trimesh.util.concatenate(leaves[i]), rgb)
    return scene
