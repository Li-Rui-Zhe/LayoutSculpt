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
