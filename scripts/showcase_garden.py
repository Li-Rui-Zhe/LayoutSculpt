"""按真实构造制作示例露台：落地支撑、靠背、薄边桌和有枝茎的植栽。"""

import math

import numpy as np
import trimesh
from PIL import Image

from scripts.showcase_finishes import cushion_mesh


def teak_texture():
    y, x = np.mgrid[:512, :512] / 512
    grain = np.sin(x * 178 + 1.8 * np.sin(y * 9)) * 2.2
    grain += np.sin(x * 391 + np.sin(y * 17)) * 1.1
    grain += np.random.default_rng(41).normal(0, .45, x.shape)
    return Image.fromarray(np.clip(np.array([157, 126, 91]) + grain[..., None], 0, 255).astype('uint8'))


class Garden:
    def __init__(self, author):
        self.a = author
        self.teak = trimesh.visual.material.PBRMaterial(
            name="户外木材_哑光柚木", baseColorFactor=[255] * 4,
            baseColorTexture=teak_texture(), roughnessFactor=.74, metallicFactor=0)
        self.number = 0

    def mesh(self, name, mesh, mat, origin, angle=0, group="terrace"):
        # Object-local UVs and indexed normals retain the rounded upholstery.
        if not isinstance(mesh.visual, trimesh.visual.TextureVisuals):
            mesh.visual = trimesh.visual.TextureVisuals(uv=mesh.vertices[:, [0, 2]], material=mat)
        _ = mesh.vertex_normals
        transform = trimesh.transformations.rotation_matrix(angle, [0, 1, 0])
        transform[:3, 3] = self.a.pos(*origin)
        self.number += 1
        key = f"{name}_{self.number}"
        self.a.scene.add_geometry(mesh, node_name=key, geom_name=key, transform=transform,
            metadata={"room_id": "terrace", "decoration_kind": "showcase_garden", "garden_group": group})

    def timber(self, name, center, extents, origin, angle=0, group="terrace"):
        mesh = trimesh.creation.box(extents=extents)
        mesh.apply_translation(center)
        # Keep timber end/side faces crisp, unlike the cushions.
        mesh.unmerge_vertices()
        self.mesh(name, mesh, self.teak, origin, angle, group)

    def seat(self, name, x, z, width, seats=1, angle=0):
        origin = (x, .082, z)
        side = width / 2 - .035
        for sx in [-side, side]:
            for sz in [-.30, .30]:
                self.timber(name + "落地支腿", [sx, .22, sz], [.065, .44, .065], origin, angle, name)
            self.timber(name + "侧扶手", [sx, .59, 0], [.075, .055, .79], origin, angle, name)
            self.timber(name + "扶手前立柱", [sx, .48, -.30], [.05, .22, .05], origin, angle, name)
            self.timber(name + "靠背立柱", [sx, .64, .33], [.055, .58, .055], origin, angle, name)
        for sz in [-.30, .30]:
            self.timber(name + "座框横梁", [0, .32, sz], [width, .09, .055], origin, angle, name)
        for sz in np.linspace(-.29, .29, 7):
            self.timber(name + "承重座板", [0, .365, sz], [width - .09, .025, .065], origin, angle, name)
        for sx in np.linspace(-side + .09, side - .09, max(5, int(width / .12))):
            self.timber(name + "靠背木条", [sx, .64, .345], [.055, .50, .025], origin, angle, name)
        self.timber(name + "靠背顶梁", [0, .91, .345], [width, .055, .055], origin, angle, name)
        cushion_width = (width - .18) / seats
        for i in range(seats):
            cx = (i - (seats - 1) / 2) * cushion_width
            for label, radii, center in [
                ("坐垫", [cushion_width / 2 - .012, .065, .32], [cx, .445, -.015]),
                ("靠背软垫", [cushion_width / 2 - .014, .23, .075], [cx, .72, .26]),
            ]:
                mesh = cushion_mesh(radii, subdivisions=3)
                plane = [axis for axis in range(3) if axis != int(np.argmin(radii))]
                mesh.visual = trimesh.visual.TextureVisuals(uv=mesh.vertices[:, plane] / .25, material=self.a.cream)
                mesh.apply_translation(center)
                self.mesh(name + label, mesh, self.a.cream, origin, angle, name)
        # One small accent cushion rests against the upholstered back.
        pillow = cushion_mesh([.18, .18, .07], subdivisions=3)
        pillow.apply_translation([-.38 if seats > 1 else 0, .675, .12])
        self.mesh(name + "苔绿腰枕", pillow, self.a.cushion_olive, origin, angle, name)

    def cup(self, x, z, base):
        # Hollow cup with a rounded lip and a real handle, at 7 cm diameter.
        profile = [[0, 0], [.032, 0], [.038, .065], [.035, .068], [.031, .064], [.027, .008], [0, .008]]
        cup = trimesh.creation.revolve(np.array(profile), sections=40)
        cup.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
        handle = trimesh.creation.torus(major_radius=.022, minor_radius=.005, major_sections=24, minor_sections=8)
        handle.apply_translation([.039, .035, 0])
        self.mesh("露台手作茶杯", trimesh.util.concatenate([cup, handle]), self.a.paper, (x, base, z))

    def planter(self, x, z, w, d):
        a = self.a
        # Hollow planter: four sides, recessed soil, rooted stems and thin leaves.
        for dx in [-w / 2 + .025, w / 2 - .025]:
            a.block("砂岩花箱侧壁", x + dx, z, .05, d, .32, .071, "stone", radius=.012)
        for dz in [-d / 2 + .025, d / 2 - .025]:
            a.block("砂岩花箱端壁", x, z + dz, w - .07, .05, .32, .071, "stone", radius=.012)
        a.block("花箱下沉种植土", x, z, w - .08, d - .08, .025, .345, "dark", a.charcoal, .01)
        rng = np.random.default_rng(52)
        foliage, stems = [], []
        for _ in range(36):
            root = np.array([rng.uniform(-w * .35, w * .35), .37, rng.uniform(-d * .35, d * .35)])
            angle = rng.uniform(0, math.tau)
            height = rng.uniform(.17, .36)
            tip = root + [math.cos(angle) * .08, height, math.sin(angle) * .08]
            stems.append(trimesh.creation.cylinder(radius=.0018, segment=[root, tip], sections=5))
            for j in range(4):
                t = .35 + .17 * j
                start = root * (1 - t) + tip * t
                heading = angle + j * 2.4
                length = rng.uniform(.055, .095)
                vertices = []
                for k in range(9):
                    s = k / 8
                    reach = length * s
                    mid = start + [math.cos(heading) * reach, .035 * math.sin(s * math.pi / 1.5), math.sin(heading) * reach]
                    half = .016 * math.sin(math.pi * s) + .0002
                    for sign in [-1, 1]:
                        vertices.append(mid + np.array([-math.sin(heading), 0, math.cos(heading)]) * half * sign)
                faces = []
                for k in range(8):
                    q = k * 2
                    faces.extend([(q, q + 1, q + 2), (q + 1, q + 3, q + 2)])
                leaf = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
                foliage.append(leaf)
        green = a.olive.copy()
        green.name = "庭院_香草叶片"
        green.doubleSided = True
        self.mesh("香草细枝", trimesh.util.concatenate(stems), a.olive, (x, 0, z), group="planting")
        self.mesh("香草自然叶片", trimesh.util.concatenate(foliage), green, (x, 0, z), group="planting")

    def build(self):
        a = self.a
        # Seating faces into the terrace, so the first view reveals the cushions
        # instead of a long sofa back. The east side keeps an 80 cm clear route.
        for i, x in enumerate(np.arange(.20, 5.9, .14)):
            a.block("露台柚木长板", float(x), 8.38, .135, 2.17, .025, .046,
                    "wood", self.teak, .004, metadata={"floor_room_id": "terrace"})
        a.block("露台平织户外毯", 2.02, 8.39, 3.45, 1.94, .009, .073, "fabric", a.rug, .035)
        self.seat("露台双人柚木沙发", .92, 8.38, 1.88, seats=2, angle=-math.pi / 2)
        self.seat("露台柚木休闲椅", 3.10, 8.75, .79, angle=math.pi / 2)
        # Four slim legs visibly connect to the frame and the thin stone top.
        for dx in [-.17, .17]:
            for dz in [-.36, .36]:
                self.timber("露台茶桌桌腿", [dx, .15, dz], [.045, .30, .045], (2.05, .082, 8.45))
        self.timber("露台茶桌承重框", [0, .29, 0], [.42, .055, .88], (2.05, .082, 8.45))
        a.block("露台薄边洞石茶桌", 2.05, 8.45, .59, 1.05, .035, .40, "stone", radius=.22)
        a.block("露台茶托", 2.05, 8.63, .31, .20, .012, .436, "wood", self.teak, .045)
        self.cup(1.98, 8.63, .45)
        self.cup(2.12, 8.63, .45)
        a.block("露台合页画册", 2.05, 8.17, .19, .25, .018, .436, "fabric", a.paper, .004, angle=.12)
        # Portable shaded table lamp adds a low, local pool of light at night.
        a.block("露台便携灯底座", 2.05, 8.39, .10, .10, .018, .436,
                "metal", a.olive, .048)
        a.block("露台便携灯细杆", 2.05, 8.39, .014, .014, .16, .454,
                "metal", a.olive, .006)
        shade = trimesh.creation.revolve(np.array([
            [.01, 0], [.055, -.015], [.09, -.065], [.09, -.075],
            [.08, -.075], [.048, -.025], [.01, -.012],
        ]), sections=40)
        shade.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
        self.mesh("露台便携灯蘑菇罩", shade, a.olive, (2.05, .68, 8.39))
        glow = a.paper.copy()
        glow.name = "灯具_露台便携灯柔光面"
        glow.emissiveFactor = [1, .68, .32]
        a.block("露台便携灯柔光面", 2.05, 8.39, .145, .145, .008, .605,
                "white", glow, .07, metadata={
                    "fixture_id": "garden_table", "fixture_kind": "table_lamp",
                    "fixture_lumens": 45, "fixture_temperature": 2700,
                    "fixture_enabled": True, "fixture_visual_placeholder": False,
                    "fixture_cast_shadow": False})
        self.planter(5.48, 8.08, .53, .91)
