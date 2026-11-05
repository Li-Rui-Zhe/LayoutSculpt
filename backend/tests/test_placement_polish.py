import pytest

from backend.app.schemas import Furnishing, Layout, validate_furnishing
from backend.app.quality import furnishing_issues
from backend.app.usability import access_issues
from backend.tests.test_workflow import layout_data, furniture_data


def rectangle(x0, y0, x1, y1):
    return [dict(x=x, y=y) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]


def inputs():
    data = layout_data()
    data["rooms"] = [
        dict(id="living", name="客厅", kind="living", polygon=rectangle(0, 0, 4, 6)),
        dict(id="dining", name="餐厅", kind="dining", polygon=rectangle(4, 0, 8, 6)),
    ]
    layout = Layout.model_validate(data)
    plan = Furnishing.model_validate(furniture_data())
    plan.items[0].x = 3.9
    return layout, plan


def test_open_zone_crossing_allowed_but_solid_wall_and_gap_rejected():
    layout, plan = inputs()
    assert validate_furnishing(plan, layout) is plan
    wall = layout.walls[0].model_copy(
        update={
            "id": "partition",
            "start": layout.rooms[0].polygon[1],
            "end": layout.rooms[0].polygon[2],
        }
    )
    layout.walls.append(wall)
    with pytest.raises(ValueError, match="实体墙"):
        validate_furnishing(plan, layout)
    wall.edit_hidden = True
    assert validate_furnishing(plan, layout) is plan
    layout.rooms[1].polygon[0].x = 4.2
    layout.rooms[1].polygon[3].x = 4.2
    with pytest.raises(ValueError, match="可用空间"):
        validate_furnishing(plan, layout)


def test_hidden_items_do_not_block_or_warn_and_hidden_room_is_not_available():
    layout, plan = inputs()
    plan.items.append(plan.items[0].model_copy(update={"edit_hidden": True}))
    assert not furnishing_issues(plan, layout)
    layout.rooms[0].edit_hidden = True
    with pytest.raises(ValueError, match="隐藏"):
        validate_furnishing(plan, layout)


def test_high_items_clear_door_zone_but_low_items_do_not():
    layout = Layout.model_validate(layout_data())
    plan = Furnishing.model_validate(furniture_data())
    item = plan.items[0]
    item.x, item.y, item.width, item.depth, item.height = 1.45, 0.4, 0.4, 0.4, 0.3
    assert any("门口" in issue for issue in furnishing_issues(plan, layout))
    item.elevation = 2.2
    assert not furnishing_issues(plan, layout)


def test_window_vertical_clearance_and_hidden_wall_door_advice():
    layout = Layout.model_validate(layout_data())
    plan = Furnishing.model_validate(furniture_data())
    item = plan.items[0]
    item.x, item.y, item.width, item.depth, item.height = 1.45, 0.1, 0.4, 0.4, 0.3
    opening = layout.openings[0]
    opening.kind = "window"
    opening.bottom = 1
    opening.height = 1.4
    assert any("实体墙" in issue for issue in furnishing_issues(plan, layout))
    item.elevation = 1.1
    assert not furnishing_issues(plan, layout)
    item.elevation = 2.3
    assert any("实体墙" in issue for issue in furnishing_issues(plan, layout))
    opening.kind = "door"
    opening.bottom = 0
    opening.height = 2.1
    opening.door_leaf = True
    item.elevation = 0
    layout.walls[0].edit_hidden = True
    assert not furnishing_issues(plan, layout)
    assert not any(
        issue["code"] == "door_swing" for issue in access_issues(plan, layout)
    )
