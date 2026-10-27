"""候选筛选保留用途与小尺寸，个人素材启用和 AI 输入保持同一范围。"""

import asyncio

from fastapi.testclient import TestClient

from backend.app.ai_requests import asset_input
from backend.app.asset_selection import asset_styles, select_candidates
from backend.app.library import LibraryService
from backend.app.schemas import Layout
from backend.tests.test_diy import design_data
from backend.tests.test_workflow import FakeCodex, app_for, layout_data


def asset(key, size=2, style="原木自然", **extra):
    return dict(
        asset_id=f"file:{key:024x}",
        name=f"沙发款式{key}",
        kind="sofa",
        dimensions=[size, 0.8, 0.8],
        family="沙发",
        category="客厅",
        source="builtin",
        style=style,
        **extra,
    )


def test_candidates_rank_style_keep_smallest_and_preserve_explicit_request():
    items = [
        asset(i, 1 + i * 0.1, "奶油简约" if i < 5 else "原木自然") for i in range(10)
    ]
    chosen = select_candidates(items, Layout.model_validate(layout_data()), "natural")
    assert len(chosen) == 3
    assert {i["name"] for i in chosen} == {"沙发款式0", "沙发款式5", "沙发款式6"}
    chosen = select_candidates(
        items, Layout.model_validate(layout_data()), "natural", "想要沙发款式9"
    )
    assert "沙发款式9" in {i["name"] for i in chosen}
    assert len(items) == 10 and "styles" not in items[0]


def test_uses_rooms_without_losing_structural_variants_or_unsupported_room_fallback():
    items = [asset(1)]
    for key in ["bed", "crib", "bed_bunk"]:
        items.append(
            {
                "asset_id": key,
                "catalog_kind": key,
                "name": key,
                "kind": "bed",
                "family": "床",
                "category": "儿童房",
                "dimensions": [1, 2, 1],
            }
        )
    layout = Layout.model_validate(layout_data())
    assert len(select_candidates(items, layout)) == 1
    layout.rooms[0].kind = "bedroom"
    assert {
        i["catalog_kind"]
        for i in select_candidates(items, layout)
        if i["kind"] == "bed"
    } == {"bed", "crib", "bed_bunk"}
    layout.rooms[0].kind = "other"
    assert len(select_candidates(items, layout)) == 4


def test_shared_equipment_and_ai_input_keep_compatible_styles_without_management_fields():
    item = asset(1)
    item.update(family="电脑", source_asset_id="private", description="不发给 AI")
    assert set(asset_styles(item)) == {"natural", "cream", "modern"}
    wire = asset_input([{**item, "styles": asset_styles(item)}])[0]
    assert (
        wire["styles"] == ["natural", "cream", "modern"] and wire["style"] == "原木自然"
    )
    assert "description" not in wire and "source_asset_id" not in wire


def test_personal_assets_require_opt_in_and_archived_assets_stay_out_of_ai(tmp_path):
    with TestClient(app_for(tmp_path, FakeCodex())) as client:
        design = client.post("/api/diy/assets", json={"design": design_data()}).json()
        settings = client.app.state.settings
        service = LibraryService(settings, client.app.state.store, client.app.state.diy)
        all_items = asyncio.run(service.catalog())
        identifier = f"diy:{design['id']}"
        assert identifier in {i["asset_id"] for i in all_items}
        assert identifier not in {
            i["asset_id"] for i in asyncio.run(service.catalog(for_ai=True))
        }
        builtin = next(i["asset_id"] for i in all_items if i["source"] == "builtin")
        response = client.post(
            "/api/drafts/library:new",
            json={
                "revision": 0,
                "document": {"aiEnabled": [identifier], "archived": [builtin]},
            },
        )
        assert response.status_code == 200
        candidates = asyncio.run(service.catalog(for_ai=True))
        assert identifier in {i["asset_id"] for i in candidates}
        assert builtin not in {i["asset_id"] for i in candidates}
        selected = select_candidates(candidates, Layout.model_validate(layout_data()))
        assert identifier in {i["asset_id"] for i in selected}
        assert len(selected) < len(candidates)
        # 过滤只作用于 AI，归档不破坏现有文件引用。
        assert (
            client.post("/api/library/placement", json={"id": builtin}).status_code
            == 200
        )


def test_candidate_selection_is_deterministic_and_ignores_bad_dimensions():
    items = [asset(i) for i in range(10)]
    items += [asset(11, float("nan")), asset(12, 0)]
    layout = Layout.model_validate(layout_data())
    first = select_candidates(items, layout)
    assert first == select_candidates(list(reversed(items)), layout)
    assert len(first) <= 3
    assert all(i["dimensions"][0] > 0 for i in first)


def test_custom_style_keeps_different_style_representatives_and_compact_fallback():
    items = [
        asset(1, 1, "未知风格"),
        asset(2, 2, "原木自然"),
        asset(3, 2, "奶油简约"),
        asset(4, 2, "现代简约"),
    ]
    chosen = select_candidates(items, Layout.model_validate(layout_data()), "custom")
    assert len(chosen) == 4
    assert {s for item in chosen for s in item["styles"]} == {
        "natural",
        "cream",
        "modern",
    }
