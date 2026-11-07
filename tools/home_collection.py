"""家庭家具系列：目录定义与可复现的原创网格，单位米、Y 向上、正面 +Z。"""

import math
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial

from tools.furniture_refinement import piping, plate, refined, soft
from tools.home_office import equipment
from tools.household_essentials import SPECS as ESSENTIAL_SPECS
from tools.household_essentials import household

ROOT = Path(__file__).resolve().parents[1]
VERSION = "3.4.0"

# key, 中文名, 放置类型, 空间, 品类, 款式, 宽深高, 造型, 配色
SPECS = [
    (
        "sofa",
        "云屿分段软包三人沙发",
        "sofa",
        "客厅",
        "沙发",
        "三人直排",
        (2.3, 0.95, 0.88),
        "sofa",
        "linen",
    ),
    (
        "sofa_compact",
        "奶油双人小户型沙发",
        "sofa",
        "客厅",
        "沙发",
        "双人直排",
        (1.65, 0.86, 0.82),
        "sofa",
        "cream",
    ),
    (
        "sofa_chaise_left",
        "云屿左贵妃转角沙发",
        "sofa",
        "客厅",
        "沙发",
        "左贵妃 · 面对沙发",
        (2.85, 1.65, 0.88),
        "sofa_left",
        "linen",
    ),
    (
        "sofa_chaise_right",
        "云屿右贵妃转角沙发",
        "sofa",
        "客厅",
        "沙发",
        "右贵妃 · 面对沙发",
        (2.85, 1.65, 0.88),
        "sofa_right",
        "linen",
    ),
    (
        "sofa_modular",
        "云团四人模块沙发",
        "sofa",
        "客厅",
        "沙发",
        "四人模块",
        (3.2, 1.02, 0.80),
        "sofa",
        "cream",
    ),
    (
        "sofa_daybed",
        "原木软垫休闲日床",
        "sofa",
        "客厅",
        "沙发",
        "低木架 · 后倾靠背",
        (2.1, 0.95, 0.78),
        "daybed",
        "cream",
    ),
    (
        "ottoman",
        "圆角布艺脚凳",
        "bench",
        "客厅",
        "休闲座椅",
        "配套脚凳",
        (0.72, 0.56, 0.42),
        "ottoman",
        "linen",
    ),
    (
        "lounge_chair",
        "奶油围合休闲椅",
        "armchair",
        "客厅",
        "休闲座椅",
        "软包围合",
        (0.84, 0.86, 0.80),
        "lounge",
        "cream",
    ),
    (
        "coffee_table",
        "岩板双层圆角茶几",
        "coffee_table",
        "客厅",
        "茶几与边几",
        "双层长方",
        (1.1, 0.62, 0.42),
        "coffee",
        "stone",
    ),
    (
        "coffee_round",
        "原木圆盘茶几",
        "coffee_table",
        "客厅",
        "茶几与边几",
        "圆形",
        (0.85, 0.85, 0.38),
        "round",
        "oak",
    ),
    (
        "coffee_nested",
        "高低错落双圆茶几",
        "coffee_table",
        "客厅",
        "茶几与边几",
        "组合双几",
        (1.2, 0.72, 0.43),
        "nested",
        "stone",
    ),
    (
        "side_c_table",
        "沙发 C 形边几",
        "side_table",
        "客厅",
        "茶几与边几",
        "C 形边几",
        (0.42, 0.36, 0.62),
        "c_table",
        "oak",
    ),
    (
        "tv_console",
        "悬浮感格栅电视柜",
        "tv_console",
        "客厅",
        "电视柜",
        "格栅两抽",
        (1.8, 0.40, 0.52),
        "slatted",
        "oak",
    ),
    (
        "tv_console_long",
        "雾白长款电视柜",
        "tv_console",
        "客厅",
        "电视柜",
        "长款三抽",
        (2.4, 0.42, 0.48),
        "lowcab",
        "cream",
    ),
    (
        "bed",
        "栖木分片软包双人床",
        "bed",
        "卧室",
        "床",
        "1.8 米双人",
        (1.8, 2.1, 1.1),
        "bed",
        "linen",
    ),
    (
        "bed_queen",
        "暖灰软包双人床",
        "bed",
        "卧室",
        "床",
        "1.5 米双人",
        (1.5, 2.05, 1.05),
        "bed",
        "linen",
    ),
    (
        "bed_single",
        "原木软包单人床",
        "bed",
        "卧室",
        "床",
        "1.2 米单人",
        (1.2, 2.05, 0.95),
        "bed",
        "sage",
    ),
    (
        "bed_platform",
        "原木低台榻榻米床",
        "bed",
        "卧室",
        "床",
        "低台床",
        (1.8, 2.12, 0.65),
        "platform",
        "cream",
    ),
    (
        "bed_bunk",
        "原木护栏上下床",
        "bed",
        "儿童房",
        "床",
        "上下铺",
        (1.10, 2.05, 1.8),
        "bunk",
        "oak",
    ),
    (
        "bed_kids",
        "圆角儿童成长床",
        "bed",
        "儿童房",
        "床",
        "儿童单人",
        (1.05, 1.9, 0.82),
        "bed",
        "sage",
    ),
    (
        "crib",
        "暖白浅木通透婴儿床",
        "bed",
        "儿童房",
        "床",
        "婴儿床",
        (0.78, 1.4, 1.03),
        "crib",
        "oak",
    ),
    (
        "cabinet",
        "原木分缝双门衣柜",
        "cabinet",
        "卧室",
        "衣柜",
        "双开门",
        (1.6, 0.60, 2.15),
        "wardrobe",
        "oak",
    ),
    (
        "wardrobe_sliding",
        "雾白双移门衣柜",
        "cabinet",
        "卧室",
        "衣柜",
        "双移门",
        (1.8, 0.63, 2.2),
        "sliding",
        "cream",
    ),
    (
        "wardrobe_three",
        "原木三门衣柜",
        "cabinet",
        "卧室",
        "衣柜",
        "三开门",
        (2.1, 0.6, 2.2),
        "wardrobe3",
        "oak",
    ),
    (
        "chest_drawers",
        "胡桃木五斗柜",
        "cabinet",
        "卧室",
        "斗柜与床头柜",
        "五斗柜",
        (0.80, 0.45, 1.1),
        "chest",
        "walnut",
    ),
    (
        "nightstand",
        "原木双抽床头柜",
        "nightstand",
        "卧室",
        "斗柜与床头柜",
        "双抽款",
        (0.48, 0.40, 0.52),
        "drawers",
        "oak",
    ),
    (
        "nightstand_slim",
        "小户型窄款床头柜",
        "nightstand",
        "卧室",
        "斗柜与床头柜",
        "窄款双抽",
        (0.32, 0.36, 0.50),
        "drawers",
        "cream",
    ),
    (
        "vanity",
        "圆镜抽屉梳妆台",
        "desk",
        "卧室",
        "梳妆台",
        "圆镜款",
        (0.95, 0.45, 1.38),
        "vanity",
        "oak",
    ),
    (
        "table",
        "圆角实木四人餐桌",
        "table",
        "餐厅",
        "餐桌",
        "四人长桌",
        (1.5, 0.85, 0.76),
        "table",
        "oak",
    ),
    (
        "table_six",
        "胡桃木六人长餐桌",
        "table",
        "餐厅",
        "餐桌",
        "六人长桌",
        (1.8, 0.90, 0.76),
        "table",
        "walnut",
    ),
    (
        "table_round",
        "圆柱底座四人圆餐桌",
        "table",
        "餐厅",
        "餐桌",
        "单柱底座 · 四人圆桌",
        (1.1, 1.1, 0.75),
        "pedestal_table",
        "oak",
    ),
    (
        "table_compact",
        "小户型双人方餐桌",
        "table",
        "餐厅",
        "餐桌",
        "双人方桌",
        (0.8, 0.8, 0.75),
        "table",
        "oak",
    ),
    (
        "bar_stool",
        "实木软包吧椅",
        "chair",
        "餐厅",
        "餐椅",
        "高脚吧椅",
        (0.46, 0.46, 0.94),
        "stool",
        "linen",
    ),
    (
        "dining_bench",
        "实木软包双人餐凳",
        "bench",
        "餐厅",
        "餐椅",
        "双人长凳",
        (1.2, 0.38, 0.46),
        "bench",
        "linen",
    ),
    (
        "sideboard",
        "原木岩板餐边柜",
        "cabinet",
        "餐厅",
        "餐边柜",
        "双门双抽",
        (1.4, 0.42, 0.85),
        "sideboard",
        "oak",
    ),
    (
        "desk",
        "原木双抽工作书桌",
        "desk",
        "书房",
        "书桌",
        "双抽书桌",
        (1.3, 0.62, 0.76),
        "desk",
        "oak",
    ),
    (
        "desk_standing",
        "双电机升降办公桌",
        "desk",
        "书房",
        "书桌",
        "升降桌 · 坐姿",
        (1.4, 0.70, 0.75),
        "standing",
        "oak",
    ),
    (
        "desk_corner",
        "L 形转角工作桌",
        "desk",
        "书房",
        "书桌",
        "一体木桌板 · 方管脚架",
        (1.5, 1.2, 0.75),
        "corner",
        "oak",
    ),
    (
        "desk_compact",
        "窄型小户型书桌",
        "desk",
        "书房",
        "书桌",
        "窄型书桌",
        (0.9, 0.48, 0.75),
        "desk",
        "oak",
    ),
    (
        "office_chair",
        "人体工学网背办公椅",
        "chair",
        "书房",
        "办公椅",
        "网背扶手",
        (0.64, 0.64, 1.12),
        "office",
        "charcoal",
    ),
    (
        "bookcase_low",
        "儿童开放绘本收纳柜",
        "bookshelf",
        "儿童房",
        "书柜与收纳架",
        "低矮绘本柜",
        (1.0, 0.32, 0.85),
        "shelf",
        "oak",
    ),
    (
        "bookcase_wide",
        "通顶分格书柜",
        "bookshelf",
        "书房",
        "书柜与收纳架",
        "宽款开放",
        (1.4, 0.32, 2.1),
        "shelf",
        "walnut",
    ),
    (
        "toy_storage",
        "圆角玩具收纳柜",
        "cabinet",
        "儿童房",
        "书柜与收纳架",
        "收纳盒款",
        (1.2, 0.36, 0.76),
        "toys",
        "oak",
    ),
    (
        "kids_table",
        "圆角儿童活动桌",
        "table",
        "儿童房",
        "儿童桌椅",
        "活动桌",
        (0.8, 0.6, 0.52),
        "table",
        "oak",
    ),
    (
        "kids_chair",
        "实木儿童靠背椅",
        "chair",
        "儿童房",
        "儿童桌椅",
        "儿童靠背椅",
        (0.34, 0.36, 0.58),
        "kids_chair",
        "sage",
    ),
    (
        "entry_tall",
        "窄深玄关高鞋柜",
        "shoe_cabinet",
        "玄关",
        "玄关收纳",
        "高柜",
        (0.8, 0.32, 1.9),
        "wardrobe",
        "cream",
    ),
    (
        "entry_console",
        "抽屉玄关置物台",
        "cabinet",
        "玄关",
        "玄关收纳",
        "玄关台",
        (1.0, 0.30, 0.82),
        "console",
        "walnut",
    ),
    (
        "coat_rack",
        "实木枝形落地衣帽架",
        "model",
        "玄关",
        "衣帽架与镜子",
        "独立衣帽架",
        (0.52, 0.52, 1.72),
        "coat",
        "oak",
    ),
    (
        "floor_mirror",
        "圆角落地穿衣镜",
        "model",
        "卧室",
        "衣帽架与镜子",
        "支架穿衣镜",
        (0.60, 0.4, 1.65),
        "mirror",
        "oak",
    ),
    (
        "kitchen_island",
        "岩板收纳厨房岛台",
        "counter",
        "厨房",
        "厨房柜体",
        "独立岛台",
        (1.4, 0.8, 0.90),
        "island",
        "oak",
    ),
    (
        "pantry",
        "分层厨房食品高柜",
        "cabinet",
        "厨房",
        "厨房柜体",
        "食品高柜",
        (0.60, 0.6, 2.1),
        "pantry",
        "cream",
    ),
    (
        "fridge_four",
        "四门分区家用冰箱",
        "refrigerator",
        "厨房",
        "冰箱",
        "四门款",
        (0.90, 0.70, 1.85),
        "fridge",
        "steel",
    ),
    (
        "laundry_tower",
        "叠放洗衣烘干机组",
        "washing_machine",
        "阳台",
        "洗衣与清洁",
        "洗烘叠放",
        (0.65, 0.68, 1.75),
        "laundry",
        "cream",
    ),
    (
        "utility_sink",
        "一体洗衣盆收纳柜",
        "sink",
        "阳台",
        "洗衣与清洁",
        "洗衣盆柜",
        (0.80, 0.60, 0.90),
        "utility",
        "cream",
    ),
    (
        "cleaning_cabinet",
        "阳台家政清洁高柜",
        "cabinet",
        "阳台",
        "洗衣与清洁",
        "家政高柜",
        (0.70, 0.55, 1.9),
        "wardrobe",
        "cream",
    ),
    (
        "drying_rack",
        "不锈钢 X 型双杆落地晾衣架",
        "model",
        "阳台",
        "洗衣与清洁",
        "X 型双杆晾衣架",
        (1.6, 0.72, 1.65),
        "hanging_rack",
        "steel",
    ),
    (
        "drying_rack_single",
        "伸缩单杆落地晾衣架",
        "model",
        "阳台",
        "晾衣架",
        "单杆晾衣架",
        (1.6, 0.55, 1.65),
        "single_rack",
        "steel",
    ),
    (
        "desktop_computer",
        "台式电脑显示器主机键鼠套装",
        "model",
        "书房",
        "电脑",
        "台式电脑套装",
        (0.94, 0.48, 0.49),
        "desktop",
        "charcoal",
    ),
    (
        "laptop",
        "轻薄笔记本电脑（展开）",
        "model",
        "书房",
        "电脑",
        "笔记本电脑",
        (0.35, 0.27, 0.245),
        "laptop",
        "steel",
    ),
    (
        "balcony_table",
        "户外圆形小茶桌",
        "table",
        "阳台",
        "阳台休闲",
        "圆形小桌",
        (0.60, 0.60, 0.68),
        "round",
        "oak",
    ),
    (
        "balcony_chair",
        "木条阳台休闲椅",
        "armchair",
        "阳台",
        "阳台休闲",
        "木条扶手椅",
        (0.62, 0.70, 0.82),
        "outdoor",
        "oak",
    ),
    (
        "bath_tall",
        "浴室窄型收纳高柜",
        "cabinet",
        "卫浴",
        "浴室收纳",
        "窄型高柜",
        (0.35, 0.32, 1.6),
        "pantry",
        "cream",
    ),
]

