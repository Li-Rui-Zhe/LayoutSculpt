"""Author the interactive first-visit apartment, using the existing GLB pipeline.

This is an explicitly designed sample, not an AI recognition result. No Blender
or downloaded models are required. Re-run to reproduce its model and metadata.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from shapely.geometry import box as rectangle

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.architecture import validate_generated_structure
from backend.app.consistency import verify_export
from backend.app.glb_builder import Builder
from backend.app.schemas import Layout


def points(x0, z0, x1, z1):
    return [{"x": x, "y": z} for x, z in [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]]


def document():
    rooms = [
        ("kitchen", "开放厨房", "kitchen", (0.12, 0.12, 3.0, 2.4), "tile"),
        ("dining", "餐厅", "dining", (3.0, 0.12, 5.88, 2.4), "oak"),
        ("living", "客厅", "living", (0.12, 2.4, 5.88, 7.08), "oak"),
        ("terrace", "绿植露台", "balcony", (0.12, 7.28, 5.88, 8.48), "tile"),
        ("bedroom", "主卧", "bedroom", (6.12, 0.12, 9.48, 4.08), "oak"),
        ("study", "书房", "study", (6.12, 4.28, 9.48, 6.48), "oak"),
        ("bath", "浴室", "bathroom", (6.12, 6.68, 9.48, 8.48), "tile"),
    ]
    walls = [
        ("north", (0, 0), (9.6, 0), True, "cream"),
        ("west", (0, 0), (0, 8.6), True, "cream"),
        ("east", (9.6, 0), (9.6, 8.6), True, "cream"),
        ("south", (0, 8.6), (9.6, 8.6), True, "cream"),
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
    opening("south", "window", 0.4, 5.2, 0.4, 2.2)
    opening("spine", "door", 3.0, 0.95)
    opening("spine", "door", 5.2, 1.0)
    opening("spine", "door", 6.8, 0.85)
    opening("terrace", "passage", 0.65, 4.7)
    furniture = []

    def item(kind, name, room, x, z, w, d, h, rotation=0):
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
            }
        )

    item("counter", "嵌入水槽操作台", "kitchen", 1.45, 0.51, 2.5, 0.65, 0.9)
    item("refrigerator", "嵌入式冰箱", "kitchen", 0.52, 1.65, 0.7, 0.72, 1.95, 90)
    item("bed", "亚麻软包大床", "bedroom", 7.82, 1.55, 1.85, 2.2, 1.08)
    item("cabinet", "床尾胡桃木矮柜", "bedroom", 8.0, 3.72, 2.3, 0.35, 0.58, 180)
    item("desk", "临窗工作台", "study", 9.08, 5.28, 1.65, 0.62, 0.76, 270)
    item("chair", "工作椅", "study", 8.3, 5.28, 0.52, 0.56, 0.85, 270)
    item("cabinet", "书房边柜", "study", 6.85, 4.55, 1.15, 0.36, 0.8)
    item("bathtub", "独立浴缸", "bath", 8.55, 7.65, 1.5, 0.8, 0.58, 90)
    item("sink", "悬浮洗手台", "bath", 6.8, 8.16, 1.0, 0.5, 0.82, 180)
    item("toilet", "壁挂坐便", "bath", 6.72, 7.1, 0.46, 0.65, 0.72)
    for name, room, x, z, h in [
        ("客厅琴叶榕", "living", 0.65, 6.5, 1.75),
        ("餐边绿植", "dining", 5.48, 0.6, 1.35),
        ("卧室绿植", "bedroom", 9.08, 3.5, 1.15),
        ("露台橄榄树", "terrace", 5.25, 7.9, 1.65),
        ("露台绿植", "terrace", 0.65, 7.95, 1.3),
    ]:
        item("plant", name, room, x, z, 0.55, 0.55, h)
    return {
        "title": "林间暖居 · 设计示例",
        "confidence": 1,
        "scale_note": "原创设计示例，尺寸单位为米；非上传图片识别结果。",
        "warnings": [],
        "outline": points(-0.12, -0.12, 9.72, 8.72),
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
                "height": 2.8,
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
    variation = np.sin(board * 78.233) * 0.06
    grain = np.sin(across * 95 + 0.4 * np.sin(along * 1.5)) * 0.012
    grain += np.sin(across * 238 + along * 3) * 0.005
    seams = (across % 1 < 0.014) | (
        np.where(horizontal, (a - b) % 8, (b - a + 7) % 8) == 0
    ) & (along % 1 < 0.014)
    factor = np.where(seams, 0.74, 1 + variation + grain)
    base = np.array([178, 149, 108])
    return Image.fromarray(np.clip(base * factor[..., None], 0, 255).astype(np.uint8))


class Showcase(Builder):
    def __init__(self, doc):
        super().__init__(doc, ROOT / "assets/furniture/catalog.json")
        self.materials["base"] = material("建筑_暖砂基座", [184, 174, 153])
        self.materials["fabric"] = material("软装_燕麦亚麻", [220, 211, 190], 0.95)
        self.materials["accent"] = material("软装_鼠尾草绿", [105, 126, 101], 0.94)
        self.materials["wood"] = material("木材_胡桃木", [114, 81, 51], 0.56)
        self.materials["stone"] = material("石材_洞石", [215, 202, 174])
        self.cream = material("软装_奶油绒", [237, 230, 213], 0.98)
        self.terracotta = material("软装_陶土", [173, 102, 70], 0.95)
        self.charcoal = material("细节_炭黑", [38, 43, 39], 0.45)
        self.paper = material("装饰_暖白纸", [242, 237, 222])
        self.materials["fabric"].normalTexture = Image.open(
            ROOT / "public/materials/linen_normal.png"
        ).copy()
        self.cream.normalTexture = self.materials["fabric"].normalTexture
        self.parquet = trimesh.visual.material.PBRMaterial(
            name="地板_人字拼橡木",
            baseColorFactor=[255, 255, 255, 255],
            baseColorTexture=parquet_texture(),
            roughnessFactor=0.72,
        )

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
        self.add(
            name,
            mesh,
            role,
            trimesh.transformations.translation_matrix(self.pos(x, h, z)),
            material=mat,
        )

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
        # Soft, rounded lounge anchors the entire apartment composition.
        self.block(
            "羊毛圆角地毯", 2.9, 4.55, 4.4, 3.55, 0.018, 0.05, "fabric", self.paper, 0.3
        )
        self.furniture(
            {
                "kind": "sofa",
                "name": "亚麻模块沙发",
                "room_id": "living",
                "x": 1.3,
                "y": 4.5,
                "width": 3.2,
                "depth": 1.05,
                "height": 0.9,
                "rotation": 270,
            },
            5000,
        )
        self.block(
            "沙发贵妃躺位", 1.95, 5.6, 1.35, 0.89, 0.21, 0.28, "fabric", self.cream, 0.2
        )
        self.orb("苔绿靠枕", 1.32, 3.42, 0.73, [0.16, 0.24, 0.25], "accent")
        self.orb("陶土靠枕", 1.32, 5.55, 0.73, [0.16, 0.23, 0.26], mat=self.terracotta)
        self.disc("洞石茶几桌脚", 3.08, 4.68, 0.32, 0.32, 0.06)
        self.block(
            "洞石椭圆茶几", 3.08, 4.68, 1.35, 0.95, 0.10, 0.38, "stone", radius=0.43
        )
        self.disc("胡桃边几底座", 3.9, 5.4, 0.21, 0.26, 0.06, "wood")
        self.disc("胡桃边几桌面", 3.9, 5.4, 0.36, 0.055, 0.32, "wood")
        self.block(
            "阅读椅座垫",
            4.78,
            3.78,
            0.86,
            0.86,
            0.28,
            0.25,
            "accent",
            self.terracotta,
            radius=0.24,
        )
        self.orb(
            "阅读椅弧背", 5.06, 3.78, 0.7, [0.19, 0.4, 0.45], "accent", self.terracotta
        )
        self.disc("阅读椅底座", 4.78, 3.78, 0.27, 0.18, 0.05, "wood")
        # Floating low media cabinet and quiet fluted walnut panel.
        self.block("悬浮电视柜", 5.55, 4.9, 0.42, 1.9, 0.34, 0.18, "wood", radius=0.035)
        for z in np.linspace(4.04, 5.76, 20):
            self.block(
                "胡桃木格栅", 5.83, z, 0.04, 0.045, 1.5, 0.08, "wood", radius=0.008
            )
        self.block(
            "电视屏幕", 5.75, 4.9, 0.035, 1.3, 0.7, 0.69, "dark", self.charcoal, 0.01
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
        self.block("椭圆餐桌", 4.7, 1.42, 1.6, 0.95, 0.075, 0.74, "wood", radius=0.45)
        for x in [4.3, 5.1]:
            self.disc("餐桌柱脚", x, 1.42, 0.17, 0.69, 0.05, "wood")
        for x, z, rotation in [
            (4.3, 0.55, 180),
            (5.1, 0.55, 180),
            (4.3, 2.28, 0),
            (5.1, 2.28, 0),
        ]:
            self.furniture(
                {
                    "kind": "chair",
                    "name": "弧背餐椅",
                    "room_id": "dining",
                    "x": x,
                    "y": z,
                    "width": 0.46,
                    "depth": 0.5,
                    "height": 0.8,
                    "rotation": rotation,
                },
                100 + self.node_index,
            )
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
            self.lamp(f"卧室磨砂台灯_{x}", x, 0.75, 0.67, 0.14, 180)
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
        # A terrace with slatted bench and handmade planters.
        self.block("露台长凳", 2.68, 8.03, 2.8, 0.47, 0.10, 0.42, "wood", radius=0.035)
        for x in [1.55, 3.8]:
            self.block("长凳支撑", x, 8.03, 0.12, 0.4, 0.37, 0.05, "wood", radius=0.02)
        self.block(
            "露台坐垫", 2.68, 8.03, 1.4, 0.43, 0.05, 0.52, "fabric", self.cream, 0.05
        )
        # Small decor is modelled at real scale, not painted into a preview.
        for x, z, h in [
            (3.2, 4.65, 0.51),
            (4.7, 1.4, 0.85),
            (1.8, 1.95, 1.0),
            (6.9, 4.55, 0.86),
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
        self.lamp("客厅纸灯", 0.55, 2.85, 1.58, 0.26, 550)
        self.lamp("书房台灯", 9.1, 4.75, 1.08, 0.12, 240)
        self.lamp("浴室壁灯", 6.8, 8.36, 1.4, 0.12, 240)

    def export(self, output):
        def extras(tree):
            tree.setdefault("extras", {})["showcase"] = "forest-home-v2"
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
    scene = Showcase(doc)
    scene.build(output)
    scene.open_rear_walls()
    scene.decorate()
    path = ROOT / "public/models/forest-home-v2.glb"
    candidate = output / "showcase.glb"
    scene.export(candidate)
    proof = verify_export(doc, candidate)
    path.write_bytes(candidate.read_bytes())
    metadata = {
        "id": "forest-home-v2",
        "title": doc["title"],
        "area": round(9.84 * 8.84, 1),
        "room_count": len(doc["rooms"]),
        "source": "authored_sample",
        "model_url": "/models/forest-home-v2.glb",
        "description": "开放客餐厅 · 岛台厨房 · 独立书房 · 绿植露台",
        "geometry_verified": proof["geometry_verified"],
    }
    (ROOT / "public/models/forest-home-v2.json").write_text(
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
