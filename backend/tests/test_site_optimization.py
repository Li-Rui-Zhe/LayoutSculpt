import json
import struct

from backend.app.furnishing_quality import functional_gaps
from backend.app.schemas import Layout, Furnishing
from backend.app.quality import finish_design, furnishing_issues
from backend.app.usability import access_issues, improve_access
from backend.tests.test_workflow import layout_data, furniture_data


def test_missing_basin_dining_and_scoped_exclusions():
    data = layout_data()
    data['rooms'][0].update(kind='bathroom', name='主卫')
    layout = Layout.model_validate(data)
    plan = Furnishing(items=[], notes=[])
    assert {gap['need'] for gap in functional_gaps(layout, plan)} == {'坐便器', '洗手台'}
    assert len(functional_gaps(layout, plan, '客卫不要洗手台')) == 2
    assert len(functional_gaps(layout, plan, '主卫不要洗手台')) == 1
    assert len(functional_gaps(layout, plan, '全屋不要洗手台')) == 1
    layout.rooms[0].kind = 'dining'
    assert functional_gaps(layout, plan)[0]['need'] == '餐桌'
    item = furniture_data()['items'][0]
    item.update(kind='table', edit_hidden=True)
    assert functional_gaps(layout, Furnishing(items=[item], notes=[]))


def test_historical_sample_requires_manifest_chain_and_unchanged_source(tmp_path):
    from backend.app.source_provenance import source_kind
    from backend.app.config import Settings
    from dataclasses import replace
    settings = replace(Settings(), data_dir=tmp_path)
    first, second = 'a'*32, 'b'*32
    for identifier in (first, second):
        settings.workspace(identifier).mkdir(parents=True)
        (settings.workspace(identifier)/'source.png').write_bytes(b'authored-source')
    (settings.workspace(first)/'manifest.json').write_text(json.dumps({'source':'authored_sample'}))
    (settings.workspace(second)/'rebuild-seed.json').write_text(json.dumps({'edited_of':first}))
    job = {'id':second, 'result':{'consistency':{'source_reviewed':False}}}
    assert source_kind(settings, job) == 'authored_sample'
    assert job['result']['consistency']['source_reviewed'] is False
    (settings.workspace(second)/'source.png').write_bytes(b'different-source')
    assert source_kind(settings, job) == 'uploaded_plan'
    job['result']['consistency']['source_kind']='uploaded_plan'
    assert source_kind(settings, job) == 'uploaded_plan'


def test_automatic_access_repair_never_changes_locked_or_manual_data():
    layout = Layout.model_validate(layout_data())
    item = furniture_data()['items'][0]
    item.update(kind='cabinet', name='衣柜', x=3, y=5.6, width=1, depth=.6, edit_locked=True)
    plan = Furnishing(items=[item], notes=[])
    before = plan.model_dump()
    assert access_issues(plan, layout)
    improve_access(plan, layout)
    assert plan.model_dump() == before
    _, manual, report = finish_design(layout, plan, automatic=False)
    assert manual.model_dump() == before
    assert report['access_issues'] == access_issues(plan, layout)
    plan.items[0].edit_locked = False
    hard = set(furnishing_issues(plan, layout))
    improve_access(plan, layout)
    assert not set(furnishing_issues(plan, layout)) - hard


def test_task_light_is_bounded_idempotent_and_does_not_modify_manual_design():
    data = layout_data()
    data['rooms'][0]['kind'] = 'study'
    layout = Layout.model_validate(data)
    item = furniture_data()['items'][0]
    item.update(kind='desk', x=6, y=3, width=1.2, depth=.6, height=.75)
    plan = Furnishing(items=[item], notes=[])
    result, _, _ = finish_design(layout, plan)
    assert [l.kind for l in result.lights] == ['ceiling', 'downlight']
    again, _, _ = finish_design(result, plan)
    assert len(again.lights) == 2
    assert not finish_design(layout, plan, automatic=False)[0].lights
    assert not layout.lights


def test_editable_sample_keeps_binary_assets_and_complete_object_bindings(tmp_path):
    from backend.app.sample_layers import preserve_sample, write_editable_sample
    from scripts.build_showcase import ROOT, document
    source = ROOT / 'public/models/forest-home-v3.glb'
    original = document()
    copied = preserve_sample(original, source, tmp_path / 'library')
    assert len(copied['furniture']) == len(original['furniture']) + 7
    assert not functional_gaps(Layout.model_validate({k:v for k,v in copied.items() if k in Layout.model_fields}), Furnishing(items=copied['furniture'], notes=[]))
    # 缓存恢复同一对象集合，不能丢新家具或重复添加。
    assert preserve_sample(original, source, tmp_path / 'library') == copied
    output = tmp_path / 'editable.glb'
    write_editable_sample(source, tmp_path / 'library', output)
    def chunks(path):
        raw = path.read_bytes()
        length = struct.unpack_from('<I', raw, 12)[0]
        return json.loads(raw[20:20+length]), raw[20+length:]
    original_tree, original_binary = chunks(source)
    tree, binary = chunks(output)
    assert binary == original_binary
    indices = {node.get('extras', {}).get('furniture_index') for node in tree['nodes']}
    assert set(range(len(copied['furniture']))) <= indices
    bound = {node.get('extras', {}).get('presentation_layer_id') for node in tree['nodes']}
    assert {layer['id'] for layer in copied['presentation_layers']} <= bound
