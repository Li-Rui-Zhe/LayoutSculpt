"""精修不能改变家具包围尺寸、破坏硬边或引入无效表面。"""

import numpy as np
import pytest
import trimesh

from tools.home_collection import FurnitureMesh, material


def test_beveled_tabletop_is_closed_and_keeps_dimensions():
    model = FurnitureMesh()
    model.plate("桌板", [0, 0.45, 0], [1.2, 0.04, 0.6])
    mesh = next(iter(model.scene.geometry.values()))
    assert np.allclose(mesh.extents, [1.2, 0.04, 0.6])
    assert np.allclose(mesh.bounds[:, 1], [0.43, 0.47])
    assert np.isfinite(mesh.vertex_normals).all()
    assert (mesh.area_faces > 1e-12).all()
    assert len(mesh.vertices) < len(mesh.faces) * 3
    welded = mesh.copy()
    welded.merge_vertices(merge_tex=True, merge_norm=True)
    assert welded.is_watertight and welded.is_winding_consistent
    assert len(np.unique(np.round(mesh.vertices[:, 1], 6))) == 4


def test_cylinder_sides_are_smooth_but_end_faces_stay_flat():
    model = FurnitureMesh()
    model.rod("桌腿", [0, 0, 0], [0, 0.5, 0], 0.02)
    mesh = next(iter(model.scene.geometry.values()))
    for face, normal in zip(mesh.faces, mesh.face_normals):
        vertex_normals = mesh.vertex_normals[face]
        if abs(normal[1]) > 0.99:
            assert np.allclose(vertex_normals, normal, atol=1e-6)
        else:
            assert np.max(abs(vertex_normals[:, 1])) < 1e-6
            assert not np.allclose(
                vertex_normals[0], vertex_normals[1]
            ) or not np.allclose(vertex_normals[1], vertex_normals[2])


@pytest.mark.parametrize("role", ["oak", "walnut", "stone", "linen", "cream", "sage"])
def test_exported_material_keeps_small_embedded_micro_surface(role):
    mat = material(role)
    expected = 256 if role == "stone" else 512
    assert mat.normalTexture.size == (expected, expected)
    if role != "stone":
        packed = np.asarray(mat.metallicRoughnessTexture)
        assert np.max(packed[:, :, 2]) == 0  # 非金属，粗糙度仅写入 G 通道。
        assert np.std(packed[:, :, 1]) > 1
        assert mat.baseColorTexture.size == (512, 512)
    assert 0.5 <= mat.roughnessFactor <= 1
    assert mat.metallicFactor == 0
    model = FurnitureMesh()
    model.box("材质样块", [0, 0.05, 0], [0.2, 0.1, 0.2], role)
    import io

    restored = trimesh.load(
        io.BytesIO(model.scene.export(file_type="glb")), file_type="glb"
    )
    mesh = next(iter(restored.geometry.values()))
    assert mesh.visual.material.normalTexture is not None
    assert np.isfinite(mesh.visual.uv).all()
