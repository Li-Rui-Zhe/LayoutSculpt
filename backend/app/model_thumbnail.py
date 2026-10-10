"""Small isometric geometry thumbnails for user GLB imports, rendered locally."""

import numpy as np
from PIL import Image, ImageDraw
from .library_models import load_glb


def thumbnail(data, path):
    scene = load_glb(data)
    triangles = []
    for node in scene.graph.nodes_geometry:
        transform, key = scene.graph[node]
        mesh = scene.geometry[key].copy()
        mesh.apply_transform(transform)
        tri = mesh.triangles
        color = (
            getattr(mesh.visual.material, "baseColorFactor", [182, 171, 145, 255])
            if hasattr(mesh.visual, "material")
            else [182, 171, 145, 255]
        )
        if color is None:
            color = [182, 171, 145, 255]
        color = np.asarray(color).reshape(-1)[:3]
        if len(color) != 3:
            color = np.array([182, 171, 145])
        if color.max() <= 1:
            color = color * 255
        step = max(1, len(tri) // 20000)
        triangles.extend(
            (t, color, n) for t, n in zip(tri[::step], mesh.face_normals[::step])
        )
    camera = np.array([1.0, 0.8, 1.0])
    camera /= np.linalg.norm(camera)
    right = np.array([1.0, 0, -1.0])
    right /= np.linalg.norm(right)
    up = np.cross(camera, right)
    points = np.concatenate([t for t, _, _ in triangles])
    projected = points @ np.stack([right, -up], axis=1)
    low, high = projected.min(axis=0), projected.max(axis=0)
    scale = 270 / max(high - low)
    image = Image.new("RGB", (320, 320), "#f1f3ec")
    draw = ImageDraw.Draw(image)
    for t, color, normal in sorted(triangles, key=lambda v: np.mean(v[0] @ camera)):
        p = (t @ np.stack([right, -up], axis=1) - (low + high) / 2) * scale + 160
        shade = 0.65 + 0.35 * abs(float(np.dot(normal, camera)))
        draw.polygon(
            [tuple(v) for v in p],
            fill=tuple(np.clip(color * shade, 0, 255).astype(int)),
        )
    image.save(path)
