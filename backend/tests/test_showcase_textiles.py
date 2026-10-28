"""实际展示 GLB 中的搭毯必须连续、闭合且不穿透沙发。"""
import numpy as np
import trimesh
import pytest

from scripts.build_showcase import ROOT, SHOWCASE_ID
from scripts.showcase_textiles import sofa_triangles, upper_surface


@pytest.mark.parametrize("mirror", [False, True])
def test_curtain_is_one_closed_fabric_panel_with_gathered_header(mirror):
    from scripts.showcase_textiles import curtain_panel

    mesh, uv = curtain_panel(mirror=mirror)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0
    assert len(mesh.split()) == 1
    assert mesh.extents[0] == pytest.approx(.62, abs=.002)
    assert mesh.extents[1] == pytest.approx(2.57, abs=.002)
    assert .08 < mesh.extents[2] < .12  # Folds have depth, not solid column bodies.
    assert np.isfinite(uv).all() and len(uv) == len(mesh.vertices)
    top = mesh.vertices[mesh.vertices[:, 1] > 2.56, 0]
    assert np.ptp(top) < mesh.extents[0] * .86


def test_shipped_curtains_have_connected_cloth_and_tracks_in_both_rooms():
    scene = trimesh.load(ROOT / f"public/models/{SHOWCASE_ID}.glb", force="scene")
    curtains = [name for name in scene.geometry if "连续亚麻窗帘" in name]
    assert len(curtains) == 4
    assert not any("亚麻窗帘褶皱" in name or "客厅落地亚麻帘" in name for name in scene.geometry)
    for room in ["主卧", "客厅"]:
        assert any(name.startswith(f"{room}窗帘细轨道_") for name in scene.geometry)
    for name in curtains:
        transform, geometry = scene.graph[name]
        mesh = scene.geometry[geometry].copy()
        assert mesh.is_watertight and len(mesh.split()) == 1
        mesh.apply_transform(transform)
        assert mesh.bounds[0, 1] == pytest.approx(.075, abs=.002)
        assert mesh.bounds[1, 1] == pytest.approx(2.645, abs=.002)


def test_curtains_follow_supporting_wall_cut_and_restore_full_height():
    from backend.app.glb_builder import CUT_HEIGHT

    scene = trimesh.load(ROOT / f"public/models/{SHOWCASE_ID}.glb", force="scene")
    parts = {
        node: edge.get("metadata", {})
        for (_, node), edge in scene.graph.transforms.edge_data.items()
        if "窗帘" in node
    }
    lower = [name for name in parts if "剖切窗帘" in name]
    assert len(lower) == 2
    for name in lower:
        assert parts[name]["cutaway_only"] is True
        assert parts[name]["wall_id"] == "east"
        transform, geometry = scene.graph[name]
        mesh = scene.geometry[geometry].copy()
        assert mesh.is_watertight and mesh.volume > 0
        assert np.isfinite(mesh.visual.uv).all()
        mesh.apply_transform(transform)
        assert mesh.bounds[1, 1] == pytest.approx(CUT_HEIGHT, abs=1e-5)
        assert mesh.bounds[0, 1] == pytest.approx(.075, abs=.002)
    for name, meta in parts.items():
        if "剖切窗帘" in name:
            continue
        # Full curtains, rails and every tab share the wall's visibility rule.
        assert meta["cutaway_upper"] is name.startswith("主卧")
        assert meta["wall_id"] == ("east" if name.startswith("主卧") else "west")


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
        term in mesh.get("name", "") for term in ("织物靠枕", "坐垫", "靠背软垫", "苔绿腰枕", "脚凳亚麻软包", "沙发垂落针织毯")
    )]
    assert len(soft) == 12
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
