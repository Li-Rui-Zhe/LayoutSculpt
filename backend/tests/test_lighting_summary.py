import json
import struct

import pytest

from backend.app.lighting_summary import model_lighting_summary


def write_glb(path, nodes):
    data = json.dumps({'nodes': nodes}).encode()
    data += b' ' * (-len(data) % 4)
    path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 20 + len(data), len(data), 0x4E4F534A) + data)


def test_counts_emitters_not_meshes_and_distinguishes_decorative_lights(tmp_path):
    source = tmp_path / 'model.glb'
    def light(identifier, lumens=100, **meta):
        return {'extras': {'fixture_id': identifier, 'fixture_lumens': lumens, **meta}}
    write_glb(source, [light('main'), light('main'), light('lamp'), light('off', fixture_enabled=False),
                       light('zero', 0), {'extras': {'fixture_id': 'housing'}}, {}])
    assert model_lighting_summary(source, ['main', 'off', 'missing']) == {
        'light_count': 4, 'editable_light_count': 2, 'decorative_light_count': 2, 'active_light_count': 2,
    }


def test_showcase_reports_delivered_decorative_lights():
    from scripts.build_showcase import ROOT, SHOWCASE_ID
    assert model_lighting_summary(ROOT / f'public/models/{SHOWCASE_ID}.glb') == {
        'light_count': 13, 'editable_light_count': 0, 'decorative_light_count': 13, 'active_light_count': 13,
    }


@pytest.mark.parametrize('data', [b'', b'not-a-glb' * 4, struct.pack('<4sIIII', b'glTF', 2, 20, 400, 0x4E4F534A)])
def test_invalid_model_is_not_reported_as_zero_lights(tmp_path, data):
    source = tmp_path / 'model.glb'
    source.write_bytes(data)
    with pytest.raises(ValueError):
        model_lighting_summary(source)
