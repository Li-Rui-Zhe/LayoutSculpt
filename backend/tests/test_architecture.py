import pytest
from shapely.geometry import Point
from shapely.ops import unary_union

from backend.app.architecture import structure_issues, validate_generated_structure, wall_sections
from backend.app.schemas import Layout
from backend.tests.test_workflow import layout_data


def test_joined_wall_ring_is_solid_at_corners_and_door_is_not_filled():
    data = Layout.model_validate(layout_data()).model_dump()
    sections = wall_sections(data)
    for bottom, top, finish, shape in sections:
        assert shape.is_valid
        assert shape.covers(Point(-0.06, -0.06))
        if top <= 2.1:
            assert not shape.covers(Point(1.4, 0))
        elif bottom >= 2.1:
            assert shape.covers(Point(1.4, 0))
    assert sum((top - bottom) * shape.area for bottom, top, _, shape in sections) == pytest.approx(
        (8.16 * 6.16 - 7.84 * 5.84) * 2.7 - .9 * 2.1 * .16
    )


def test_t_joint_and_different_finishes_have_no_double_volume():
    data = Layout.model_validate(layout_data()).model_dump()
    data['walls'].append(dict(id='divider', start=dict(x=4,y=0), end=dict(x=4,y=3),
                              thickness=.16, height=2.7, exterior=False, finish='sage'))
    sections = wall_sections(data)
    floor = [shape for low, high, _, shape in sections if low == 0]
    assert unary_union(floor).covers(Point(4.04, .04))
    assert sum(shape.area for shape in floor) == pytest.approx(unary_union(floor).area)


def test_window_top_float_roundoff_does_not_create_zero_height_wall():
    import trimesh

    data = Layout.model_validate(layout_data()).model_dump()
    data['walls'][0]['height'] = 1.95
    data['openings'][0].update(kind='window', bottom=.9, height=1.05)
    assert .9 + 1.05 != 1.95  # 真实触发历史草稿裁切后的浮点边界。
    sections = wall_sections(data)
    assert sections
    for bottom, top, _, shape in sections:
        assert top - bottom > 1e-8
        polygons = [shape] if shape.geom_type == 'Polygon' else shape.geoms
        for polygon in polygons:
            if polygon.geom_type == 'Polygon' and polygon.area > 1e-8:
                mesh = trimesh.creation.extrude_polygon(
                    polygon.simplify(1e-7, preserve_topology=True), top - bottom, engine='earcut')
                assert mesh.volume > 0


def test_parallel_duplicate_wall_triggers_review_but_open_living_dining_does_not():
    data = layout_data()
    data['walls'].append(dict(id='duplicate', start=dict(x=2,y=.17), end=dict(x=5,y=.17),
                              thickness=.16, height=2.7, exterior=False))
    layout = Layout.model_validate(data)
    assert '净间距仅 0.01' in structure_issues(layout)[0]
    # A proximity heuristic is advice, not proof that the walls are duplicates.
    assert validate_generated_structure(layout) is layout
    assert len(layout.walls) == 5
    assert all(shape.is_valid for _, _, _, shape in wall_sections(layout.model_dump()))
    assert not structure_issues(Layout.model_validate(layout_data()))


def test_room_without_entrance_is_flagged_without_inventing_opening():
    data = layout_data()
    data['rooms'][0]['kind'] = 'balcony'
    data['openings'] = []
    layout = Layout.model_validate(data)
    assert '未识别到门或通道' in structure_issues(layout)[0]
    assert validate_generated_structure(layout) is layout
    assert not layout.openings


def open_kitchen_data():
    data = layout_data()
    def rectangle(x1, y1, x2, y2):
        return [dict(x=x1, y=y1), dict(x=x2, y=y1), dict(x=x2, y=y2), dict(x=x1, y=y2)]
    data['rooms'] = [
        dict(id='living', name='客厅', kind='living', polygon=rectangle(0, 0, 4, 6)),
        dict(id='kitchen', name='厨房', kind='kitchen', polygon=rectangle(4, 0, 8, 6)),
    ]
    return data


def test_open_kitchen_reaches_living_entrance_without_inventing_door():
    data = open_kitchen_data()
    layout = Layout.model_validate(data)
    assert not structure_issues(layout)
    assert len(layout.openings) == 1


@pytest.mark.parametrize('gap', [0, .08, .4])
def test_real_partition_or_narrow_gap_still_needs_access(gap):
    data = open_kitchen_data()
    data['walls'].append(dict(id='divider', start=dict(x=4,y=0), end=dict(x=4,y=6-gap),
                              thickness=.16, height=2.7, exterior=False))
    assert any('厨房 未识别到门或通道' in issue for issue in structure_issues(Layout.model_validate(data)))


def test_open_space_without_any_door_is_not_assumed_accessible():
    data = open_kitchen_data()
    data['openings'] = []
    assert any('厨房 未识别到门或通道' in issue for issue in structure_issues(Layout.model_validate(data)))


def test_window_does_not_supply_open_room_access():
    data = open_kitchen_data()
    data['openings'][0].update(kind='window', bottom=.8, height=1.2)
    assert any('厨房 未识别到门或通道' in issue for issue in structure_issues(Layout.model_validate(data)))


def test_shipped_showcase_has_no_false_access_or_balcony_findings():
    from scripts.build_showcase import document
    data = document()
    layout = Layout.model_validate({k: v for k, v in data.items() if k in Layout.model_fields})
    assert not structure_issues(layout)
