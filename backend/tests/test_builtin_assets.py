"""发布素材的真实几何、预览和户型复用链路。"""
import json
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.config import Settings
from backend.app.glb_builder import Builder
from backend.app.library_models import load_glb
from backend.app.schemas import Furniture, Furnishing, Layout
from backend.app.quality import furnishing_issues
from backend.tests.test_workflow import FakeCodex, app_for, layout_data

CATALOG = Settings().furniture_catalog
CATALOG_DATA = json.loads(CATALOG.read_text(encoding="utf-8"))
KINDS = [entry["kind"] for entry in CATALOG_DATA["items"]]


@pytest.mark.parametrize("kind", KINDS)
def test_builtin_geometry_and_thumbnail(kind):
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    assert catalog["version"] == "3.1.0"
    assert {e["kind"] for e in catalog["items"]} == set(KINDS)
    entry = next(e for e in catalog["items"] if e["kind"] == kind)
    w, d, h = entry["dimensions"]
    Furniture(kind=entry.get("furniture_kind",kind), asset_id="snapshot:"+"a"*64,
              room_id="living", x=2, y=2, width=w, depth=d, height=h, rotation=90)
    data = (CATALOG.parent / "glb" / f"{kind}.glb").read_bytes()
    scene = load_glb(data)
    assert scene.extents == pytest.approx([w, h, d], abs=1e-4)
    assert scene.bounds[0, 1] == pytest.approx(0, abs=1e-5)
    assert (scene.bounds[0] + scene.bounds[1])[[0, 2]] == pytest.approx([0, 0], abs=1e-5)
    assert all(np.isfinite(mesh.vertices).all() for mesh in scene.geometry.values())
    assert sum(len(mesh.faces) for mesh in scene.geometry.values()) < 100_000
    assert len(data) < 8 * 1024 * 1024
    with Image.open(CATALOG.parent / "thumbnails" / f"{kind}.png") as thumbnail:
        assert thumbnail.size == (320, 320)
        assert thumbnail.getbbox() is not None


def test_new_and_rebuilt_assets_are_used_in_real_plan(tmp_path):
    data = Layout.model_validate(layout_data()).model_dump()
    kinds = ["television", "washing_machine", "shower", "shower_walk_in", "shower_open", "refrigerator", "sofa"]
    entries = json.loads(CATALOG.read_text(encoding="utf-8"))["items"]
    data.update(style="natural", furniture_mode="library", furniture=[])
    for index, kind in enumerate(kinds):
        entry = next(e for e in entries if e["kind"] == kind)
        w, d, h = entry["dimensions"]
        data["furniture"].append(dict(kind=kind, room_id="living", x=1 + index * 1.4, y=3, width=w, depth=d, height=h, rotation=90))
    Builder(data, CATALOG).build(tmp_path)
    report = json.loads((tmp_path / "furniture-report.json").read_text(encoding="utf-8"))
    assert report["fallback"] == []
    assert {i["asset_id"] for i in report["instances"]} == {f"habitat_{kind}" for kind in kinds}
    scene = load_glb((tmp_path / "model.glb").read_bytes())
    assert all(any(f"asset_{kind}_" in name for name in scene.geometry) for kind in kinds)


def test_library_new_asset_placement_and_thumbnail_endpoint(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        items = client.get("/api/library/assets").json()["items"]
        for kind in ["television", "wall_television", "washing_machine", "shower", "shower_walk_in", "shower_open"]:
            item = next(i for i in items if i.get("kind") == kind)
            assert item["category"] and item["revision"] == ("2.2.0" if kind in {"shower_walk_in", "shower_open"} else "2.1.0")
            result = client.get(item["thumbnail_url"])
            assert result.status_code == 200 and result.content.startswith(b"\x89PNG")
            placed = client.post("/api/library/placement", json={"id": item["id"]})
            assert placed.status_code == 200, placed.text
            assert placed.json()["kind"] == kind
            assert placed.json()["asset_id"].startswith("snapshot:")
            assert placed.json()["elevation"] == (1.05 if kind == "wall_television" else 0)
        assert client.get("/api/library/files/missing/thumbnail.png").status_code == 404


def test_wall_tv_exports_at_mount_height_and_fits_above_console(tmp_path):
    layout = Layout.model_validate(layout_data())
    tv = Furniture(kind="wall_television", room_id="living", x=3, y=3, width=1.24, depth=.1, height=.71, elevation=1.05, rotation=90)
    console = Furniture(kind="tv_console", room_id="living", x=3, y=3, width=1.8, depth=.4, height=.52, rotation=90)
    assert not furnishing_issues(Furnishing(items=[tv, console], notes=[]), layout)
    lowered = tv.model_copy(update={"elevation": .3})
    assert any("重叠" in s for s in furnishing_issues(Furnishing(items=[lowered, console], notes=[]), layout))
    doc = layout.model_dump()
    doc.update(furniture=[tv.model_dump()], furniture_mode="library", style="natural")
    builder = Builder(doc, CATALOG)
    builder.build(tmp_path)
    scene = load_glb((tmp_path / "model.glb").read_bytes())
    minimums, maximums = [], []
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        if not name.startswith("asset_wall_television_"):
            continue
        mesh = scene.geometry[name].copy()
        mesh.apply_transform(transform)
        minimums.append(mesh.bounds[0, 1])
        maximums.append(mesh.bounds[1, 1])
    assert min(minimums) == pytest.approx(1.085, abs=1e-5)
    assert max(maximums) == pytest.approx(1.795, abs=1e-5)
    assert Furniture.model_validate({k: v for k, v in console.model_dump().items() if k != "elevation"}).elevation == 0
    for elevation in [-1, float("nan"), 3.9]:
        with pytest.raises(ValueError):
            Furniture.model_validate({**tv.model_dump(), "elevation": elevation})
