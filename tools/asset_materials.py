"""Blender 与家具库共用的 PBR 材质；贴图在建库时生成并打包到工程。"""

from pathlib import Path
import bpy

TEXTURES = Path(__file__).resolve().parents[1] / "public" / "materials"
PALETTES = {
    "natural": {
        "wall": (0.78, 0.75, 0.68),
        "wood": (0.55, 0.37, 0.21),
        "floor": (0.66, 0.51, 0.33),
        "fabric": (0.86, 0.83, 0.75),
        "accent": (0.36, 0.49, 0.41),
    },
    "cream": {
        "wall": (0.87, 0.84, 0.76),
        "wood": (0.69, 0.54, 0.36),
        "floor": (0.75, 0.64, 0.47),
        "fabric": (0.93, 0.87, 0.75),
        "accent": (0.63, 0.48, 0.36),
    },
    "modern": {
        "wall": (0.68, 0.70, 0.69),
        "wood": (0.29, 0.23, 0.19),
        "floor": (0.44, 0.36, 0.29),
        "fabric": (0.69, 0.73, 0.74),
        "accent": (0.21, 0.31, 0.37),
    },
}
NAMES = {
    "wall": "墙面_乳胶漆",
    "wood": "木材_实木",
    "floor": "地板_拼接木纹",
    "fabric": "软装_织物",
    "accent": "软装_配色织物",
    "stone": "石材_细纹",
    "white": "陶瓷_暖白",
    "metal": "金属_拉丝黄铜",
    "glass": "玻璃_浅蓝",
    "leaf": "植物_叶片",
    "base": "建筑_炭黑",
    "dark": "细节_石墨",
    "soil": "植物_土壤",
}
SURFACES = {
    "wood": "wood",
    "floor": "planks",
    "fabric": "linen",
    "accent": "linen",
    "stone": "stone",
}


def material(name, color, roughness=0.6, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def palette_materials(style):
    colors = {
        **PALETTES[style],
        "stone": (0.76, 0.75, 0.70),
        "white": (0.90, 0.91, 0.88),
        "metal": (0.50, 0.39, 0.21),
        "glass": (0.26, 0.47, 0.51),
        "leaf": (0.18, 0.32, 0.13),
        "base": (0.055, 0.075, 0.077),
        "dark": (0.055, 0.065, 0.065),
        "soil": (0.09, 0.055, 0.03),
    }
    mats = {}
    for role, color in colors.items():
        roughness = (
            0.92
            if role in {"fabric", "accent"}
            else 0.42
            if role in {"wood", "floor"}
            else 0.63
        )
        if role in {"metal", "white", "glass"}:
            roughness = 0.25
        mat = material(NAMES[role], color, roughness, 0.78 if role == "metal" else 0)
        mat["asset_role"] = role
        mat["surface_category"] = {
            "wall": "walls",
            "floor": "floor",
            "fabric": "fabric",
            "accent": "fabric",
        }.get(role, "fixed")
        if role in SURFACES:
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            bsdf = nodes.get("Principled BSDF")
            for suffix, socket in [("color", "Base Color"), ("normal", "Normal")]:
                filename = (
                    f"{style}_{role}_color.png"
                    if suffix == "color"
                    else f"{SURFACES[role]}_normal.png"
                )
                path = TEXTURES / filename
                if not path.exists():
                    raise RuntimeError(f"材质贴图缺失：{path.name}，请先构建家具库")
                image = bpy.data.images.load(str(path), check_existing=True)
                tex = nodes.new("ShaderNodeTexImage")
                tex.image = image
                if suffix == "normal":
                    image.colorspace_settings.name = "Non-Color"
                    normal = nodes.new("ShaderNodeNormalMap")
                    normal.inputs["Strength"].default_value = (
                        0.3 if role in {"fabric", "accent"} else 0.22
                    )
                    links.new(tex.outputs["Color"], normal.inputs["Color"])
                    links.new(normal.outputs["Normal"], bsdf.inputs[socket])
                else:
                    links.new(tex.outputs["Color"], bsdf.inputs[socket])
        mats[role] = mat
    return mats


def manual_materials(mats):
    """人工微调的材质独立复制，避免修改一个房间影响全屋。"""
    finishes = {}
    for key, source, image_name in [
        ("oak", "floor", "natural_floor_color.png"),
        ("walnut", "floor", "modern_floor_color.png"),
        ("tile", "stone", "cream_stone_color.png"),
        ("stone", "stone", "modern_stone_color.png"),
    ]:
        mat = mats[source].copy()
        mat.name = "地板_微调_" + key
        mat["surface_category"] = "floor"
        for node in mat.node_tree.nodes:
            if (
                node.type == "TEX_IMAGE"
                and node.image
                and node.image.colorspace_settings.name != "Non-Color"
            ):
                node.image = bpy.data.images.load(
                    str(TEXTURES / image_name), check_existing=True
                )
        finishes[key] = mat
    for key, color in {
        "white": (0.88, 0.89, 0.85),
        "cream": (0.84, 0.78, 0.66),
        "sage": (0.52, 0.63, 0.49),
        "gray": (0.51, 0.56, 0.57),
    }.items():
        mat = material("墙面_微调_" + key, color)
        mat["surface_category"] = "walls"
        finishes["wall_" + key] = mat
    return finishes
