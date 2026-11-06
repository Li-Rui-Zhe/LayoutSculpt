"""户型形状、灯位净空及缺项续作验收，使用隔离数据目录。"""
import json

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Point, Polygon

from backend.app.furnishing_quality import mounted_on_wall
from backend.app.placement_geometry import walls_at_height
from backend.app.quality import finish_design
from backend.app.schemas import Furniture, Furnishing, Layout
from backend.tests.test_workflow import FakeCodex, app_for, create_job, furniture_data, layout_data, wait_job


def shaped_layout(points):
    data = layout_data()
    polygon = [dict(x=x, y=y) for x, y in points]
    data.update(outline=polygon, rooms=[dict(id='living', name='测试空间', kind='living', polygon=polygon)], openings=[])
    data['walls'] = [dict(id=f'w{i}', start=a, end=b, thickness=.16, height=2.7, exterior=True)
                     for i, (a,b) in enumerate(zip(polygon, polygon[1:]+polygon[:1]))]
    return Layout.model_validate(data)


@pytest.mark.parametrize('points', [
    [(0,0),(3,0),(3,2),(0,2)],  # 小户型
    [(0,0),(5,0),(5,1),(1,1),(1,5),(0,5)],  # L 形，质心在室外
    [(0,0),(4,0),(3,3),(0,2)],  # 斜墙
    [(0,0),(5,0),(5,.5),(0,.5)],  # 狭长过道，需小筒灯
])
def test_main_light_has_space_for_actual_fixture_not_just_center(points):
    layout = shaped_layout(points)
    original = layout.model_dump()
    result, _, _ = finish_design(layout, Furnishing(items=[], notes=[]))
    assert len(result.lights) == 1
    light = result.lights[0]
    radius = .28 if light.kind == 'ceiling' else .085
    shape = Point(light.x, light.y).buffer(radius)
    assert Polygon(points).covers(shape)
    assert shape.intersection(walls_at_height(result, light.elevation-.03, light.elevation+.06)).area < 1e-8
    assert layout.model_dump() == original


def test_two_balconies_keep_low_walls_and_do_not_gain_indoor_ceiling_lights():
    data = layout_data()
    data['rooms'] = [dict(id=f'b{i}', name=f'阳台{i}', kind='balcony', balcony_type='open',
                         polygon=[dict(x=x,y=y) for x,y in [(i*4,0),(i*4+4,0),(i*4+4,6),(i*4,6)]]) for i in range(2)]
    data['openings'] = []
    for wall in data['walls']:
        wall['height'] = 1.1
    layout = Layout.model_validate(data)
    result, _, _ = finish_design(layout, Furnishing(items=[], notes=[]))
    assert not result.lights
    assert result.walls == layout.walls


def test_wall_appliance_needs_solid_support_not_glass():
    data = layout_data()
    data['walls'][0].update(boundary_type='glazing', sill_height=.8)
    layout = Layout.model_validate(data)
    item = Furniture(kind='model', asset_id='file:' + 'a'*24, room_id='living', x=4, y=.21, width=.86, depth=.22,
                     height=.3, elevation=2.1, rotation=0)
    assert not mounted_on_wall(item, layout)
    layout.walls[0].boundary_type = 'wall'
    assert mounted_on_wall(item, layout)


class PartialClient(FakeCodex):
    outcome = 'empty'

    async def generate(self, **kwargs):
        if kwargs['schema']['title'] != 'Furnishing':
            return await super().generate(**kwargs)
        self.calls.append(kwargs)
        if '"completion_only":true' in kwargs['prompt']:
            if self.outcome == 'timeout':
                raise TimeoutError('测试局部补齐中断')
            if self.outcome == 'success':
                return json.dumps(furniture_data())
            if self.outcome == 'unrelated':
                data = furniture_data()
                data['items'][0]['kind'] = 'plant'
                return json.dumps(data)
            return json.dumps(dict(items=[],notes=[]))
        data = furniture_data()
        data['items'][0].update(x=30, y=30)
        data['items'].append(dict(kind='table', room_id='living', name='保留桌', x=6, y=4,
                                  width=1.2, depth=.8, height=.75, rotation=15))
        return json.dumps(data)


@pytest.mark.parametrize('outcome', ['success','timeout','unrelated'])
def test_continue_only_fills_missing_core_and_retains_original(tmp_path, outcome):
    ai = PartialClient()
    with TestClient(app_for(tmp_path, ai)) as client:
        first = wait_job(client, create_job(client, collaboration=False)['id'])
        assert first['status'] == 'succeeded'
        assert first['result']['quality']['furnishing_complete'] is False
        assert first['result']['quality']['pending_furniture'] == ['living']
        assert '尚未完成' in first['result']['delivery_notice']
        original = client.get(first['result']['layout_url']).json()
        assert [i['kind'] for i in original['furniture']] == ['table']
        # 单纯重建模型不会把未完成的家具规划误标为完成。
        rebuilt = client.post(f"/api/jobs/{first['id']}/rebuild")
        assert rebuilt.status_code == 201, rebuilt.text
        rebuilt_job = wait_job(client, rebuilt.json()['id'])
        assert rebuilt_job['result']['quality']['furnishing_complete'] is False
        assert rebuilt_job['result']['quality']['pending_furniture'] == ['living']
        ai.outcome = outcome
        before = len(ai.calls)
        response = client.post(f"/api/jobs/{first['id']}/rebuild?replan=true")
        assert response.status_code == 201, response.text
        final = wait_job(client, response.json()['id'])
        assert final['status'] == 'succeeded', final
        result = client.get(final['result']['layout_url']).json()
        assert result['furniture'][0] == original['furniture'][0]
        assert result['walls'] == original['walls']
        assert result['lights'] == original['lights']
        assert all('"completion_only":true' in call['prompt'] for call in ai.calls[before:])
        assert ai.calls[before:]
        if outcome == 'success':
            assert [i['kind'] for i in result['furniture']] == ['table','sofa']
            assert final['result']['quality']['furnishing_complete'] is True
            assert not final['result']['delivery_notice']
        else:
            assert result['furniture'] == original['furniture']
            assert final['result']['quality']['furnishing_complete'] is False
        assert client.get(first['result']['layout_url']).json() == original
