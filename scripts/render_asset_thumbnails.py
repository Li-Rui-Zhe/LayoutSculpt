"""从实际 GLB 三角网格制作透明缩略图，不依赖显卡或在线图片服务。"""

import json
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def render(path, output, size=320):
    scene = trimesh.load(path, force="scene")
    # GLB：Y 朝上、家具正面 +Z；统一从正前方右上侧取景。
    direction = np.array([3, 2.6, 4], dtype=float)
    direction /= np.linalg.norm(direction)
    right = np.cross([0, 1, 0], direction)
    right /= np.linalg.norm(right)
    up = np.cross(direction, right)
    camera = np.stack([right, up, direction], axis=1)
    light = np.array([-0.3, 0.8, 0.6])
    light /= np.linalg.norm(light)
    parts = []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        mesh = scene.geometry[name].copy()
        mesh.apply_transform(transform)
        material = mesh.visual.material
        base = getattr(material, "baseColorFactor", None)
        color = np.array(
            base if base is not None else [200, 190, 170, 255], dtype=float
        )
        texture = getattr(material, "baseColorTexture", None)
        texels = (
            np.array(texture.convert("RGB").resize((512, 512)))
            if texture is not None
            else None
        )
        parts.append((mesh, mesh.vertices @ camera, color, texels))
    all_points = np.concatenate([p for _, p, _, _ in parts])
    low, high = all_points.min(axis=0), all_points.max(axis=0)
    scale = size * 0.82 / max(high[0] - low[0], high[1] - low[1])
    center = (low + high) / 2
    triangles = []
    for mesh, projected, color, texels in parts:
        points = (projected[:, :2] - center[:2]) * [scale, -scale] + size / 2
        illumination = 0.62 + 0.38 * np.maximum(0, mesh.vertex_normals @ light)
        for index, face in enumerate(mesh.faces):
            if mesh.face_normals[index] @ direction < -0.01 and color[3] > 250:
                continue
            uv = getattr(mesh.visual, "uv", None)
            triangles.append(
                (
                    projected[face, 2],
                    points[face],
                    color,
                    texels,
                    uv[face] if uv is not None else None,
                    illumination[face],
                )
            )
    factor = 2
    pixels = size * factor
    rgba = np.zeros((pixels, pixels, 4), dtype=float)
    depth_buffer = np.full((pixels, pixels), -np.inf)
    # 先画不透明表面，再按深度合成玻璃；逐像素深度避免柜门和格栅互相遮错。
    for depths, vertices, color, texels, uv, lighting in sorted(
        triangles, key=lambda t: (t[2][3] < 250, t[0].mean())
    ):
        a, b, c = vertices * factor
        x0, y0 = np.maximum(0, np.floor(np.min([a, b, c], axis=0)).astype(int))
        x1, y1 = np.minimum(pixels - 1, np.ceil(np.max([a, b, c], axis=0)).astype(int))
        if x0 > x1 or y0 > y1:
            continue
        denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(denominator) < 1e-8:
            continue
        yy, xx = np.mgrid[y0 : y1 + 1, x0 : x1 + 1] + 0.5
        u = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / denominator
        v = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / denominator
        w = 1 - u - v
        depth = u * depths[0] + v * depths[1] + w * depths[2]
        local_depth = depth_buffer[y0 : y1 + 1, x0 : x1 + 1]
        visible = (u >= -1e-7) & (v >= -1e-7) & (w >= -1e-7) & (depth > local_depth)
        patch = rgba[y0 : y1 + 1, x0 : x1 + 1]
        shade = (u * lighting[0] + v * lighting[1] + w * lighting[2])[visible]
        colors = color[:3][None, :] * shade[:, None]
        if texels is not None and uv is not None:
            coords = (
                u[visible, None] * uv[0]
                + v[visible, None] * uv[1]
                + w[visible, None] * uv[2]
            )
            tx = np.floor(coords[:, 0] * texels.shape[1]).astype(int) % texels.shape[1]
            ty = (
                np.floor((1 - coords[:, 1]) * texels.shape[0]).astype(int)
                % texels.shape[0]
            )
            colors *= texels[ty, tx] / 255
        if color[3] >= 250:
            patch[visible, :3] = colors
            patch[visible, 3] = color[3]
            local_depth[visible] = depth[visible]
        else:
            alpha = color[3] / 255
            previous = patch[visible]
            out_alpha = alpha + previous[:, 3] / 255 * (1 - alpha)
            patch[visible, :3] = (
                colors * alpha
                + previous[:, :3] * previous[:, 3, None] / 255 * (1 - alpha)
            ) / out_alpha[:, None]
            patch[visible, 3] = out_alpha * 255
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8)).resize(
        (size, size), Image.Resampling.LANCZOS
    ).save(output)


def main():
    assets = ROOT / "assets/furniture"
    output = assets / "thumbnails"
    output.mkdir(exist_ok=True)
    catalog = json.loads((assets / "catalog.json").read_text(encoding="utf-8"))
    for entry in catalog["items"]:
        render(assets / "glb" / f"{entry['kind']}.glb", output / f"{entry['kind']}.png")
        print("THUMBNAIL_COMPLETE", entry["kind"], flush=True)


if __name__ == "__main__":
    main()