LEGACY = {
    "armchair": ("客厅", "休闲座椅", "木扶手款"),
    "side_table": ("客厅", "茶几与边几", "圆盘边几"),
    "television": ("客厅", "电视", "55 英寸支架款"),
    "wall_television": ("客厅", "电视", "55 英寸壁挂款"),
    "chair": ("餐厅", "餐椅", "弧面软包款"),
    "bookshelf": ("书房", "书柜与收纳架", "窄款开放"),
    "shoe_cabinet": ("玄关", "玄关收纳", "百叶矮柜"),
    "bench": ("玄关", "玄关收纳", "换鞋凳"),
    "counter": ("厨房", "厨房柜体", "直排地柜"),
    "refrigerator": ("厨房", "冰箱", "双门款"),
    "dishwasher": ("厨房", "厨房电器", "独立洗碗机"),
    "oven": ("厨房", "厨房电器", "台柜式烤箱"),
    "washing_machine": ("阳台", "洗衣与清洁", "洗烘一体"),
    "sink": ("卫浴", "浴室柜", "台盆款"),
    "toilet": ("卫浴", "坐便器", "一体裙包"),
    "bathtub": ("卫浴", "浴缸", "独立椭圆"),
    "shower": ("卫浴", "淋浴", "封闭淋浴房"),
    "shower_walk_in": ("卫浴", "淋浴", "单屏步入式"),
    "shower_open": ("卫浴", "淋浴", "开放花洒"),
    "plant": ("装饰", "绿植与地毯", "橄榄树"),
    "rug": ("装饰", "绿植与地毯", "编织流苏"),
}

