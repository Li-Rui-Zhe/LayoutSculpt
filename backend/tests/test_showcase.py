"""Verify the shipped sample itself, including its Blender placements."""
import json

import numpy as np
import pytest
import trimesh

from backend.app.architecture import validate_generated_structure
from backend.app.consistency import verify_export
from backend.app.quality import validate_generated_furnishing
from backend.app.schemas import Furnishing, Layout
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
    path = ROOT / "public" / metadata["model_url"].lstrip("/")
    assert path.stat().st_size < 10 * 1024 * 1024
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
    # The wall TV must float above the console, while all other assets sit on
    # the floor. This catches Blender origin/axis or normalization regressions.
    for index, item in enumerate(doc["furniture"]):
        bounds = np.array(groups[index])
        bottom, top = bounds[:, 0, 1].min(), bounds[:, 1, 1].max()
        assert bottom == pytest.approx(0.035 + item["elevation"], abs=1e-4)
        assert top - bottom == pytest.approx(item["height"], abs=1e-4)
    assert len(fixtures) == 10
    assert sum(f.get("fixture_visual_placeholder") is False for f in fixtures) == 2
