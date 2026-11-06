from dataclasses import replace
from copy import deepcopy

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.schemas import Layout
from backend.tests.test_workflow import FakeCodex, fake_builder, create_job, wait_job


def test_actual_lighting_report_is_kept_in_result_and_artifact(tmp_path):
    expected = dict(light_count=4, editable_light_count=1, decorative_light_count=3, active_light_count=3)
    async def builder(*args, **kwargs):
        return {**await fake_builder(*args, **kwargs), 'lighting': expected}
    with TestClient(create_app(replace(Settings(), data_dir=tmp_path), client=FakeCodex(), model_builder=builder)) as client:
        job = wait_job(client, create_job(client)['id'])
        assert job['status'] == 'succeeded', job
        result = job['result']
        assert result['consistency']['source_kind'] == 'uploaded_plan'
        report = client.get(result['quality_url']).json()
        for key, value in expected.items():
            assert report[key] == result['quality'][key] == value


def test_sample_copy_reports_geometry_lights_and_preserves_origin_after_edit(tmp_path):
    codex = FakeCodex()
    with TestClient(create_app(replace(Settings(), data_dir=tmp_path), client=codex, model_builder=fake_builder)) as client:
        response = client.post('/api/projects/sample')
        assert response.status_code == 201, response.text
        original = response.json()
        result = original['result']
        assert result['quality']['light_count'] == 13
        assert result['quality']['decorative_light_count'] == 13
        # 使用空间建议如实保留，不再把“几何通过”当成“没有使用建议”。
        assert all(issue in [i['text'] for i in result['quality']['access_issues']]
                   for issue in result['quality']['issues'])
        assert result['consistency']['geometry_verified']
        assert result['consistency']['source_kind'] == 'authored_sample'
        assert result['consistency']['source_reviewed'] is False
        assert client.get(result['quality_url']).json() == result['quality']
        assert client.get(result['consistency_url']).json() == result['consistency']
        data = client.get(result['layout_url']).json()
        body = dict(name='流程验证副本', layout={k:v for k,v in data.items() if k in Layout.model_fields},
                    furniture=dict(items=deepcopy(data['furniture']), notes=[]))
        check = client.post('/api/design/check', json=body).json()
        assert result['quality']['access_issues'] == [i for i in check['issues'] if i['category'] == 'access']
        assert any(i['name'] == '胡桃木椭圆餐桌' for i in data['furniture'])
        assert any(layer.get('parent_wall_id') for layer in data['presentation_layers'])
        body['furniture']['items'][0]['rotation'] += 1
        edited = client.post(f"/api/jobs/{original['id']}/edit", json=body)
        assert edited.status_code == 201, edited.text
        new = wait_job(client, edited.json()['id'])
        assert new['status'] == 'succeeded', new
        assert new['result']['consistency']['source_kind'] == 'authored_sample'
        assert new['result']['consistency']['source_reviewed'] is False
        assert client.get(result['layout_url']).json() == data
        assert not codex.calls  # 人工修改只重建模型，不重新规划家具。