COLORS = {
    "oak": [190, 157, 114],
    "paint": [237, 233, 222],
    "walnut": [98, 68, 48],
    "linen": [199, 190, 172],
    "cream": [232, 225, 209],
    "sage": [139, 158, 140],
    "charcoal": [48, 57, 59],
    "steel": [163, 174, 177],
    "stone": [222, 216, 202],
    "white": [240, 239, 232],
    "brass": [169, 138, 83],
    "dark": [38, 44, 45],
    "mirror": [154, 178, 184],
    "terracotta": [186, 123, 100],
    "aluminum": [195, 201, 207],
    "screen": [38, 91, 128],
    "screen_light": [94, 168, 192],
    "keycap": [66, 72, 80],
}


@lru_cache(maxsize=24)
def material(role):
    kwargs = {
        "name": f"家居系列_{role}",
        "baseColorFactor": [*COLORS[role], 255],
        "roughnessFactor": 0.8 if role in {"linen", "cream", "sage"} else 0.45,
        "metallicFactor": 0.75 if role in {"steel", "brass", "mirror", "aluminum"} else 0,
    }
    texture = {
        "oak": "veneer_color.png",
        "walnut": "veneer_color.png",
        "linen": "natural_fabric_color.png",
        "cream": "cream_fabric_color.png",
        "sage": "natural_fabric_color.png",
        "stone": "stone_color.png",
    }.get(role)
    if texture:
        with Image.open(ROOT / "public/materials" / texture) as im:
            kwargs["baseColorTexture"] = im.copy()
        if role not in {"sage", "oak", "walnut", "stone"}:
            kwargs["baseColorFactor"] = [255] * 4
        normal_file = {
            "oak": "veneer",
            "walnut": "veneer",
            "stone": "stone",
            "linen": "woven",
            "cream": "woven",
            "sage": "woven",
        }[role]
        with Image.open(ROOT / "public/materials" / f"{normal_file}_normal.png") as im:
            # 256px 微表面足以表现近景，避免为每个家具嵌入大贴图。
            normal = np.asarray(
                im.convert("RGB").resize((256, 256)), dtype=float
            ).copy()
        normal[:, :, :2] = 128 + (normal[:, :, :2] - 128) * 0.3
        kwargs["normalTexture"] = Image.fromarray(normal.clip(0, 255).astype(np.uint8))
        kwargs["roughnessFactor"] = {
            "oak": 0.58,
            "walnut": 0.53,
            "stone": 0.62,
            "linen": 0.94,
            "cream": 0.92,
            "sage": 0.94,
        }[role]
    scanned = "wood" if role in {"oak", "walnut"} else "fabric" if role in {"linen", "cream", "sage"} else None
    if scanned:
        folder = ROOT / "assets/materials/pbr"
        for slot, suffix in [("baseColorTexture", "color.jpg"), ("normalTexture", "normal.png"), ("metallicRoughnessTexture", "roughness.png")]:
            with Image.open(folder / f"{scanned}_{suffix}") as image:
                kwargs[slot] = image.copy()
                if suffix.endswith("jpg"):
                    kwargs[slot].format = "JPEG"
        kwargs["baseColorFactor"] = [*COLORS[role], 255]
        kwargs["roughnessFactor"] = 1.0
    if role == "mirror":
        kwargs["roughnessFactor"] = 0.12
    if role in {"screen", "screen_light"}:
        kwargs.update(roughnessFactor=0.22, emissiveFactor=[0.025, 0.055, 0.075])
    return PBRMaterial(**kwargs)


