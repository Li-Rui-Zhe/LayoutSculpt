from backend.app.schemas import Layout, Furnishing
from backend.app.usability import access_issues
from backend.tests.test_workflow import layout_data, furniture_data


def test_door_sweep_is_advisory_locatable_and_does_not_move_anything():
    data = layout_data()
    data["openings"][0].update(swing="right", angle=0)
    layout = Layout.model_validate(data)
    item = furniture_data()["items"][0]
    item.update(x=1.6, y=.5, width=.3, depth=.3)
    plan = Furnishing(items=[item], notes=[])
    before = plan.model_dump()
    issues = access_issues(plan, layout)
    assert any(i["code"] == "door_swing" and i["type"] == "openings" and i["index"] == 0 for i in issues)
    assert all(i["severity"] == "warning" for i in issues)
    assert plan.model_dump() == before
    layout.openings[0].door_style = "sliding"
    assert not any(i["code"] == "door_swing" for i in access_issues(plan, layout))


def test_hidden_and_high_furniture_do_not_block_door():
    data = layout_data()
    data["openings"][0].update(swing="right")
    layout = Layout.model_validate(data)
    item = furniture_data()["items"][0]
    item.update(x=1.6, y=.5, width=.3, depth=.3, edit_hidden=True)
    plan = Furnishing(items=[item], notes=[])
    assert not access_issues(plan, layout)
    plan.items[0].edit_hidden = False
    plan.items[0].elevation = 2.5
    assert not access_issues(plan, layout)


def test_cabinet_access_and_bed_access():
    layout = Layout.model_validate(layout_data())
    item = furniture_data()["items"][0]
    cabinet = {**item, "kind":"cabinet", "name":"衣柜", "x":3, "y":5.6, "width":1, "depth":.6}
    bed = {**item, "kind":"bed", "x":3, "y":3, "width":1.5, "depth":2, "height":.8}
    plan = Furnishing(items=[cabinet, bed], notes=[])
    assert any(i["code"] == "front_access" for i in access_issues(plan, layout))
    assert not any(i["code"] == "bed_access" for i in access_issues(plan, layout))
