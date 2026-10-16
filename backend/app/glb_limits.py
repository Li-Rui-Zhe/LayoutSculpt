"""解析三维模型前的结构与贴图预算，阻止小文件触发过量展开。"""

import base64
import io
import struct
from urllib.parse import unquote_to_bytes

from PIL import Image


def validate_glb_budget(document, data, json_size):
    nodes = document.get("nodes", [])
    meshes = document.get("meshes", [])
    images = document.get("images", [])
    if (
        len(nodes) > 2000
        or len(meshes) > 1000
        or len(images) > 128
        or len(document.get("materials", [])) > 256
    ):
        raise ValueError("模型对象或材质过多，请先合并简化")
    accessors = document.get("accessors", [])
    if any(not isinstance(a.get("count"), int) or a["count"] < 0 for a in accessors):
        raise ValueError("模型顶点计数无效")
    if sum(a.get("count", 0) for a in accessors) > 20_000_000:
        raise ValueError("模型几何数据过多，请先减面")
    geometry = []
    for mesh in meshes:
        vertices = indices = 0
        if len(mesh.get("primitives", [])) > 256:
            raise ValueError("模型分块过多，请先合并")
        for primitive in mesh.get("primitives", []):
            references = [
                primitive["attributes"]["POSITION"],
                *([primitive["indices"]] if "indices" in primitive else []),
            ]
            if any(
                not isinstance(index, int) or not 0 <= index < len(accessors)
                for index in references
            ):
                raise ValueError("模型几何引用无效")
            vertices += accessors[primitive["attributes"]["POSITION"]]["count"]
            if "indices" in primitive:
                indices += accessors[primitive["indices"]]["count"]
        geometry.append((vertices, indices))
    if any(
        "mesh" in n
        and (not isinstance(n["mesh"], int) or not 0 <= n["mesh"] < len(meshes))
        for n in nodes
    ):
        raise ValueError("模型网格引用无效")
    if (
        sum(geometry[n["mesh"]][0] for n in nodes if "mesh" in n) > 2_000_000
        or sum(geometry[n["mesh"]][1] for n in nodes if "mesh" in n) > 6_000_000
    ):
        raise ValueError("模型展开后过于复杂，请减面后导入（最多 200 万顶点）")
    visited = set()
    parents = set()
    for node in nodes:
        for child in node.get("children", []):
            if child in parents:
                raise ValueError("模型对象被多个父级重复引用，请展开实例后导入")
            parents.add(child)

    def visit(index, ancestors):
        if index in ancestors or len(ancestors) > 128:
            raise ValueError("模型层级循环或过深，请整理对象层级")
        if index in visited:
            return
        if not isinstance(index, int) or index < 0 or index >= len(nodes):
            raise ValueError("模型层级引用无效")
        for child in nodes[index].get("children", []):
            visit(child, ancestors | {index})
        visited.add(index)

    for index in range(len(nodes)):
        visit(index, set())
    offset = 20 + json_size
    binary = b""
    if offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        if kind == 0x004E4942:
            binary = memoryview(data)[offset + 8 : offset + 8 + length]
    total_pixels = 0
    for item in images:
        if "uri" in item:
            header, encoded = item["uri"].split(",", 1)
            raw = (
                base64.b64decode(encoded, validate=True)
                if ";base64" in header
                else unquote_to_bytes(encoded)
            )
        else:
            view = document["bufferViews"][item["bufferView"]]
            if view.get("buffer", 0) != 0:
                raise ValueError("贴图必须使用 GLB 内嵌数据")
            start = view.get("byteOffset", 0)
            raw = binary[start : start + view["byteLength"]]
        with Image.open(io.BytesIO(raw)) as image:
            pixels = image.width * image.height
            total_pixels += pixels
            if pixels > 16_000_000 or total_pixels > 64_000_000:
                raise ValueError("模型贴图像素过大，请压缩贴图后导入")
