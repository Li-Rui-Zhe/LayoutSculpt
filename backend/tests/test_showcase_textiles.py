"""实际展示 GLB 中的搭毯必须连续、闭合且不穿透沙发。"""
import numpy as np
import trimesh
import pytest

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


@pytest.mark.parametrize("radii", [(.075, .23, .23), (.49, .055, .24), (.23, .21, .09)])
def test_cushions_are_closed_smooth_solids_in_each_orientation(radii):
    from scripts.showcase_finishes import cushion_mesh

    mesh = cushion_mesh(radii)
    assert mesh.is_watertight and mesh.is_winding_consistent
    assert mesh.volume > 0 and mesh.area_faces.min() > 1e-9
    assert mesh.extents == pytest.approx(2 * np.array(radii), rel=.005)
    assert np.isfinite(mesh.vertex_normals).all()
    assert np.linalg.norm(mesh.vertex_normals, axis=1) == pytest.approx(np.ones(len(mesh.vertices)))
    assert (mesh.vertices * mesh.vertex_normals).sum(axis=1).min() > 0


def test_shipped_soft_surfaces_include_normals_for_smooth_gltf_shading():
    import json
    import struct

    blob = (ROOT / f"public/models/{SHOWCASE_ID}.glb").read_bytes()
    length = struct.unpack_from("<I", blob, 12)[0]
    gltf = json.loads(blob[20:20 + length])
    soft = [mesh for mesh in gltf["meshes"] if any(
        term in mesh.get("name", "") for term in ("织物靠枕", "露台亚麻坐垫", "露台橄榄靠垫", "露台陶土靠垫", "沙发垂落针织毯")
    )]
    assert len(soft) == 8
    for mesh in soft:
        for primitive in mesh["primitives"]:
            attributes = primitive["attributes"]
            # glTF without NORMAL is rendered flat even when positions are shared.
            assert "NORMAL" in attributes, mesh["name"]
            position = gltf["accessors"][attributes["POSITION"]]
            normal = gltf["accessors"][attributes["NORMAL"]]
            assert normal["count"] == position["count"]
            assert normal["type"] == "VEC3" and normal["componentType"] == 5126


def test_shipped_sofa_cushions_rest_on_seat_and_clear_end_armrests():
    scene = trimesh.load(ROOT / f"public/models/{SHOWCASE_ID}.glb", force="scene")
    support = sofa_triangles(scene)
    sofa_bounds = np.array([support.reshape(-1, 3).min(axis=0), support.reshape(-1, 3).max(axis=0)])
    end_margin = (sofa_bounds[1, 2] - sofa_bounds[0, 2]) * .09
    for name in ("苔绿织物靠枕", "陶土织物靠枕"):
        transform, geometry = scene.graph[name]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        points = np.vstack([mesh.vertices, mesh.triangles_center])
        points = points[points[:, 1] < mesh.bounds[0, 1] + .04]
        heights = upper_surface(support, points[:, [0, 2]])
        assert np.isfinite(heights).all()
        gap = points[:, 1] - heights
        assert .0005 < gap.min() < .005  # No seat penetration or floating pillow.
        assert mesh.bounds[0, 2] > sofa_bounds[0, 2] + end_margin
        assert mesh.bounds[1, 2] < sofa_bounds[1, 2] - end_margin
        back = mesh.vertices[(mesh.vertex_normals[:, 0] < -.55) & (mesh.vertices[:, 1] > mesh.bounds[0, 1] + .09)]
        backrest = upper_surface(support[:, :, [1, 0, 2]], back[:, [1, 2]])
        valid = np.isfinite(backrest)
        assert valid.any()
        back_gap = back[valid, 0] - backrest[valid]
        assert 0 < back_gap.min() < .006  # Also lean on the actual back cushion.
        assert mesh.visual.material.roughnessFactor >= .9
        assert mesh.visual.material.baseColorTexture is not None
