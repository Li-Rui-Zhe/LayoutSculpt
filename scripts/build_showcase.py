"""Author the interactive first-visit apartment, using the existing GLB pipeline.

This is an explicitly designed sample, not an AI recognition result. No Blender
or downloaded models are required. Re-run to reproduce its model and metadata.
"""

import json
import hashlib
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from shapely.geometry import Polygon, box as rectangle

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SHOWCASE_ID = "forest-home-v3"

from backend.app.architecture import validate_generated_structure
from backend.app.consistency import verify_export
from backend.app.glb_builder import Builder
from backend.app.schemas import Layout
from backend.app.schemas import Furnishing
from backend.app.quality import validate_generated_furnishing
from scripts.showcase_textiles import draped_throw, sofa_triangles
from scripts.showcase_finishes import travertine_texture, cushion_mesh, vessel_mesh, olive_tree


def points(x0, z0, x1, z1):
    return [{"x": x, "y": z} for x, z in [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]]


def document():
    rooms = [
        ("kitchen", "开放厨房", "kitchen", (0.12, 0.12, 3.0, 2.4), "tile"),
        ("dining", "餐厅", "dining", (3.0, 0.12, 5.88, 2.4), "oak"),
        ("living", "客厅", "living", (0.12, 2.4, 5.88, 7.08), "oak"),
        ("terrace", "花园露台", "balcony", (0.12, 7.28, 5.88, 9.48), "tile"),
        ("bedroom", "主卧", "bedroom", (6.12, 0.12, 9.48, 4.08), "oak"),
        ("study", "书房", "study", (6.12, 4.28, 9.48, 6.48), "oak"),
        ("bath", "浴室", "bathroom", (6.12, 6.68, 9.48, 8.48), "tile"),
    ]
    walls = [
        ("north", (0, 0), (9.6, 0), True, "cream"),
        ("west", (0, 0), (0, 7.18), True, "cream"),
        ("terrace_west", (0, 7.18), (0, 9.6), True, "cream"),
        ("terrace_east", (6, 8.6), (6, 9.6), True, "cream"),
        ("east", (9.6, 0), (9.6, 8.6), True, "cream"),
        ("south", (6, 8.6), (9.6, 8.6), True, "cream"),
        ("terrace_front", (0, 9.6), (6, 9.6), True, "cream"),
        ("spine", (6, 0), (6, 8.6), False, "cream"),
        ("bed_study", (6, 4.18), (9.6, 4.18), False, "sage"),
        ("study_bath", (6, 6.58), (9.6, 6.58), False, "cream"),
        ("terrace", (0, 7.18), (6, 7.18), False, "cream"),
    ]
    openings = []

    def opening(wall, kind, offset, width, bottom=0, height=2.35):
        openings.append(
            {
                "wall_id": wall,
                "kind": kind,
                "offset": offset,
                "width": width,
                "bottom": bottom,
                "height": height,
                "door_leaf": False,
            }
        )

    opening("north", "window", 0.55, 2.2, 1.1, 1.5)
    opening("north", "door", 3.15, 0.95)
    opening("north", "window", 6.55, 2.4, 0.35, 2.25)
    opening("west", "window", 2.85, 2.9, 0.45, 2.15)
    opening("east", "window", 4.55, 1.4, 0.75, 1.85)
    opening("east", "window", 7.0, 1.0, 1.3, 1.3)
    opening("spine", "door", 2.98, 0.85)
    opening("spine", "door", 5.6, 0.78)
    opening("spine", "door", 6.8, 0.85)
    opening("terrace", "passage", 0.65, 4.7)
    furniture = []

    def item(kind, name, room, x, z, w, d, h, rotation=0, elevation=0):
        furniture.append(
            {
                "kind": kind,
                "name": name,
                "room_id": room,
                "x": x,
                "y": z,
                "width": w,
                "depth": d,
                "height": h,
                "rotation": rotation,
                "elevation": elevation,
            }
        )

    item("counter", "嵌入水槽操作台", "kitchen", 1.15, 0.51, 1.95, 0.65, 0.9)
    item("refrigerator", "嵌入式冰箱", "kitchen", 2.58, 0.53, 0.62, 0.72, 1.95)
    item("bed", "亚麻软包大床", "bedroom", 7.82, 1.55, 1.85, 2.2, 1.08)
    item("cabinet", "床尾胡桃木矮柜", "bedroom", 8.0, 3.72, 2.3, 0.35, 0.58, 180)
    item("desk", "临窗工作台", "study", 9.08, 5.28, 1.65, 0.62, 0.76, 90)
    item("chair", "工作椅", "study", 8.3, 5.28, 0.52, 0.56, 0.85, 270)
    item("bookshelf", "胡桃木开放书架", "study", 7.02, 4.53, 1.45, 0.38, 1.65)
    # 借用北侧实墙安装花洒，左侧玻璃分隔干区；东侧窗前无实体板。
    # 正面朝南，距南墙净空 0.64 m，入口与窗户均可使用。
    item("shower_walk_in", "临窗步入式淋浴区", "bath", 8.86, 7.26, 1.16, 1.16, 2.1)
    item("sink", "悬浮洗手台", "bath", 6.8, 8.16, 1.0, 0.5, 0.82, 180)
    item("toilet", "一体裙包坐便器", "bath", 7.62, 7.11, 0.4, 0.68, 0.76)
    item("sofa", "亚麻模块沙发", "living", 1.25, 4.6, 3.0, 1.02, 0.86, 270)
    item("armchair", "胡桃木阅读椅", "living", 4.57, 3.62, 0.78, 0.8, 0.86, 35)
    item("tv_console", "格栅电视低柜", "living", 5.61, 4.68, 1.46, 0.4, 0.48, 90)
    item("wall_television", "超薄壁挂电视", "living", 5.8, 4.68, 1.24, 0.1, 0.71, 90, 0.93)
    for x in [4.15, 5.0]:
        item("chair", "弧面软包餐椅", "dining", x, 0.59, 0.46, 0.5, 0.8)
        item("chair", "弧面软包餐椅", "dining", x, 2.13, 0.46, 0.5, 0.8, 180)
    for name, room, x, z, h in [
        ("客厅琴叶榕", "living", 0.65, 6.5, 1.75),
        ("餐边绿植", "dining", 5.48, 0.6, 1.35),
        ("卧室绿植", "bedroom", 9.1, 3.12, 1.15),
        ("露台橄榄树", "terrace", 5.25, 8.9, 1.85),
        ("露台绿植", "terrace", 0.65, 8.95, 1.5),
    ]:
        item("plant", name, room, x, z, 0.55, 0.55, h)
    return {
        "title": "林间光庭 · 设计师私宅",
        "confidence": 1,
        "scale_note": "原创设计示例，尺寸单位为米；非上传图片识别结果。",
        "warnings": [],
        "outline": [{"x": x, "y": z} for x, z in [
            (-0.12, -0.12), (9.72, -0.12), (9.72, 8.72),
            (6.12, 8.72), (6.12, 9.72), (-0.12, 9.72)]],
        "rooms": [
            {
                "id": id,
                "name": name,
                "kind": kind,
                "polygon": points(*bounds),
                "floor_finish": finish,
            }
            for id, name, kind, bounds, finish in rooms
        ],
        "walls": [
            {
                "id": id,
                "start": {"x": a[0], "y": a[1]},
                "end": {"x": b[0], "y": b[1]},
                "thickness": 0.24 if exterior else 0.2,
                "height": 0.32 if id.startswith("terrace_") else 2.8,
                "exterior": exterior,
                "finish": finish,
            }
            for id, a, b, exterior, finish in walls
        ],
        "openings": openings,
        "lights": [],
        "furniture": furniture,
        "furniture_notes": [],
        "style": "natural",
        "furniture_mode": "library",
    }


