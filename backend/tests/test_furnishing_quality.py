"""生成质量回归：不压扁、不悬空、不覆盖有效成果，灯光不漏配。"""

from backend.app.furnishing_quality import normalize_catalog_sizes, mounted_on_wall
from backend.app.quality import prepare_generated_furnishing, finish_design
from backend.app.schemas import Furnishing, Furniture, Layout, LightFixture, Opening
from backend.tests.test_workflow import layout_data, furniture_data
from backend.app.asset_selection import select_candidates
from backend.tests.test_asset_selection import asset

ASSET = "file:" + "a" * 24


def test_quality_candidate_ranks_after_fit_and_style_but_keeps_compact_option():
    items = [asset(i, 1 + i * 0.1) for i in range(7)]
    items[-1]["quality_tier"] = "detailed"
    chosen = select_candidates(items, Layout.model_validate(layout_data()))
    assert items[-1]["asset_id"] in {i["asset_id"] for i in chosen}
    assert items[0]["asset_id"] in {i["asset_id"] for i in chosen}


def test_catalog_furniture_is_not_flattened_and_original_is_untouched():
    plan = Furnishing.model_validate(furniture_data())
    plan.items[0].asset_id = ASSET
    plan.items[0].height = 0.12
    fixed = normalize_catalog_sizes(plan, {ASSET: {"dimensions": [2, 0.9, 0.8]}})
    assert fixed.items[0].height == 0.8
    assert plan.items[0].height == 0.12
    assert fixed.notes


def test_wall_item_cannot_be_fitted_to_window_or_floating_in_room():
    layout = Layout.model_validate(layout_data())
    item = Furniture(
        name="空调",
        kind="model",
        asset_id=ASSET,
        room_id="living",
        x=4,
        y=0.21,
        width=0.86,
        depth=0.22,
        height=0.3,
        elevation=2.1,
        rotation=0,
    )
    assert mounted_on_wall(item, layout)
    item.y = 3
    assert not mounted_on_wall(item, layout)
    item.y = 0.21
    # 窄窗口不经过机身中心，但仍不能作为完整安装墙面。
    layout.openings.append(
        Opening(
            wall_id="w0", kind="window", offset=3.7, width=0.3, bottom=1.8, height=0.6
        )
    )
    assert not mounted_on_wall(item, layout)


def test_countertop_device_requires_real_support_and_adjusts_height():
    layout = Layout.model_validate(layout_data())
    device = Furniture(
        name="微波炉",
        kind="model",
        asset_id=ASSET,
        room_id="living",
        x=4,
        y=3,
        width=0.49,
        depth=0.38,
        height=0.29,
        elevation=0,
        rotation=0,
    )
    assets = {
        ASSET: {"dimensions": [0.49, 0.38, 0.29], "placement_surface": "countertop"}
    }
    assert not prepare_generated_furnishing(
        Furnishing(items=[device], notes=[]), layout, assets=assets
    ).items
    desk = Furniture(
        kind="desk",
        room_id="living",
        x=4,
        y=3,
        width=1.2,
        depth=0.6,
        height=0.75,
        rotation=0,
    )
    plan = prepare_generated_furnishing(
        Furnishing(items=[device, desk], notes=[]), layout, assets=assets
    )
    assert len(plan.items) == 2
    assert plan.items[0].elevation == 0.75


def test_completion_keeps_existing_furniture_immutable_and_does_not_overlap():
    layout = Layout.model_validate(layout_data())
    existing = Furnishing.model_validate(furniture_data()).items[0]
    before = existing.model_dump()
    addition = existing.model_copy(update={"name": "addition"})
    result = prepare_generated_furnishing(
        Furnishing(items=[addition], notes=[]), layout, fixed_items=[existing]
    )
    assert not result.items
    assert existing.model_dump() == before


def test_table_lamp_does_not_replace_main_light_and_manual_off_is_preserved():
    layout = Layout.model_validate(layout_data())
    layout.lights = [
        LightFixture(id="task", name="台灯", kind="table_lamp", x=2, y=2, elevation=0.8)
    ]
    plan = Furnishing.model_validate(furniture_data())
    finished, _, _ = finish_design(layout, plan)
    assert [l.kind for l in finished.lights] == ["table_lamp", "ceiling"]
    assert finished.lights[-1].elevation == 2.58
    finished.lights[-1].enabled = False
    assert len(finish_design(finished, plan)[0].lights) == 2


def test_workflow_recovers_only_missing_core_item_and_retains_valid_table(tmp_path):
    import json
    from fastapi.testclient import TestClient
    from backend.tests.test_workflow import FakeCodex, app_for, create_job, wait_job

    class RepairClient(FakeCodex):
        async def generate(self, **kwargs):
            if kwargs["schema"]["title"] != "Furnishing":
                return await super().generate(**kwargs)
            self.calls.append(kwargs)
            if '"completion_only":true' in kwargs["prompt"]:
                return json.dumps(furniture_data())
            bad = furniture_data()
            bad["items"][0].update(x=20, y=20)
            bad["items"].append(
                dict(
                    name="保留桌",
                    kind="table",
                    room_id="living",
                    x=6,
                    y=4,
                    width=1.2,
                    depth=0.8,
                    height=0.75,
                    rotation=0,
                )
            )
            return json.dumps(bad)

    fake = RepairClient()
    with TestClient(app_for(tmp_path, fake)) as client:
        job = wait_job(client, create_job(client, collaboration=False)["id"])
        assert job["status"] == "succeeded", job.get("error")
        document = json.loads(
            (tmp_path / "jobs" / job["id"] / "layout.json").read_text("utf-8")
        )
        assert {i["kind"] for i in document["furniture"]} == {"sofa", "table"}
        table = next(i for i in document["furniture"] if i["kind"] == "table")
        assert (table["x"], table["y"], table["width"], table["depth"]) == (
            6,
            4,
            1.2,
            0.8,
        )
        assert (
            sum('"completion_only":true' in call["prompt"] for call in fake.calls) == 1
        )