SPECS.extend(ESSENTIAL_SPECS)


class FurnitureMesh:
    def __init__(self):
        self.scene = trimesh.Scene()

    def add(self, name, mesh, role, smooth=False):
        if not smooth:
            # 分离尖锐边，圆柱侧面和倒角连续着色，平面不会被抹成鼓包。
            mesh = trimesh.graph.smooth_shade(mesh, angle=math.radians(50))
        normals = mesh.vertex_normals[mesh.faces].reshape(-1, 3).copy()
        mesh.unmerge_vertices()
        mesh.vertex_normals = normals
        uv = np.zeros((len(mesh.vertices), 2))
        for axis in range(3):
            faces = mesh.faces[
                np.argmax(abs(mesh.face_normals), axis=1) == axis
            ].reshape(-1)
            scale = 4 if role in {"linen", "cream", "sage"} else 1.25
            uv[faces] = mesh.vertices[faces][:, [(1, 2), (0, 2), (0, 1)][axis]] * scale
        mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material(role))
        # 只焊接所有属性一致的顶点，保留硬边和 UV 接缝，不做减面。
        mesh.merge_vertices(digits_vertex=8, digits_norm=8, digits_uv=8)
        unique = f"{name}_{len(self.scene.geometry)}"
        self.scene.add_geometry(mesh, node_name=unique, geom_name=unique)

    def box(self, name, p, size, role="oak", radius=0.015):
        size = np.asarray(size)
        r = min(radius, size.min() * 0.46)
        if r > 0:
            sphere = trimesh.creation.icosphere(subdivisions=2)
            v = sphere.vertices
            mesh = trimesh.convex.convex_hull(v * r + np.sign(v) * (size / 2 - r))
        else:
            mesh = trimesh.creation.box(extents=size)
        mesh.apply_translation(p)
        self.add(name, mesh, role)

    def soft(self, name, p, size, role="linen", radius=0.05):
        soft(self, name, p, size, role)

    def plate(self, name, p, size, role="oak", radius=0.1):
        plate(self, name, p, size, role, radius)

    def rod(self, name, a, b, radius=0.02, role="oak"):
        self.add(
            name,
            trimesh.creation.cylinder(radius=radius, segment=[a, b], sections=24),
            role,
        )

    def bar_pull(self, name, x, y, face_z, length=0.12, reach=0.017):
        left, right = x - length / 2, x + length / 2
        bar_z = face_z + reach
        self.rod(name, [left, y, bar_z], [right, y, bar_z], 0.007, "brass")
        for mount in (left + 0.009, right - 0.009):
            self.rod("拉手固定脚", [mount, y, face_z - 0.003], [mount, y, bar_z], 0.0048, "brass")

    def disk(self, name, p, radius, height, role="oak"):
        bevel = min(0.008, height * 0.2, radius * 0.1)
        profile = [
            [0, -height / 2],
            [radius - bevel, -height / 2],
            [radius, -height / 2 + bevel],
            [radius, height / 2 - bevel],
            [radius - bevel, height / 2],
            [0, height / 2],
        ]
        mesh = trimesh.creation.revolve(profile, sections=48)
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
        )
        mesh.apply_translation(p)
        self.add(name, mesh, role)

    def legs(self, w, d, h, role="oak", bottom=0, inset=0.06, center_z=0):
        for x in [-w / 2 + inset, w / 2 - inset]:
            for z in [-d / 2 + inset, d / 2 - inset]:
                self.rod(
                    "锥形支脚",
                    [x, bottom, z + center_z],
                    [x * 0.94, bottom + h, z * 0.94 + center_z],
                    0.023,
                    role,
                )

    def cabinet(self, w, d, h, role, mode):
        role = "paint" if role == "cream" else role
        foot = 0.1 if h < 1.3 else 0.055
        self.legs(w, d, foot, "dark")
        sliding = mode == "sliding"
        case_z, case_depth = (-0.026, d - 0.068) if sliding else (0, d - 0.025)
        self.box("柜体", [0, (h + foot) / 2, case_z], [w, h - foot, case_depth], role, 0.014)
        self.box(
            "内缩踢脚", [0, foot / 2, 0], [w - 0.09, foot, d - 0.08], "dark", 0.006
        )
        drawers = mode in {"chest", "drawers"}
        count = (
            5
            if mode == "chest"
            else 2
            if mode == "drawers"
            else 3
            if mode in {"wardrobe3", "lowcab"}
            else 2
        )
        for i in range(count):
            if drawers:
                height = (h - foot - 0.03) / count
                width = w - 0.02
                x = 0
                y = foot + 0.015 + (i + 0.5) * height
            else:
                height = h - foot - 0.026
                width = (w - 0.02) / count
                x = -w / 2 + 0.01 + (i + 0.5) * width
                y = (h + foot) / 2
            if mode == "sideboard":
                height -= 0.20
                y -= 0.10
                self.box(
                    "上层抽屉",
                    [x, h - 0.105, d / 2 - 0.005],
                    [width - 0.006, 0.18, 0.025],
                    role,
                    0.006,
                )
                self.bar_pull("抽屉拉手", x, h - 0.105, d / 2 + 0.0075)
            if sliding:
                track_z = d / 2 - (0.015 if i == 0 else 0.043)
                self.box("前轨移门" if i == 0 else "后轨移门", [x, y, track_z], [width + 0.014, height, 0.024], role, 0.004)
                grip_x = x + (-1 if i == 0 else 1) * width * 0.38
                self.box("移门窄边指扣", [grip_x, y, track_z + 0.011], [0.014, 0.112, 0.004], "charcoal", 0.003)
                continue
            self.box(
                "独立门板" if not drawers else "抽屉面板",
                [x, y, d / 2 - 0.005],
                [width - 0.006, height - 0.007, 0.025],
                role,
                0.006,
            )
            if mode == "slatted":
                for xx in np.linspace(
                    x - width / 2 + 0.025,
                    x + width / 2 - 0.025,
                    max(3, int(width / 0.035)),
                ):
                    self.box(
                        "格栅木条",
                        [xx, y, d / 2 + 0.011],
                        [0.014, height - 0.02, 0.016],
                        role,
                        0.004,
                    )
            else:
                hx = x if drawers else x + width * 0.32
                self.bar_pull("拉手", hx, y + (height * 0.32 if drawers else 0), d / 2 + 0.0075)
        if sliding:
            for y in [foot + 0.013, h - 0.013]:
                self.box(
                    "上下双轨槽",
                    [0, y, d / 2 - 0.031],
                    [w - 0.012, 0.016, 0.064],
                    "steel",
                    0.003,
                )