def material(name, color, roughness=0.8, metal=0):
    return trimesh.visual.material.PBRMaterial(
        name=name,
        baseColorFactor=[*(round((c / 255) ** 2.2 * 255) for c in color), 255],
        roughnessFactor=roughness,
        metallicFactor=metal,
    )


def parquet_texture():
    """Seamless herringbone, authored at a believable scale with subtle grain."""
    y, x = np.mgrid[:1024, :1024]
    u, v = (x + y) / 64, (y - x) / 64
    a, b = np.floor(u).astype(int), np.floor(v).astype(int)
    horizontal = (a - b) % 8 < 4
    along, across = np.where(horizontal, u, v), np.where(horizontal, v, u)
    board = np.where(horizontal, b * 19 + (a - b) // 8, a * 23 + (b - a + 7) // 8)
    variation = np.sin(board * 78.233) * 0.035
    grain = np.sin(across * 95 + 0.4 * np.sin(along * 1.5)) * 0.012
    grain += np.sin(across * 238 + along * 3) * 0.005
    seams = (across % 1 < 0.014) | (
        np.where(horizontal, (a - b) % 8, (b - a + 7) % 8) == 0
    ) & (along % 1 < 0.014)
    factor = np.where(seams, 0.74, 1 + variation + grain)
    base = np.array([191, 165, 129])
    return Image.fromarray(np.clip(base * factor[..., None], 0, 255).astype(np.uint8))


class Showcase(Builder):
    def __init__(self, doc):
        super().__init__(doc, ROOT / "assets/furniture/catalog.json")
        self.materials["base"] = material("建筑_暖砂基座", [119, 113, 101])
        self.materials["fabric"] = material("软装_燕麦亚麻", [220, 211, 190], 0.95)
        self.materials["accent"] = material("软装_鼠尾草绿", [105, 126, 101], 0.94)
        self.materials["wood"] = material("木材_胡桃木", [100, 72, 48], 0.48)
        self.materials["stone"] = trimesh.visual.material.PBRMaterial(
            name="石材_细孔洞石", baseColorFactor=[255, 255, 255, 255],
            baseColorTexture=travertine_texture(), roughnessFactor=0.64, metallicFactor=0,
        )
        self.bronze = material("细节_古铜", [112, 95, 69], 0.34, 0.7)
        self.olive = material("细节_深橄榄", [67, 85, 63], 0.85)
        self.cream = material("软装_奶油绒", [237, 230, 213], 0.98)
        self.terracotta = material("软装_陶土", [173, 102, 70], 0.95)
        self.charcoal = material("细节_炭黑", [38, 43, 39], 0.45)
        self.paper = material("装饰_暖白纸", [242, 237, 222])
        self.materials["glass"] = trimesh.visual.material.PBRMaterial(
            name="玻璃_清透暖灰", baseColorFactor=[190, 210, 200, 32],
            alphaMode="BLEND", doubleSided=True, roughnessFactor=0.32, metallicFactor=0,
        )
        self.rug = material("软装_细织羊毛", [224, 215, 196], 1)
        self.rug.normalTexture = Image.open(ROOT / "public/materials/linen_normal.png").copy()
        self.materials["fabric"].normalTexture = Image.open(
            ROOT / "public/materials/linen_normal.png"
        ).copy()
        self.cream.normalTexture = self.materials["fabric"].normalTexture
        self.parquet = trimesh.visual.material.PBRMaterial(
            name="地板_人字拼橡木",
            baseColorFactor=[255, 255, 255, 255],
            baseColorTexture=parquet_texture(),
            roughnessFactor=0.72, metallicFactor=0,
        )

    def furniture(self, item, number):
        """Use the authored Blender assets, with their actual bounds and materials."""
        kind = item["kind"]
        if kind not in self.asset_cache:
            asset = olive_tree() if kind == "plant" else trimesh.load(
                self.catalog_path.parent / "glb" / f"{kind}.glb", force="scene")
            parts = []
            for index, node in enumerate(asset.graph.nodes_geometry):
                transform, geometry = asset.graph[node]
                key = f"showcase_{kind}_{index}"
                self.scene.geometry[key] = asset.geometry[geometry].copy()
                parts.append((key, transform))
            self.asset_cache[kind] = (asset.bounds, parts)
        bounds, parts = self.asset_cache[kind]
        extents = bounds[1] - bounds[0]
        origin = [(bounds[0, 0] + bounds[1, 0]) / 2, bounds[0, 1], (bounds[0, 2] + bounds[1, 2]) / 2]
        scale = np.diag([item["width"] / extents[0], item["height"] / extents[1], item["depth"] / extents[2], 1])
        placement = trimesh.transformations.translation_matrix(self.pos(item["x"], 0.035 + item.get("elevation", 0), item["y"]))
        rotation = trimesh.transformations.rotation_matrix(-math.radians(item["rotation"]), [0, 1, 0])
        normalize = trimesh.transformations.translation_matrix(-np.array(origin))
        for index, (key, transform) in enumerate(parts):
            self.scene.graph.update(
                frame_to=f"陈设_{number}_{index}", geometry=key,
                matrix=placement @ rotation @ scale @ normalize @ transform,
                metadata={"room_id": item["room_id"], "furniture_index": number - 1, "furniture_name": item["name"], "builtin_kind": kind},
            )
        self.instances.append({"kind": kind, "room_id": item["room_id"], "asset_id": "showcase_olive" if kind == "plant" else f"builtin_{kind}", "dimensions": [item["width"], item["depth"], item["height"]]})

    def add(self, name, mesh, role, transform=None, metadata=None, material=None):
        if role == "floor" and (material is None or material.name.endswith("_oak")):
            material = self.parquet
        super().add(name, mesh, role, transform, metadata, material)

    def open_rear_walls(self):
        """Keep the two backdrop walls in the sample's authored dollhouse view."""
        strips = []
        for center, size in [
            ([0, 1.4, -self.cz], [12, 3, 0.241]),
            ([-self.cx, 1.4, 0], [0.241, 3, 12]),
        ]:
            strip = trimesh.creation.box(extents=size)
            strip.apply_translation(center)
            strips.append(strip)
        backdrop = trimesh.boolean.union(strips, engine="manifold")
        for (_, node), edge in self.scene.graph.transforms.edge_data.items():
            meta = edge.get("metadata", {})
            if meta.get("cutaway_full"):
                full = self.scene.geometry[self.scene.graph[node][1]].copy()
                full.merge_vertices(merge_tex=True, merge_norm=True)
                retained = trimesh.boolean.intersection(
                    [full, backdrop], engine="manifold"
                )
                if not len(retained.faces):
                    continue
                old = meta["cutaway_geometry"]
                low = trimesh.Trimesh(
                    vertices=np.array(old["positions"]).reshape(-1, 3),
                    faces=np.array(old["indices"]).reshape(-1, 3),
                )
                preview = trimesh.boolean.union([low, retained], engine="manifold")
                meta["cutaway_geometry"] = {
                    "positions": np.round(preview.vertices, 6).reshape(-1).tolist(),
                    "indices": preview.faces.reshape(-1).tolist(),
                }
            if meta.get("wall_id") in {"north", "west"}:
                meta["cutaway_upper"] = False

    def pos(self, x, h, z):
        return [x - self.cx, h, z - self.cz]

    def block(
        self,
        name,
        x,
        z,
        w,
        d,
        h,
        level=0,
        role="wood",
        mat=None,
        radius=0.08,
        angle=0,
        metadata=None,
    ):
        radius = min(radius, w / 2 - 0.001, d / 2 - 0.001)
        shape = rectangle(
            -w / 2 + radius, -d / 2 + radius, w / 2 - radius, d / 2 - radius
        ).buffer(radius, quad_segs=6)
        mesh = trimesh.creation.extrude_polygon(shape, h, engine="earcut")
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
        )
        transform = trimesh.transformations.rotation_matrix(angle, [0, 1, 0])
        transform[:3, 3] = self.pos(x, level, z)
        self.add(name, mesh, role, transform, material=mat, metadata=metadata)

    def orb(self, name, x, z, h, radii, role="fabric", mat=None):
        mesh = trimesh.creation.icosphere(subdivisions=3)
        mesh.apply_scale(radii)
        self.smooth_detail(name, mesh, x, z, h, mat or self.materials[role])

    def smooth_detail(self, name, mesh, x, z, height, mat, angle=0):
        mesh.visual = trimesh.visual.TextureVisuals(
            uv=mesh.vertices[:, [0, 2]], material=mat)
        transform = trimesh.transformations.rotation_matrix(angle, [0, 1, 0])
        transform[:3, 3] = self.pos(x, height, z)
        self.scene.add_geometry(mesh, node_name=name, geom_name=name, transform=transform,
                                metadata={"decoration_kind": "showcase_detail"})

    def cushion(self, name, x, z, height, radii, mat, angle=0):
        self.smooth_detail(name, cushion_mesh(radii), x, z, height, mat, angle)

    def disc(self, name, x, z, radius, h, level, role="stone", metadata=None):
        self.cylinder(
            name, self.pos(x, level + h / 2, z), radius, h, role, metadata=metadata
        )

    def lamp(self, name, x, z, elevation, radius=0.18, lumens=300):
        shade = material("灯具_磨砂暖光", [247, 229, 194], 0.65)
        shade.emissiveFactor = [0.8, 0.52, 0.24]
        self.sphere(
            name,
            self.pos(x, elevation, z),
            [radius, radius * 0.8, radius],
            "white",
            metadata={
                "fixture_id": name,
                "fixture_kind": "floor_lamp",
                "fixture_lumens": lumens,
                "fixture_temperature": 3000,
                "fixture_enabled": True,
                "fixture_visual_placeholder": True,
                "fixture_cast_shadow": lumens >= 400 or name == "书房台灯",
            },
            material=shade,
        )

    def decorate(self):
        self.architectural_details()
        # Soft, rounded lounge anchors the entire apartment composition.
        self.block(
            "羊毛圆角地毯", 2.9, 4.55, 4.4, 3.55, 0.018, 0.05, "fabric", self.rug, 0.3
        )
        for z in [2.9, 6.2]:
            self.block("地毯细织镶边", 2.9, z, 3.82, 0.025, 0.003, 0.07, "fabric", self.cream, 0.008)
        # Preserve shared vertices and continuous UVs: architectural add() splits
        # every face and would turn soft cloth into a faceted sheet.
        cloth, uv = draped_throw(sofa_triangles(self.scene), self.cx, self.cz)
        throw = material("软装_鼠尾草针织毯", [139, 153, 132], 1)
        throw.normalTexture = self.rug.normalTexture
        cloth.visual = trimesh.visual.TextureVisuals(uv=uv, material=throw)
        self.scene.add_geometry(cloth, node_name="沙发垂落针织毯", geom_name="沙发垂落针织毯",
                                metadata={"decoration_kind": "sofa_throw"})
        self.block(
            "沙发贵妃躺位", 1.95, 5.6, 1.35, 0.89, 0.21, 0.28, "fabric", self.cream, 0.2
        )
        self.cushion("苔绿织物靠枕", 1.32, 3.42, 0.73, [0.12, 0.23, 0.23], self.olive, 0.12)
        self.cushion("陶土织物靠枕", 1.32, 5.55, 0.73, [0.12, 0.23, 0.24], self.terracotta, -0.12)
        self.disc("洞石茶几桌脚", 3.08, 4.68, 0.32, 0.32, 0.06)
        self.block(
            "洞石椭圆茶几", 3.08, 4.68, 1.35, 0.95, 0.10, 0.38, "stone", radius=0.43
        )
        self.disc("胡桃边几底座", 3.9, 5.4, 0.21, 0.26, 0.06, "wood")
        self.disc("胡桃边几桌面", 3.9, 5.4, 0.36, 0.055, 0.32, "wood")
        # The media panel fits between the two doors, leaving their routes open.
        self.block("电视墙洞石背板", 5.88, 4.68, 0.04, 1.54, 1.74, 0.06, "stone", radius=0.015)
        for z in np.linspace(3.94, 4.02, 3):
            self.block(
                "胡桃木格栅", 5.85, z, 0.035, 0.023, 1.7, 0.08, "wood", radius=0.008
            )
        # An island, ribbed base and stone countertop create a second focal point.
        self.block("岛台胡桃底座", 1.72, 1.95, 2.25, 0.7, 0.82, 0.06, radius=0.07)
        self.block(
            "岛台洞石台面", 1.72, 1.95, 2.45, 0.86, 0.075, 0.88, "stone", radius=0.12
        )
        for x in np.linspace(0.65, 2.8, 30):
            self.block(
                "岛台竖向细槽", x, 2.306, 0.023, 0.022, 0.73, 0.12, "wood", radius=0.008
            )
        # Oval dining table and four chairs, all with space to pull out.
        self.block("椭圆餐桌", 4.58, 1.36, 1.85, 0.9, 0.075, 0.74, "wood", radius=0.44)
        for x in [4.15, 5.0]:
            self.disc("餐桌柱脚", x, 1.36, 0.17, 0.69, 0.05, "wood")
            for z in [1.09, 1.63]:
                self.disc("亚麻餐垫", x, z, 0.17, 0.005, 0.816, "fabric")
                self.disc("手作陶瓷餐盘", x, z, 0.12, 0.012, 0.822, "white")
                self.disc("餐盘内沿", x, z, 0.095, 0.004, 0.835, "stone")
                self.disc("早餐咖啡杯", x + 0.22, z, 0.037, 0.06, 0.82, "white")
        # Restrained bedding, bedside objects, rugs and layered drapery.
        self.box("餐厅画框", self.pos(4.8, 1.72, 0.15), [1.1, 1.35, 0.05], "wood")
        self.box(
            "抽象画底纸",
            self.pos(4.8, 1.72, 0.18),
            [1.02, 1.27, 0.012],
            "fabric",
            material=self.paper,
        )
        self.orb(
            "陶土色块", 4.68, 0.195, 1.91, [0.27, 0.31, 0.009], mat=self.terracotta
        )
        self.box("画作苔绿色块", self.pos(4.95, 1.5, 0.2), [0.38, 0.5, 0.008], "accent")
        self.box("画作竖线", self.pos(4.66, 1.47, 0.21), [0.025, 0.46, 0.008], "dark")
        self.block(
            "主卧地毯", 7.82, 1.9, 2.55, 3.1, 0.015, 0.047, "fabric", self.paper, 0.12
        )
        for x in [6.58, 9.05]:
            self.disc("床头木墩", x, 0.75, 0.25, 0.44, 0.05, "wood")
            self.disc("床头台灯黄铜底座", x, 0.75, 0.07, 0.025, 0.49, "metal")
            self.block("床头台灯细杆", x, 0.75, 0.012, 0.012, 0.15, 0.515,
                       "metal", self.bronze, 0.004)
            glow = material("灯具_床头亚麻柔光", [245, 226, 191], 0.9)
            glow.emissiveFactor = [1, 0.7, 0.4]
            self.block(f"床头亚麻灯罩_{x}", x, 0.75, 0.27, 0.27, 0.14, 0.62,
                       "white", glow, 0.12, metadata={
                           "fixture_id": f"bedside_{x}", "fixture_kind": "table_lamp",
                           "fixture_lumens": 180, "fixture_temperature": 2700,
                           "fixture_enabled": True, "fixture_visual_placeholder": False,
                           "fixture_cast_shadow": False})
        for x in [6.35, 9.3]:
            for dx in np.linspace(-0.1, 0.1, 5):
                self.block(
                    "亚麻窗帘褶皱",
                    x + dx,
                    0.24,
                    0.055,
                    0.13,
                    2.35,
                    0.12,
                    "fabric",
                    self.cream,
                    0.025,
                )
        self.signature_details()
        # A terrace with slatted bench and handmade planters.
        self.block("露台长凳", 2.68, 9.03, 3.25, 0.52, 0.10, 0.42, "wood", radius=0.035)
        for x in [1.55, 3.8]:
            self.block("长凳支撑", x, 9.03, 0.12, 0.4, 0.37, 0.05, "wood", radius=0.02)
        # Small decor is modelled at real scale, not painted into a preview.
        for x, z, h in [
            (3.2, 4.65, 0.51),
            (4.7, 1.4, 0.85),
            (8.85, 5.62, 0.82),
        ]:
            self.disc("陶瓷花器", x, z, 0.075, 0.18, h, "white")
            for dx, dz in [(-0.07, 0.02), (0.04, 0.02), (0, -0.06)]:
                self.orb(
                    "花器枝叶", x + dx, z + dz, h + 0.31, [0.07, 0.16, 0.03], "leaf"
                )
        for i in range(3):
            self.block(
                "茶几画册",
                2.85,
                4.75,
                0.28,
                0.2,
                0.018,
                0.50 + i * 0.019,
                "fabric",
                self.paper if i % 2 else self.terracotta,
                0.008,
                i * 0.08,
            )
        self.disc("托盘", 3.9, 5.4, 0.17, 0.018, 0.38, "metal")
        self.disc("咖啡杯", 3.9, 5.4, 0.045, 0.065, 0.4, "white")
        # Proper fixtures; the bulbs remain inside the shades rather than hanging bare.
        for x in [1.15, 2.25]:
            self.lamp(f"岛台玻璃吊灯_{x}", x, 1.95, 2.05, 0.17, 290)
            self.block(
                "吊灯黄铜吊杆",
                x,
                1.95,
                0.012,
                0.012,
                0.42,
                2.2,
                "metal",
                radius=0.004,
                metadata={"fixture_visual_placeholder": True},
            )
        self.lamp("餐桌纸灯", 4.7, 1.42, 2.18, 0.32, 450)
        self.disc(
            "落地灯底座",
            0.55,
            2.85,
            0.19,
            0.035,
            0.05,
            "metal",
            metadata={"fixture_visual_placeholder": True},
        )
        self.block(
            "落地灯细杆",
            0.55,
            2.85,
            0.025,
            0.025,
            1.5,
            0.05,
            "metal",
            radius=0.008,
            metadata={"fixture_visual_placeholder": True},
        )
        self.lamp("书房台灯", 9.1, 4.75, 1.08, 0.12, 240)
        self.lamp("浴室壁灯", 6.8, 8.36, 1.4, 0.12, 240)

    def architectural_details(self):
        # Individual planks, seams and folds give the model detail at every zoom.
        for x in np.arange(0.22, 5.82, 0.145):
            self.block("露台防腐木地板", float(x), 8.38, 0.137, 2.17, 0.022, 0.045, "wood", radius=0.009,
                       metadata={"floor_room_id": "terrace"})
        for x in [0.75, 4.75]:
            self.block("露台陶土花箱", x, 9.24, 0.85, 0.38, 0.28, 0.07, "accent", self.terracotta, 0.05)
            self.block("花箱种植土", x, 9.24, 0.76, 0.29, 0.025, 0.345, "dark", self.charcoal, 0.03)
        # Curtains frame the living-room window without covering the view.
        for z in [2.69, 5.9]:
            for dz in np.linspace(-0.16, 0.16, 7):
                self.block("客厅落地亚麻帘", 0.22, z + dz, 0.14, 0.065, 2.48, 0.07, "fabric", self.cream, 0.025)
        # Low headboard panelling stays readable in both cutaway and full views.
        self.block("主卧整幅软包背景", 7.8, 0.2, 3.08, 0.06, 0.95, 0.12, "accent", radius=0.02)
        for x in np.linspace(6.35, 9.25, 20):
            self.block("床头细木格栅", float(x), 0.24, 0.018, 0.026, 0.89, 0.15, "wood", radius=0.006)
        # Kitchen backsplash and a visible appliance complete the cooking zone.
        self.block("厨房洞石挡水", 1.16, 0.14, 1.98, 0.035, 0.17, 0.93, "stone", radius=0.008)
        self.block("咖啡机机身", 1.92, 0.49, 0.25, 0.24, 0.28, 0.95, "dark", self.charcoal, 0.025)
        self.block("咖啡机金属前面板", 1.92, 0.617, 0.2, 0.016, 0.18, 1.02, "metal", radius=0.006)
        self.disc("咖啡机杯子", 1.92, 0.65, 0.035, 0.065, 0.95, "white")
        # Two slim picture ledges add depth to the wall above the sofa.
        for z in [6.13, 6.6]:
            self.block("客厅艺术画框", 0.16, z, 0.055, 0.37, 0.55, 1.35, "wood", radius=0.008)
            self.block("客厅艺术画底纸", 0.191, z, 0.012, 0.32, 0.50, 1.375, "fabric", self.paper, 0.004)
            self.orb("客厅艺术画色块", 0.202, z, 1.65, [0.008, 0.17, 0.1], "accent")
        # Bathroom mat and vanity objects, placed clear of the entrance.
        self.block("浴室棉麻脚垫", 8.05, 8.04, 0.7, 0.46, 0.014, 0.052, "fabric", self.cream, 0.06)
        for x in [6.46, 6.57]:
            self.disc("洗手台洗护瓶", x, 8.17, 0.025, 0.1, 0.86, "white")
        # Concealed warm strips are actual fixtures, not isolated floating bulbs.
        for name, x, z, width, depth, height, lumens in [
            ("床头氛围灯带", 7.8, 0.245, 2.9, 0.016, 1.08, 160),
            ("电视柜氛围灯带", 5.6, 4.68, 0.016, 1.25, 0.15, 90),
        ]:
            glow = material(name, [255, 224, 175])
            glow.emissiveFactor = [1, 0.66, 0.32]
            self.block(name, x, z, width, depth, 0.012, height, "white", glow, 0.003,
                       metadata={"fixture_id": name, "fixture_kind": "floor_lamp", "fixture_lumens": lumens,
                                 "fixture_temperature": 2700, "fixture_enabled": True,
                                 "fixture_visual_placeholder": False, "fixture_cast_shadow": False})

    def signature_details(self):
        # Open garden terrace: low stone plinth, clear glazing and fine bronze rails.
        # Real walls stay in document(); these transparent panels are finish details.
        glass = self.materials["glass"]
        for index in range(5):
            x = 0.12 + (index + 0.5) * 1.152
            self.block(f"露台清透玻璃_{index}", x, 9.6, 1.132, 0.016, 0.76, 0.33,
                       "glass", glass, 0.004)
        self.block("露台古铜扶手", 3.0, 9.6, 5.98, 0.035, 0.035, 1.09,
                   "metal", self.bronze, 0.009)
        self.block("露台侧面玻璃", 0, 8.4, 0.016, 2.34, 0.76, 0.33,
                   "glass", glass, 0.004)
        self.block("露台侧面扶手", 0, 8.4, 0.035, 2.4, 0.035, 1.09,
                   "metal", self.bronze, 0.009)
        self.block("露台东侧玻璃", 6, 9.1, 0.016, 0.96, 0.76, 0.33,
                   "glass", glass, 0.004)
        self.block("露台东侧扶手", 6, 9.1, 0.035, 1.0, 0.035, 1.09,
                   "metal", self.bronze, 0.009)
        self.disc("花园茶桌底座", 2.9, 8.12, 0.23, 0.31, 0.07, "stone")
        self.block("花园椭圆茶桌", 2.9, 8.12, 1.0, 0.60, 0.055, 0.38,
                   "stone", radius=0.28)
        self.disc("花园茶盘", 2.9, 8.12, 0.16, 0.012, 0.437, "wood")
        self.disc("花园茶杯", 2.98, 8.12, 0.032, 0.055, 0.45, "white")
        # A sculptural water bowl nestles beside the planting, clear of the main route.
        bowl = trimesh.creation.revolve(np.array([
            [0.12, 0], [0.24, 0.06], [0.37, 0.23], [0.38, 0.25],
            [0.35, 0.25], [0.29, 0.16], [0.12, 0.04], [0.12, 0],
        ]), sections=64)
        bowl.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
        self.smooth_detail("庭院石钵", bowl, 0.75, 8.05, 0.07, self.materials["stone"])
        water = trimesh.creation.cylinder(radius=0.30, height=0.007, sections=64)
        water.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
        water_mat = material("庭院_静水", [69, 99, 89], 0.18, 0.28)
        self.smooth_detail("庭院静水", water, 0.75, 8.05, 0.26, water_mat)
        for x in [0.08, 1.25, 2.42, 3.59, 4.76, 5.92]:
            self.block("栏杆古铜细立柱", x, 9.6, 0.022, 0.026, 0.79, 0.32,
                       "metal", self.bronze, 0.006)
        # A low lounge bench with squared linen pads, layered planting and garden lamps.
        for x in [1.62, 2.68, 3.74]:
            self.cushion(f"露台亚麻坐垫_{x}", x, 9.02, 0.56, [0.49, 0.055, 0.24], self.cream)
        self.cushion("露台橄榄靠垫", 1.62, 9.2, 0.76, [0.23, 0.21, 0.09], self.olive)
        self.cushion("露台陶土靠垫", 3.74, 9.2, 0.76, [0.23, 0.21, 0.09], self.terracotta)
        rng = np.random.default_rng(29)
        greens = [material(f"庭院叶色_{i}", rgb) for i, rgb in enumerate(
            ([65, 88, 54], [88, 110, 65], [117, 131, 81]))]
        for side in [0.75, 4.75]:
            for i in range(22):
                x, z = side + rng.uniform(-0.35, 0.35), 9.24 + rng.uniform(-0.12, 0.12)
                h = rng.uniform(0.49, 0.69)
                self.orb(f"花箱层叠绿叶_{side}_{i}", x, z, h,
                         [0.07, 0.13, 0.06], mat=greens[i % 3])
        for x in [0.28, 5.72]:
            self.block("庭院矮灯底座", x, 7.5, 0.10, 0.10, 0.34, 0.05,
                       "metal", self.charcoal, 0.015)
            glow = material("灯具_庭院柔光", [255, 232, 189])
            glow.emissiveFactor = [1, 0.68, 0.32]
            self.block(f"庭院灯_{x}", x, 7.5, 0.075, 0.075, 0.09, 0.30,
                       "white", glow, 0.01, metadata={
                           "fixture_id": f"garden_{x}", "fixture_kind": "floor_lamp",
                           "fixture_lumens": 85, "fixture_temperature": 2700,
                           "fixture_enabled": True, "fixture_visual_placeholder": False,
                           "fixture_cast_shadow": False})
        # Real floor lamp: the diffuser is visible; no floating helper bulbs.
        self.disc("阅读落地灯圆盘", 0.55, 2.48, 0.20, 0.025, 0.05, "metal")
        self.block("阅读落地灯铜杆", 0.55, 2.48, 0.018, 0.018, 1.5, 0.065,
                   "metal", self.bronze, 0.006)
        shade = trimesh.creation.revolve(np.array([
            [0.04, 0], [0.10, -0.015], [0.20, -0.08], [0.29, -0.18],
            [0.29, -0.195], [0.20, -0.095], [0.10, -0.03], [0.04, -0.015],
        ]), sections=48)
        shade.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
        self.smooth_detail("阅读落地灯雕塑灯罩", shade, 0.55, 2.48, 1.67, self.bronze)
        glow = material("灯具_阅读磨砂罩", [249, 237, 214])
        glow.emissiveFactor = [1, 0.71, 0.4]
        self.block("阅读灯柔光面", 0.55, 2.48, 0.44, 0.44, 0.015, 1.475,
                   "white", glow, 0.21, metadata={
                       "fixture_id": "reading_lamp", "fixture_kind": "floor_lamp",
                       "fixture_lumens": 420, "fixture_temperature": 2700,
                       "fixture_enabled": True, "fixture_visual_placeholder": False,
                       "fixture_cast_shadow": False})
        # Stone vanity backsplash and an actual reflective, round-topped mirror.
        self.block("浴室洞石背墙", 6.8, 8.455, 1.16, 0.022, 1.78, 0.12,
                   "stone", radius=0.01, metadata={"cutaway_upper": True})
        from shapely.geometry import Point
        arch = rectangle(-0.32, 0, 0.32, 0.55).union(Point(0, 0.55).buffer(0.32, quad_segs=24))
        mirror = trimesh.creation.extrude_polygon(arch, 0.012, engine="earcut")
        mirror_mat = material("镜面_暖银", [210, 220, 214], 0.11, 0.94)
        self.add("浴室拱形镜", mirror, "metal",
                 trimesh.transformations.translation_matrix(self.pos(6.8, 1.06, 8.42)),
                 material=mirror_mat, metadata={"cutaway_upper": True})
        # Sculpted ceramic accents, authored geometry instead of flat colour blocks.
        for name, x, z, height in [("岛台手作花瓶", 1.8, 1.95, 0.958),
                                   ("床尾陶器", 7.42, 3.72, 0.62)]:
            vase = vessel_mesh()
            vase.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
            self.smooth_detail(name, vase, x, z, height, self.terracotta)
        # Kitchen thin brass toe-kick and bookshelf accents give depth at close range.
        self.block("岛台铜色踢脚", 1.72, 2.295, 2.08, 0.018, 0.035, 0.09,
                   "metal", self.bronze, 0.006)
        self.block("书房皮革桌垫", 9.08, 5.28, 0.47, 0.9, 0.006, 0.802,
                   "fabric", self.olive, 0.025)
        self.block("书房合上的画册", 9.05, 5.75, 0.25, 0.19, 0.025, 0.812,
                   "fabric", self.paper, 0.008, angle=0.08)

    def export(self, output):
        def extras(tree):
            tree.setdefault("extras", {})["showcase"] = SHOWCASE_ID
            for mat in tree.get("materials", []):
                name = mat.get("name", "")
                category = (
                    "walls"
                    if name.startswith("墙面")
                    else "floor"
                    if name.startswith("地板")
                    else "fabric"
                    if name.startswith("软装")
                    else None
                )
                if category:
                    mat["extras"] = {"surface_category": category}
                if "normalTexture" in mat:
                    mat["normalTexture"]["scale"] = 0.12

        output.write_bytes(
            self.scene.export(file_type="glb", tree_postprocessor=extras)
        )


