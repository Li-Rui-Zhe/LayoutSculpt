import numpy as np
import pytest
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

from backend.app.input_quality import InputCheck
from backend.app.outline_recesses import (
    detect_outline_recesses,
    layout_recess_findings,
    prioritize_recess_crops,
    recess_findings,
    trim_room_edge_spills,
)
from backend.app.source_evidence import DetailRegion, PixelLayoutExtraction, PixelRoom

OUTLINE = [
    (24, 42),
    (80, 42),
    (80, 72),
    (112, 72),
    (112, 25),
    (218, 25),
    (218, 210),
    (24, 210),
]
FILLED = [(24, 42), (80, 42), (80, 25), (218, 25), (218, 210), (24, 210)]


@pytest.mark.parametrize(
    "rotations,side", [(0, "top"), (1, "left"), (2, "bottom"), (3, "right")]
)
def test_recess_needs_three_visible_walls_and_an_unfilled_exterior(
    tmp_path, rotations, side
):
    drawing = Image.new("L", (240, 240), 255)
    ImageDraw.Draw(drawing).line(OUTLINE + OUTLINE[:1], fill=0, width=5, joint="curve")
    mask = np.asarray(drawing) == 0
    source = tmp_path / "source.png"
    drawing.rotate(rotations * 90).save(source)
    rotated = np.rot90(mask, rotations)
    (candidate,) = detect_outline_recesses(source, rotated.astype(np.uint8))
    assert candidate["side"] == side
    serializer = JsonPlusSerializer()
    assert serializer.loads_typed(serializer.dumps_typed(candidate)) == candidate

    if rotations == 0:
        assert not recess_findings(OUTLINE, [candidate])
        (finding,) = recess_findings(FILLED, [candidate])
        assert finding["blocking"]
        regions = [
            DetailRegion(box=[20, 120 + y, 90, 145 + y], reason="门窗细节")
            for y in (0, 30, 60)
        ]
        focused = prioritize_recess_crops(regions, [finding])
        assert len(focused) == 3
        assert focused[0].box == candidate["box"]
        assert focused[1:] == regions[:2]

    drawing = Image.open(source).copy()
    ImageDraw.Draw(drawing).line(candidate["path_px"][1:3], fill=255, width=9)
    drawing.save(source)
    assert detect_outline_recesses(source, rotated.astype(np.uint8)) == []


def test_recess_checks_the_three_exterior_segments_in_the_deliverable(tmp_path):
    drawing = Image.new("L", (240, 240), 255)
    ImageDraw.Draw(drawing).line(OUTLINE + OUTLINE[:1], fill=0, width=5, joint="curve")
    source = tmp_path / "source.png"
    drawing.save(source)
    recesses = detect_outline_recesses(
        source, (np.asarray(drawing) == 0).astype(np.uint8)
    )
    alignment = {
        "origin_px": [20, 20],
        "meters_per_pixel": 0.05,
        "local_segmentation": {"outline_recesses": recesses},
    }

    def point(p):
        return {"x": (p[0] - 20) * 0.05, "y": (p[1] - 20) * 0.05}

    walls = [
        {"start": point(a), "end": point(b), "exterior": True}
        for a, b in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1], strict=True)
    ]
    layout = {"outline": [point(p) for p in OUTLINE], "walls": walls, "rooms": []}
    assert not layout_recess_findings(layout, alignment)
    walls[2]["exterior"] = False
    assert (
        layout_recess_findings(layout, alignment)[0]["code"]
        == "outline_recess_mismatch"
    )
    walls[2]["exterior"] = True
    layout["rooms"] = [
        {"polygon": [point(p) for p in [(76, 36), (114, 36), (114, 76), (76, 76)]]}
    ]
    assert (
        layout_recess_findings(layout, alignment)[0]["code"]
        == "outline_recess_mismatch"
    )
    assert not layout_recess_findings(layout, {})


def test_only_small_room_edge_spills_are_trimmed(tmp_path):
    drawing = Image.new("L", (240, 240), 255)
    ImageDraw.Draw(drawing).line(OUTLINE + OUTLINE[:1], fill=0, width=5, joint="curve")
    source = tmp_path / "source.png"
    drawing.save(source)
    recesses = detect_outline_recesses(
        source, (np.asarray(drawing) == 0).astype(np.uint8)
    )
    edge = [
        [30, 78],
        [110, 78],
        [110, 62],
        [125, 62],
        [125, 32],
        [207, 32],
        [207, 198],
        [30, 198],
    ]
    room = PixelRoom.model_construct(id="hall", polygon=edge)
    large_spill = room.model_copy(
        update={"polygon": [[96 if x == 110 else x, y] for x, y in edge]}
    )
    output = PixelLayoutExtraction.model_construct(
        input_check=InputCheck(
            status="usable", reason="none", evidence="清晰的户型测试图"
        ),
        outline=OUTLINE,
        rooms=[room, large_spill],
        walls=[],
        openings=[],
    )
    normalized = trim_room_edge_spills(output, recesses, 0.025)
    assert not Polygon(OUTLINE).covers(Polygon(room.polygon))
    assert Polygon(OUTLINE).covers(Polygon(normalized.rooms[0].polygon))
    assert normalized.rooms[1] == large_spill
    assert normalized.outline == output.outline
    assert normalized.walls == output.walls
    assert normalized.openings == output.openings
    assert trim_room_edge_spills(normalized, recesses, 0.025) == normalized
    assert trim_room_edge_spills(output, [], 0.025) == output
