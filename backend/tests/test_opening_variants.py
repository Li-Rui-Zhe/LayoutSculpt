"""Catalogue opening variants retain style and real wall cutouts in GLB."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
import trimesh

from backend.app.ai_contracts import pack_layout, unpack_layout
from backend.app.config import Settings
from backend.app.consistency import structure_hash, verify_export
from backend.app.glb_builder import Builder
from backend.app.opening_visuals import opening_parts
from backend.app.schemas import Layout
from backend.tests.test_workflow import layout_data

VARIANTS = [
    {"kind": "door", "door_style": "double", "width": 1.6, "angle": 60},
    {
        "kind": "door",
        "door_style": "sliding",
        "door_material": "glass",
        "width": 1.8,
        "angle": 0,
    },
    {
        "kind": "door",
        "door_style": "hinged",
        "door_material": "glass",
        "width": 0.9,
        "hinge": "end",
        "swing": "right",
    },
    {
        "kind": "window",
        "window_style": "casement",
        "width": 1.2,
        "bottom": 0.9,
        "height": 1.4,
    },
    {
        "kind": "window",
        "window_style": "sliding",
        "width": 1.6,
        "bottom": 0.9,
        "height": 1.4,
    },
    {
        "kind": "window",
        "window_style": "fixed",
        "glass_type": "frosted",
        "width": 0.6,
        "bottom": 1.4,
        "height": 0.8,
    },
]


@pytest.mark.parametrize("variant", VARIANTS)
def test_variant_is_preserved_and_exported_with_verified_cutouts(tmp_path, variant):
    data = layout_data()
    data["openings"][0].update(variant)
    layout = Layout.model_validate(data)
    assert unpack_layout(pack_layout(layout)).openings == layout.openings
    doc = {**layout.model_dump(), "style": "natural", "furniture": []}
    Builder(doc, Settings().furniture_catalog).build(tmp_path)
    assert verify_export(doc, tmp_path / "model.glb")["geometry_verified"]
    scene = trimesh.load(tmp_path / "model.glb", force="scene")
    names = list(scene.geometry)
    expected = (
        "双开门扇"
        if variant.get("door_style") == "double"
        else "推拉门扇"
        if variant.get("door_style") == "sliding"
        else "单开门扇"
        if variant["kind"] == "door"
        else "平开窗扇"
        if variant.get("window_style") == "casement"
        else "推拉窗扇"
        if variant.get("window_style") == "sliding"
        else "固定窗玻璃"
    )
    assert any(name.startswith(expected) for name in names)
    if variant.get("glass_type") == "frosted":
        material = next(
            mesh.visual.material
            for mesh in scene.geometry.values()
            if mesh.visual.material.name == "磨砂窗玻璃"
        )
        assert (
            material.alphaMode == "BLEND"
            and material.roughnessFactor == pytest.approx(0.65)
        )


@pytest.mark.skipif(
    shutil.which("node") is None, reason="Node is needed for viewer/export parity"
)
@pytest.mark.parametrize("variant", VARIANTS)
def test_live_preview_and_export_use_identical_parts(variant):
    data = layout_data()
    data["openings"][0].update(variant)
    opening = Layout.model_validate(data).openings[0].model_dump()
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            'import fs from "node:fs"; import {openingParts} from "./frontend/src/editor/openingVisuals.js"; console.log(JSON.stringify(openingParts(JSON.parse(fs.readFileSync(0,"utf8")),.16)));',
        ],
        cwd=Path(__file__).resolve().parents[2],
        input=json.dumps(opening),
        text=True,
        capture_output=True,
        check=True,
        encoding="utf-8",
    )
    js = json.loads(result.stdout)
    py = opening_parts(opening, 0.16)
    assert len(js) == len(py)
    for actual, expected in zip(js, py, strict=True):
        assert (
            actual["name"] == expected["name"]
            and actual["material"] == expected["material"]
        )
        for key in ["position", "size", "angle"]:
            assert actual[key] == pytest.approx(expected[key])


def test_double_door_closed_leaves_stay_inside_the_opening_and_styles_affect_hash():
    parts = opening_parts(
        {
            "kind": "door",
            "door_style": "double",
            "width": 1.6,
            "height": 2.1,
            "angle": 0,
        }
    )
    leaves = [p for p in parts if p["name"] == "双开门扇"]
    assert len(leaves) == 2
    for part in leaves:
        assert part["position"][0] - part["size"][0] / 2 >= 0
        assert part["position"][0] + part["size"][0] / 2 <= 1.6
    raw = layout_data()
    loaded = Layout.model_validate(raw).model_dump()
    for opening in loaded["openings"]:
        for field in ["door_style", "door_material", "window_style", "glass_type"]:
            opening.pop(field)
    assert structure_hash(loaded) == structure_hash(Layout.model_validate(raw))
    changed = Layout.model_validate(raw)
    changed.openings[0].door_style = "double"
    assert structure_hash(changed) != structure_hash(loaded)