if __name__ == "__main__":
    output = ROOT / "data" / "showcase"
    output.mkdir(parents=True, exist_ok=True)
    doc = document()
    layout = Layout.model_validate(
        {k: v for k, v in doc.items() if k in Layout.model_fields}
    )
    validate_generated_structure(layout)
    validate_generated_furnishing(Furnishing(items=doc["furniture"], notes=[]), layout)
    scene = Showcase(doc)
    scene.build(output)
    scene.open_rear_walls()
    scene.decorate()
    path = ROOT / f"public/models/{SHOWCASE_ID}.glb"
    candidate = output / "showcase.glb"
    scene.export(candidate)
    proof = verify_export(doc, candidate)
    path.write_bytes(candidate.read_bytes())
    metadata = {
        "id": SHOWCASE_ID,
        "title": doc["title"],
        "area": round(Polygon(
            [(p["x"], p["y"]) for p in doc["outline"]]).area, 1),
        "room_count": len(doc["rooms"]),
        "source": "authored_sample",
        "model_url": f"/models/{SHOWCASE_ID}.glb",
        "revision": hashlib.sha256(candidate.read_bytes()).hexdigest()[:12],
        "description": "洞石与胡桃木 · 花园露台 · 艺廊客餐厅 · 温润光影",
        "geometry_verified": proof["geometry_verified"],
    }
    (ROOT / f"public/models/{SHOWCASE_ID}.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (ROOT / "frontend/src/showcase.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output / "layout.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output / "consistency.json").write_text(
        json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({**metadata, "bytes": path.stat().st_size}, ensure_ascii=False))