def construct(spec):
    *_, (w, d, h), shape, role = spec
    m = FurnitureMesh()
    if household(m, spec) or equipment(m, spec) or refined(m, spec):
        pass
    elif shape in {"sofa", "sofa_left", "sofa_right", "lounge"}:
        seats = 1 if shape == "lounge" else 4 if w > 3 else 3 if w > 2.15 else 2
        arm = 0.13 if w < 2 else 0.18
        seat_d = min(d, 0.95)
        back_z = -d / 2 + 0.10
        m.legs(w, seat_d, 0.14, "dark", center_z=-d / 2 + seat_d / 2)
        m.box(
            "承重底座",
            [0, 0.21, -d / 2 + seat_d / 2],
            [w - 0.09, 0.18, seat_d - 0.02],
            role,
            0.065,
        )
        for i in range(seats):
            sw = (w - 2 * arm) / seats
            x = -w / 2 + arm + (i + 0.5) * sw
            chaise = (shape == "sofa_left" and i == 0) or (
                shape == "sofa_right" and i == seats - 1
            )
            sd = d - 0.16 if chaise else seat_d - 0.19
            if chaise:
                m.box(
                    "贵妃承托", [x, 0.21, 0.03], [sw - 0.01, 0.18, d - 0.10], role, 0.06
                )
                for xx in [x - sw * 0.35, x + sw * 0.35]:
                    m.rod(
                        "贵妃前支脚",
                        [xx, 0, d / 2 - 0.10],
                        [xx, 0.14, d / 2 - 0.10],
                        0.025,
                        "dark",
                    )
            m.soft(
                "独立坐垫",
                [x, 0.40, -d / 2 + 0.16 + sd / 2],
                [sw - 0.018, 0.22, sd],
                role,
                0.07,
            )
            piping(m, "坐垫缝线", [x, .49, -d / 2 + .16 + sd / 2], sw-.03, sd-.025, role, radius=.06, thickness=.0018)
            m.soft(
                "软包靠垫",
                [x, (h + 0.48) / 2, back_z],
                [sw - 0.014, h - 0.48, 0.23],
                role,
                0.09,
            )
        for x in [-w / 2 + arm / 2, w / 2 - arm / 2]:
            m.box(
                "扶手",
                [x, 0.43, -d / 2 + seat_d / 2],
                [arm, 0.52, seat_d],
                role,
                0.06,
            )
        if seats > 1:
            m.soft(
                "抱枕",
                [-w * 0.26, 0.64, -d / 2 + 0.30],
                [0.31, 0.30, 0.12],
                "sage" if role != "sage" else "cream",
                0.055,
            )
    elif shape in {
        "wardrobe",
        "wardrobe3",
        "sliding",
        "drawers",
        "chest",
        "slatted",
        "lowcab",
        "sideboard",
        "island",
        "pantry",
    }:
        m.cabinet(
            w, d, h - 0.025 if shape in {"sideboard", "island"} else h, role, shape
        )
        if shape in {"sideboard", "island"}:
            m.box("岩板台面", [0, h - 0.013, 0], [w, 0.026, d], "stone", 0.012)
        if shape == "pantry":
            for yy in [0.30, 0.64, 0.98]:
                m.box(
                    "分层门缝",
                    [0, yy * h / 1.6, d / 2 + 0.018],
                    [w - 0.035, 0.006, 0.004],
                    "dark",
                    0,
                )
    elif shape in {
        "table",
        "desk",
        "console",
        "standing",
        "vanity",
    }:
        table_h = 0.75 if shape == "vanity" else h
        if shape == "standing":
            for x in [-w * 0.35, w * 0.35]:
                m.box("T 型脚", [x, 0.026, 0], [0.086, 0.052, d * 0.88], "white", 0.012)
                m.box("伸缩柱外管", [x, 0.229, 0], [0.078, 0.36, 0.078], "white", 0.007)
                m.box("伸缩柱内管", [x, (0.380 + h - 0.070) / 2, 0], [0.058, h - 0.450, 0.058], "aluminum", 0.004)
                m.box("桌板承托臂", [x, h - 0.071, 0], [0.110, 0.048, d * 0.65], "white", 0.006)
            m.box("升降横梁", [0, h - 0.095, 0], [w * 0.76, 0.057, 0.069], "dark", 0.008)
            m.box(
                "控制面板",
                [w * 0.28, h - 0.064, d / 2 - 0.029],
                [0.12, 0.036, 0.038],
                "dark",
                0.005,
            )
        else:
            m.legs(
                w,
                d,
                table_h - 0.044,
                "oak",
                inset=0.09,
            )
            leg_x = (w / 2 - 0.09) * 0.94
            leg_z = (d / 2 - 0.09) * 0.94
            for z in [-leg_z, leg_z]:
                m.box("桌面下横围板", [0, table_h - 0.077, z], [2 * leg_x + 0.020, 0.062, 0.027], role, 0.005)
            for x in [-leg_x, leg_x]:
                m.box("桌面下侧围板", [x, table_h - 0.077, 0], [0.027, 0.062, 2 * leg_z + 0.020], role, 0.005)
        m.plate(
            "圆角台面",
            [0, table_h - 0.025, 0],
            [w, 0.05, d],
            role,
            0.10,
        )
        if shape in {"desk", "console", "vanity"}:
            for x in [-w / 4, w / 4]:
                m.box(
                    "抽屉",
                    [x, table_h - 0.12, 0],
                    [w / 2 - 0.045, 0.15, d - 0.06],
                    "oak",
                    0.009,
                )
                m.bar_pull("抽屉拉手", x, table_h - 0.12, d / 2 - 0.03, length=0.14, reach=0.023)
        if shape == "vanity":
            m.rod(
                "镜框支架",
                [0, 0.75, -d / 2 + 0.035],
                [0, h - 0.27, -d / 2 + 0.035],
                0.022,
                "brass",
            )
            for rad, zz, mat in [
                (0.28, -d / 2 + 0.06, "oak"),
                (0.254, -d / 2 + 0.083, "mirror"),
            ]:
                m.rod(
                    "圆镜",
                    [0, h - 0.28, zz - 0.018],
                    [0, h - 0.28, zz + 0.018],
                    rad,
                    mat,
                )
    elif shape == "outdoor":
        seat_y = 0.425
        side_x = w * 0.38
        m.legs(w, d, seat_y - 0.008, inset=0.063)
        for x in [-side_x, side_x]:
            m.box("坐面侧框", [x, seat_y - 0.027, 0], [0.043, 0.049, d * 0.84], "oak", 0.007)
            m.rod("后腿延伸靠背", [x, seat_y - 0.05, -d * 0.34], [x, h - 0.037, -d * 0.43], 0.023, "oak")
            m.box("圆边扶手", [x, 0.622, -d * 0.016], [0.061, 0.036, d * 0.88], "oak", 0.010)
            m.rod("扶手前撑", [x, seat_y - 0.021, d * 0.34], [x, 0.624, d * 0.34], 0.019, "oak")
        for z in [-d * 0.36, d * 0.36]:
            m.box("坐面横框", [0, seat_y - 0.026, z], [w * 0.80, 0.047, 0.039], "oak", 0.007)
        slat_depth = d * 0.76 / 6
        for i in range(6):
            m.box("分体排水座板", [0, seat_y, (i - 2.5) * slat_depth], [w * 0.81, 0.026, slat_depth - 0.009], "oak", 0.007)
        for i in range(4):
            y = seat_y + 0.083 + i * 0.088
            z = -d * (0.34 + 0.09 * (y - seat_y + 0.05) / (h - 0.037 - seat_y + 0.05))
            m.box("排缝靠背板", [0, y, z], [w * 0.86, 0.059, 0.033], "oak", 0.006)
    elif shape in {"ottoman", "bench", "stool", "kids_chair"}:
        sh = (
            h
            if shape in {"ottoman", "bench"}
            else 0.65
            if shape == "stool"
            else 0.30
            if shape == "kids_chair"
            else 0.43
        )
        m.legs(w, d, sh - 0.08, inset=0.065)
        m.box("座面", [0, sh - 0.055, 0], [w, 0.11, d], role, 0.045)
        if shape in {"stool", "kids_chair"}:
            for x in [-w * 0.38, w * 0.38]:
                m.rod(
                    "靠背立柱",
                    [x, sh - 0.033, -d * 0.385],
                    [x, h - 0.06, -d * 0.385],
                    0.022,
                    "oak",
                )
            m.box("靠背横板", [0, sh + 0.10, -d * 0.385], [w * 0.91, 0.085, 0.045], "oak", 0.015)
            if shape == "stool":
                for z in [-d * 0.36, d * 0.36]:
                    m.rod(
                        "脚踏",
                        [-w * 0.38, 0.22, z],
                        [w * 0.38, 0.22, z],
                        0.016,
                        "steel",
                    )
                for x in [-w * 0.35, w * 0.35]:
                    m.rod("实木脚侧撑", [x, 0.265, -d * 0.35], [x, 0.265, d * 0.35], 0.012, "oak")
    elif shape in {"shelf", "toys"}:
        m.box("背板", [0, h / 2, -d / 2 + 0.013], [w, h, 0.026], role, 0.006)
        for x in [-w / 2 + 0.015, w / 2 - 0.015]:
            m.box("侧板", [x, h / 2, 0], [0.03, h, d], role, 0.01)
        rows = 2 if h < 1 else 5
        shelves = np.linspace(0.035, h - 0.018, rows + 1)
        for yy in shelves:
            m.box("层板", [0, yy, 0], [w, 0.03, d], role, 0.008)
        for xx in [-w / 6, w / 6]:
            m.box("竖隔板", [xx, h / 2, 0], [0.026, h, d - 0.02], role, 0.008)
        if shape == "toys":
            for i, x in enumerate([-w / 3, 0, w / 3]):
                for shelf in shelves[:-1]:
                    yy = shelf + 0.014
                    m.box(
                        "彩色收纳盒",
                        [x, yy + 0.12, 0.01],
                        [w / 3 - 0.045, 0.24, d - 0.035],
                        ["sage", "cream", "terracotta"][i],
                        0.025,
                    )
                    m.box(
                        "提手槽",
                        [x, yy + 0.16, d / 2 - 0.006],
                        [0.07, 0.02, 0.005],
                        "dark",
                        0.006,
                    )
        else:
            for i in range(5):
                book_h = 0.16 + 0.019 * (i % 3)
                m.box(
                    "书脊",
                    [-w * 0.43 + i * 0.032, shelves[1] + 0.014 + book_h / 2, -0.017],
                    [0.027, book_h, d * 0.63],
                    ["sage", "cream", "terracotta"][i % 3],
                    0.003,
                )
    elif shape == "office":
        for a in np.linspace(0, 2 * math.pi, 5, endpoint=False):
            x, z = math.cos(a) * w * 0.44, math.sin(a) * d * 0.44
            m.rod("五星脚", [0, 0.18, 0], [x, 0.071, z], 0.025, "dark")
            m.box("脚轮支架", [x, 0.057, z], [0.029, 0.052, 0.029], "charcoal", 0.004)
            axis = np.array([-math.sin(a), 0, math.cos(a)])
            hub = np.array([x, 0.033, z])
            m.rod("脚轮横轴", hub - axis * 0.025, hub + axis * 0.025, 0.009, "steel")
            for side in [-1, 1]:
                m.rod("双轮轮胎", hub + side * axis * 0.013, hub + side * axis * 0.028, 0.033, "dark")
        m.disk("气压柱", [0, 0.3, 0], 0.035, 0.3, "steel")
        m.box("座下托板", [0, 0.445, -0.014], [w * 0.62, 0.046, d * 0.55], "charcoal", 0.010)
        m.soft("坐垫", [0, 0.48, 0], [w * 0.82, 0.10, d * 0.80], "charcoal", 0.045)
        for x in [-w * 0.43, w * 0.43]:
            m.rod("座下扶手连接", [x * 0.64, 0.446, 0.015], [x, 0.467, 0.015], 0.017, "dark")
            m.rod("扶手支架", [x, 0.459, 0.015], [x, 0.67, 0.015], 0.019, "dark")
            m.box("扶手垫", [x, 0.68, 0], [0.07, 0.035, 0.26], "dark", 0.016)
        back_bottom, back_top = 0.535, 1.018
        back_low_z, back_high_z = -d * 0.35, -d * 0.44
        frame_x = w * 0.35
        m.rod("椅背承力支架", [0, 0.445, -d * 0.19], [0, 0.615, -d * 0.375], 0.029, "charcoal")
        for x in [-frame_x, frame_x]:
            m.rod("倾斜靠背侧框", [x, back_bottom, back_low_z], [x, back_top, back_high_z], 0.018, "dark")
        for y, z in [(back_bottom, back_low_z), (back_top, back_high_z)]:
            m.rod("靠背横框", [-frame_x, y, z], [frame_x, y, z], 0.018, "dark")
        for x in np.linspace(-frame_x, frame_x, 24)[1:-1]:
            m.rod("网面纵丝", [x, back_bottom, back_low_z], [x, back_top, back_high_z], 0.00165, "charcoal")
        for y in np.linspace(back_bottom, back_top, 22)[1:-1]:
            z = np.interp(y, [back_bottom, back_top], [back_low_z, back_high_z])
            m.rod("网面横丝", [-frame_x, y, z + 0.001], [frame_x, y, z + 0.001], 0.0015, "charcoal")
        lumbar_z = np.interp(0.635, [back_bottom, back_top], [back_low_z, back_high_z])
        m.rod("腰托横向支撑", [-frame_x, 0.635, lumbar_z], [frame_x, 0.635, lumbar_z], 0.012, "dark")
        m.box("弧边腰托", [0, 0.635, lumbar_z + 0.012], [w * 0.48, 0.076, 0.030], "charcoal", 0.013)
        m.soft(
            "头枕", [0, h - 0.055, back_high_z], [w * 0.42, 0.11, 0.08], "charcoal", 0.03
        )
    elif shape == "coat":
        m.disk("圆盘底座", [0, 0.025, 0], w / 2, 0.05, "oak")
        m.rod("立杆", [0, 0.025, 0], [0, h, 0], 0.028, "oak")
        for a, yy in [(0, 1.20), (2.1, 1.40), (4.2, 1.55), (1, 1.02)]:
            m.rod(
                "挂衣枝",
                [0, yy, 0],
                [math.cos(a) * 0.22, yy + 0.13, math.sin(a) * 0.22],
                0.018,
                "oak",
            )
    elif shape == "mirror":
        m.box("实木镜框", [0, h / 2, 0.14], [w, h, 0.045], "oak", 0.02)
        m.box("镜面", [0, h / 2, 0.169], [w - 0.07, h - 0.07, 0.009], "mirror", 0.004)
        for x in [-w * 0.38, w * 0.38]:
            m.rod("后支撑", [x, h * 0.72, 0.12], [x, 0.01, -d * 0.50], 0.02, "oak")
    elif shape == "fridge":
        m.box("机身", [0, h / 2, 0], [w, h, d - 0.04], "steel", 0.035)
        for x in [-w / 4, w / 4]:
            for yy, hh in [(h * 0.69, h * 0.60), (h * 0.195, h * 0.37)]:
                m.box(
                    "独立冰箱门",
                    [x, yy, d / 2 - 0.014],
                    [w / 2 - 0.009, hh, 0.045],
                    "steel",
                    0.018,
                )
                m.box(
                    "嵌入拉手",
                    [x, yy - hh * 0.36, d / 2 + 0.010],
                    [w * 0.32, 0.02, 0.005],
                    "dark",
                    0.004,
                )
        m.box(
            "温控显示",
            [w * 0.22, h * 0.78, d / 2 + 0.012],
            [0.11, 0.05, 0.008],
            "dark",
            0.004,
        )
    elif shape == "laundry":
        for level in range(2):
            yy = level * h / 2
            m.box(
                "洗烘机身",
                [0, yy + h / 4, 0],
                [w, h / 2 - 0.016, d - 0.035],
                "white",
                0.022,
            )
            m.rod(
                "门圈",
                [0, yy + h * 0.23, d / 2 - 0.01],
                [0, yy + h * 0.23, d / 2 + 0.014],
                w * 0.32,
                "steel",
            )
            m.rod(
                "深色观察窗",
                [0, yy + h * 0.23, d / 2 + 0.014],
                [0, yy + h * 0.23, d / 2 + 0.026],
                w * 0.268,
                "dark",
            )
            m.rod(
                "旋钮",
                [-w * 0.26, yy + h * 0.43, d / 2],
                [-w * 0.26, yy + h * 0.43, d / 2 + 0.027],
                0.024,
                "steel",
            )
            m.box(
                "显示屏",
                [w * 0.18, yy + h * 0.43, d / 2],
                [0.18, 0.045, 0.02],
                "dark",
                0.005,
            )
        m.box("叠放连接板", [0, h / 2, 0], [w, 0.025, d], "steel", 0.005)
    elif shape == "utility":
        m.cabinet(w, d, h - 0.16, "cream", "wardrobe")
        for x in [-w / 2 + 0.055, w / 2 - 0.055]:
            m.box("盆侧沿", [x, h - 0.06, 0], [0.11, 0.12, d], "white", 0.025)
        for z in [-d / 2 + 0.065, d / 2 - 0.055]:
            m.box("盆前后沿", [0, h - 0.06, z], [w, 0.12, 0.11], "white", 0.024)
        m.box("盆内底", [0, h - 0.145, 0], [w - 0.16, 0.035, d - 0.15], "white", 0.013)
        m.rod(
            "水龙头", [0, h - 0.12, -d * 0.36], [0, h + 0.10, -d * 0.36], 0.017, "steel"
        )
        m.rod(
            "出水弯头",
            [0, h + 0.10, -d * 0.36],
            [0, h + 0.10, -d * 0.06],
            0.017,
            "steel",
        )
    else:
        raise ValueError(f"未实现的家具形状: {shape}")
    # Normalize the actual decorative envelope to the promised catalogue size.
    bounds = m.scene.bounds
    transform = np.eye(4)
    transform[:3, 3] = -np.array(
        [
            (bounds[0, 0] + bounds[1, 0]) / 2,
            bounds[0, 1],
            (bounds[0, 2] + bounds[1, 2]) / 2,
        ]
    )
    scale = np.eye(4)
    scale[0, 0], scale[1, 1], scale[2, 2] = np.array([w, h, d]) / (
        bounds[1] - bounds[0]
    )
    m.scene.apply_transform(scale @ transform)
    return m.scene
