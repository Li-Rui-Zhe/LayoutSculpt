import io
import json
import zipfile
from types import SimpleNamespace

import numpy as np
import trimesh
from PIL import Image

from backend.app.sample_layers import preserve_sample, add_presentation_layers
from backend.app.project_transfer import read_project_archive
from backend.app.library_models import snapshot_file
from backend.app.schemas import Layout, Furnishing, ManualEditRequest
from backend.tests.test_workflow import layout_data, furniture_data


def copied(tmp_path):
    doc = {**layout_data(), "furniture": furniture_data()["items"], "style": "natural"}
    scene = trimesh.Scene()
    scene.add_geometry(trimesh.creation.box(extents=[2,.8,.9]), node_name="sofa", metadata={"furniture_index":0},
        transform=trimesh.transformations.translation_matrix([-2,.435,-1]))
    scene.add_geometry(trimesh.creation.box(extents=[.3,.1,.2]), node_name="摆件",
        transform=trimesh.transformations.translation_matrix([-2,.9,-1]))
    scene.add_geometry(trimesh.creation.box(extents=[1,2,.02]), node_name="窗帘",
        metadata={"cutaway_upper":True, "wall_id":"w0"},
        transform=trimesh.transformations.translation_matrix([-3,1.2,-2.8]))
    scene.add_geometry(trimesh.creation.box(extents=[8,.2,6]), node_name="floor", metadata={"structure_kind":"room"})
    source = tmp_path / "sample.glb"
    source.write_bytes(scene.export(file_type="glb"))
    library = tmp_path / "library"
    data = preserve_sample(doc, source, library)
    return data, library, source, doc


def test_copy_keeps_real_meshes_and_rebuilds_layers_at_original_position(tmp_path):
    data, library, source, doc = copied(tmp_path)
    assert len(data["presentation_layers"]) == 2
    assert all(f["asset_id"].startswith("snapshot:") for f in data["furniture"])
    layout = Layout.model_validate({k:v for k,v in data.items() if k in Layout.model_fields})
    ManualEditRequest(name="副本", layout=layout, furniture=Furnishing(items=data["furniture"],notes=[]))
    builder = SimpleNamespace(document=data, scene=trimesh.Scene(), library_dir=library, cx=4, cz=3, asset_hashes={})
    add_presentation_layers(builder)
    np.testing.assert_allclose(builder.scene.bounds, [[-3.5,.2,-2.81], [-1.85,2.2,-.9]], atol=1e-6)
    assert preserve_sample(doc, source, library) == data
    data["presentation_layers"][0]["visible"] = False
    builder.scene = trimesh.Scene()
    add_presentation_layers(builder)
    assert len(builder.scene.geometry) == 1


def test_project_zip_includes_every_layer_snapshot(tmp_path):
    data, library, _, _ = copied(tmp_path)
    image = io.BytesIO()
    Image.new("RGB",(32,32),"white").save(image,format="PNG")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("layout.json",json.dumps(data))
        archive.writestr("source.png",image.getvalue())
        for item in [*data["furniture"], *data["presentation_layers"]]:
            path = snapshot_file(library,item["asset_id"])
            archive.write(path,"furniture/"+path.name)
    layout, _, _, _, snapshots, _ = read_project_archive(output.getvalue())
    assert len(layout.presentation_layers) == 2
    assert len(snapshots) == 3
