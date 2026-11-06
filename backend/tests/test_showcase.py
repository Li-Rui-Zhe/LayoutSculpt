import json
import numpy as np
import trimesh
import pytest
from shapely.geometry import Polygon

from backend.app.schemas import Layout, Furnishing
from backend.app.quality import validate_generated_furnishing
from backend.app.architecture import validate_generated_structure
from backend.app.consistency import verify_export
from scripts.build_showcase import ROOT, SHOWCASE_ID, document


def test_showcase_layout_and_door_clearances():
    doc = document()
    layout = Layout.model_validate({k: v for k, v in doc.items() if k in Layout.model_fields})
    validate_generated_structure(layout)
    validate_generated_furnishing(Furnishing(items=doc["furniture"], notes=[]), layout)


def test_shipped_showcase_structure_and_metadata():
    metadata = json.loads((ROOT / "frontend/src/showcase.json").read_text(encoding="utf-8"))
    public_metadata = json.loads((ROOT / f"public/models/{SHOWCASE_ID}.json").read_text(encoding="utf-8"))
    assert metadata == public_metadata
    assert metadata["id"] == SHOWCASE_ID
    catalog = json.loads((ROOT / "assets/furniture/catalog.json").read_text(encoding="utf-8"))
    assert metadata["furniture_version"] == catalog["version"]
    path = ROOT / "public" / metadata["model_url"].lstrip("/")
    assert path.stat().st_size < 12 * 1024 * 1024
    proof = verify_export(document(), path)
    assert proof["geometry_verified"]
    assert proof["floor_count"] == metadata["room_count"] == 7


def test_shipped_showcase_uses_real_assets_and_tv_elevation():
    scene = trimesh.load(ROOT / f"public/models/{SHOWCASE_ID}.glb", force="scene")
    doc = document()
    groups, fixtures = {}, []
    for (_, node), edge in scene.graph.transforms.edge_data.items():
        metadata = edge.get("metadata", {})
        if metadata.get("fixture_id"):
            fixtures.append(metadata)
        index = metadata.get("furniture_index")
        if index is None:
            continue
        transform, geometry = scene.graph[node]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        groups.setdefault(index, []).append(mesh.bounds)
    assert set(groups) == set(range(len(doc["furniture"])))
    for index, item in enumerate(doc["furniture"]):
        bounds = np.array(groups[index])
        bottom, top = bounds[:, 0, 1].min(), bounds[:, 1, 1].max()
        assert bottom == pytest.approx(0.035 + item["elevation"], abs=1e-4)
        assert top - bottom == pytest.approx(item["height"], abs=1e-4)
    assert len(fixtures) == 13
    assert sum(f.get("fixture_visual_placeholder") is False for f in fixtures) == 8


def test_showcase_garden_keeps_real_room_count_area_and_low_boundaries():
    data = document()
    layout = Layout.model_validate({k: v for k, v in data.items() if k in Layout.model_fields})
    validate_generated_furnishing(Furnishing(items=data["furniture"], notes=[]), layout)
    assert len(layout.rooms) == 7
    assert Polygon([(p.x, p.y) for p in layout.outline]).area == pytest.approx(93.2256)
    walls = {w.id: w for w in layout.walls}
    assert all(walls[key].height == 0.32 for key in ["terrace_front", "terrace_west", "terrace_east"])
    assert walls["terrace"].height == 2.8
    assert all(o.wall_id not in {"terrace_front", "terrace_west", "terrace_east"} for o in layout.openings)
    assert all(o.bottom + o.height <= walls[o.wall_id].height for o in layout.openings)


def test_showcase_finishes_are_reproducible_and_foliage_uses_shared_parts():
    import numpy as np
    from scripts.showcase_finishes import olive_tree, travertine_texture

    assert travertine_texture().tobytes() == travertine_texture().tobytes()
    tree = olive_tree()
    assert len(tree.geometry) == 6
    assert np.isfinite(tree.bounds).all()
    assert all(mesh.visual.material.metallicFactor == 0 for mesh in tree.geometry.values())


def test_shipped_showcase_retains_backdrop_and_attached_decorations_follow_walls():
    scene = trimesh.load(ROOT / f"public/models/{SHOWCASE_ID}.glb", force="scene")
    curtains, pictures, walls = [], [], []
    for (_, node), edge in scene.graph.transforms.edge_data.items():
        meta = edge.get('metadata', {})
        if meta.get('cutaway_full'):
            points = np.asarray(meta['cutaway_geometry']['positions']).reshape(-1, 3)
            upper = points[points[:, 1] > 1.20001]
            # 高墙只能出现在北/西背景墙范围，前侧及内部墙仍剖低。
            assert all(x <= -4.68 + 1e-5 or z <= -4.68 + 1e-5 for x, _, z in upper)
            walls.append(node)
        if '连续亚麻窗帘' in node or '窗帘细轨道' in node:
            curtains.append(node)
            assert meta.get('cutaway_upper') is (meta['wall_id'] == 'east')
        if any(word in node for word in ('画框', '画底纸', '织物画底', '浮雕织物', '艺术画色块')):
            pictures.append(node)
            assert meta.get('cutaway_upper') is False
    assert walls and len(curtains) == 6 and len(pictures) >= 8
    assert sum('剖切窗帘' in node for node in scene.graph.nodes_geometry) == 2
    assert {w['id'] for w in document()['walls'] if w.get('cutaway_keep')} == {'north', 'west'}


def test_backdrop_survives_layout_roundtrip_without_changing_full_structure():
    from backend.app.glb_builder import Builder
    from backend.app.consistency import structure_hash
    doc = document()
    layout = Layout.model_validate({k: v for k, v in doc.items() if k in Layout.model_fields})
    regular = layout.model_copy(deep=True)
    for wall in regular.walls:
        wall.cutaway_keep = False
    assert structure_hash(regular) == structure_hash(layout)
    previews, volumes = [], []
    for variant in [regular, layout]:
        builder = Builder({**variant.model_dump(), 'furniture': [], 'style': 'natural'}, ROOT / 'assets/furniture/catalog.json')
        builder.wall_network()
        heights = []
        for edge in builder.scene.graph.transforms.edge_data.values():
            meta = edge.get('metadata', {})
            if meta.get('cutaway_full'):
                heights.extend(np.asarray(meta['cutaway_geometry']['positions']).reshape(-1, 3)[:, 1])
        previews.append(max(heights))
        volumes.append(sum(mesh.volume for mesh in builder.scene.geometry.values()))
    assert previews == pytest.approx([1.2, 2.8])
    assert volumes[0] == pytest.approx(volumes[1])
