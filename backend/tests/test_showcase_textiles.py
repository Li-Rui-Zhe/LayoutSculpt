"""实际展示 GLB 中的搭毯必须连续、闭合且不穿透沙发。"""
import numpy as np
import trimesh

from scripts.build_showcase import ROOT, SHOWCASE_ID
from scripts.showcase_textiles import sofa_triangles, upper_surface


def test_throw_has_thickness_smooth_normals_and_clears_sofa():
    scene = trimesh.load(ROOT / f"public/models/{SHOWCASE_ID}.glb", force="scene")
    cloth = scene.geometry["沙发垂落针织毯"]
    assert cloth.is_watertight and cloth.volume > 0
    assert len(cloth.vertices) < len(cloth.faces)  # Shared, smoothly shaded vertices.
    assert np.isfinite(cloth.visual.uv).all()
    assert np.isfinite(cloth.vertex_normals).all()
    assert .2 < cloth.bounds[0, 1] < .25  # A short drape, not a floor-length strip.
    # Include triangle centres so clearance isn't checked only at grid corners.
    points = np.vstack([cloth.vertices[::5], cloth.triangles_center[::13]])
    heights = upper_surface(sofa_triangles(scene), points[:, [0, 2]])
    supported = np.isfinite(heights)
    assert supported.sum() > 500
    assert (points[supported, 1] - heights[supported]).min() > .002
    # The supported seat section hugs the cushion within 2 cm, avoiding a floating sheet.
    on_seat = supported & (points[:, 0] < -3.15)
    assert (points[on_seat, 1] - heights[on_seat]).max() < .02
