import copy

import pytest

from backend.app.quality import (
    finish_design,
    furnishing_issues,
    validate_generated_furnishing,
)
from backend.app.schemas import Furnishing, Layout
from backend.tests.test_workflow import layout_data, furniture_data


def inputs():
    return Layout.model_validate(layout_data()), Furnishing.model_validate(
        furniture_data()
    )


def test_generation_rejects_blocked_entrance_and_overlapping_furniture():
    layout, plan = inputs()
    plan.items[0].x, plan.items[0].y = 1.5, 0.6
    with pytest.raises(ValueError, match="门口"):
        validate_generated_furnishing(plan, layout)
    layout, plan = inputs()
    plan.items.append(plan.items[0].model_copy(deep=True))
    with pytest.raises(ValueError, match="重叠"):
        validate_generated_furnishing(plan, layout)
    plan.items[-1].kind = "rug"
    assert not furnishing_issues(plan, layout)


def test_furniture_inside_room_but_intersecting_wall_is_rejected():
    layout, plan = inputs()
    # Entire footprint is within the room, but it penetrates a 16 cm thick wall.
    plan.items[0].x = 4
    plan.items[0].y = 0.46
    with pytest.raises(ValueError, match="实体墙"):
        validate_generated_furnishing(plan, layout)


def test_lighting_is_valid_editable_idempotent_and_preserves_manual_darkness():
    layout, plan = inputs()
    finished, _, report = finish_design(layout, plan)
    assert len(finished.lights) == 1
    assert report["light_count"] == 1 and report["changes"]
    assert not layout.lights
    assert finish_design(finished, plan)[0].lights == finished.lights
    finished.lights[0].enabled = False
    assert finish_design(finished, plan)[0].lights[0].enabled is False
    assert not finish_design(layout, plan, automatic=False)[0].lights


def test_chairs_face_table_and_original_plan_is_untouched():
    layout, _ = inputs()
    plan = Furnishing.model_validate(
        {
            "notes": [],
            "items": [
                dict(
                    name="餐桌",
                    kind="table",
                    room_id="living",
                    x=4,
                    y=3,
                    width=1.2,
                    depth=0.8,
                    height=0.75,
                    rotation=0,
                ),
                dict(
                    name="东侧餐椅",
                    kind="chair",
                    room_id="living",
                    x=5,
                    y=3,
                    width=0.45,
                    depth=0.45,
                    height=0.85,
                    rotation=0,
                ),
            ],
        }
    )
    _, finished, _ = finish_design(layout, plan)
    assert finished.items[1].rotation == 90
    assert plan.items[1].rotation == 0


def test_counter_local_axes_are_fixed_without_moving_its_footprint():
    from backend.app.quality import footprint

    layout, _ = inputs()
    plan = Furnishing.model_validate(
        {
            "notes": [],
            "items": [
                dict(
                    name="东侧灶台",
                    kind="counter",
                    room_id="living",
                    x=7.6,
                    y=3,
                    width=0.5,
                    depth=1.2,
                    height=0.9,
                    rotation=0,
                ),
            ],
        }
    )
    _, finished, _ = finish_design(layout, plan)
    assert finished.items[0].width == 1.2
    assert finished.items[0].depth == 0.5
    assert finished.items[0].rotation == 90
    assert (
        footprint(plan.items[0]).symmetric_difference(footprint(finished.items[0])).area
        < 1e-7
    )


@pytest.mark.parametrize("case", ["room", "wall", "light"])
def test_generated_layout_has_same_structural_checks_as_manual_edits(case):
    data = layout_data()
    if case == "room":
        other = copy.deepcopy(data["rooms"][0])
        other["id"] = "overlap"
        data["rooms"].append(other)
    elif case == "wall":
        other = copy.deepcopy(data["walls"][0])
        other["id"] = "duplicate"
        data["walls"].append(other)
    else:
        data["lights"] = [dict(id="outside", name="灯", kind="bulb", x=30, y=30)]
    with pytest.raises(ValueError):
        Layout.model_validate(data)
