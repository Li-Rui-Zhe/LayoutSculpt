"""桌面设备精修：真实键位、内嵌字标和壁纸，所有纹理随 GLB 携带。"""

import math
from functools import lru_cache

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from trimesh.visual.material import PBRMaterial


def textured(m, name, vertices, faces, uv, material):
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    unique = f"{name}_{len(m.scene.geometry)}"
    m.scene.add_geometry(mesh, node_name=unique, geom_name=unique)


@lru_cache(maxsize=1)
def wallpaper():
    y, x = np.mgrid[:512, :896]
    u, v = x / 895, y / 511
    ribbon = np.exp(-(((v - 0.56 - 0.19 * np.sin(u * 5.8)) / 0.12) ** 2))
    glow = np.exp(-((u - 0.65) ** 2 + (v - 0.42) ** 2) / 0.25)
    rgb = np.stack(
        [
            20 + 13 * glow + ribbon * 15,
            43 + 49 * glow + ribbon * 36,
            68 + 63 * glow + ribbon * 44,
        ],
        axis=-1,
    )
    image = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((290, 470, 606, 503), radius=13, fill=(40, 61, 78))
    for i, color in enumerate(
        [
            (106, 180, 204),
            (220, 184, 112),
            (198, 210, 215),
            (114, 164, 150),
            (162, 155, 198),
            (215, 190, 164),
        ]
    ):
        xx = 322 + i * 44
        draw.rounded_rectangle((xx, 478, xx + 18, 496), radius=4, fill=color)
    return PBRMaterial(
        name="电脑_内嵌高清屏幕",
        baseColorTexture=image,
        baseColorFactor=[255] * 4,
        roughnessFactor=0.2,
        metallicFactor=0,
        emissiveFactor=[0.025, 0.045, 0.065],
    )


def screen(m, name, center, width, height, transform=None):
    x, y, z = center
    vertices = np.array(
        [
            [x - width / 2, y - height / 2, z],
            [x + width / 2, y - height / 2, z],
            [x + width / 2, y + height / 2, z],
            [x - width / 2, y + height / 2, z],
        ]
    )
    if transform is not None:
        vertices = trimesh.transform_points(vertices, transform)
    textured(
        m,
        name,
        vertices,
        [[0, 1, 2], [0, 2, 3]],
        [[0, 0], [1, 0], [1, 1], [0, 1]],
        wallpaper(),
    )


def keyboard(m, center, width, depth, laptop=False):
    x, y, z = center
    m.plate(
        "键盘凹槽" if laptop else "键盘铝合金底板",
        center,
        [width, 0.004 if laptop else 0.012, depth],
        "dark" if laptop else "aluminum",
        radius=0.005,
    )
    # 六行错位布局，保留 Backspace、Tab、Enter、Shift 与独立方向键。
    rows = [
        [("Esc", 1)] + [(f"F{i}", 1) for i in range(1, 13)] + [("Del", 1)],
        [(label, 1) for label in "`1234567890-="] + [("Bksp", 2)],
        [("Tab", 1.5)] + [(label, 1) for label in "QWERTYUIOP[]"] + [("\\", 1.5)],
        [("Caps", 1.8)] + [(label, 1) for label in "ASDFGHJKL;'"] + [("Enter", 2.2)],
        [("Shift", 2.3)]
        + [(label, 1) for label in "ZXCVBNM,./"]
        + [("Shift", 1.7), ("Up", 1)],
        [
            ("Ctrl", 1.3),
            ("Fn", 1),
            ("Alt", 1.2),
            ("", 6.1),
            ("Alt", 1.2),
            ("Left", 1),
            ("Down", 1),
            ("Right", 1),
        ],
    ]
    atlas = Image.new("RGB", (1024, 512), (66, 72, 80))
    draw = ImageDraw.Draw(atlas)
    font = ImageFont.load_default(size=13)
    vertices, faces, uv = [], [], []
    index = 0
    step_z = depth / 6.7
    top = y + (0.004 if laptop else 0.0085)
    for row, keys in enumerate(rows):
        unit = width * 0.955 / sum(weight for _, weight in keys)
        cursor = -width * 0.955 / 2
        for label, weight in keys:
            kw = unit * weight - width * 0.008
            kd = step_z * (0.64 if row == 0 else 0.84)
            xx = x + cursor + unit * weight / 2
            zz = z + (row - 2.5) * step_z
            cursor += unit * weight
            m.plate(
                f"独立键帽_{label or 'Space'}",
                [xx, top - 0.0014, zz],
                [kw, 0.0028, kd],
                "keycap",
                radius=0.0015,
            )
            cell_x, cell_y = index % 16 * 64, index // 16 * 64
            draw.text((cell_x + 8, cell_y + 13), label, font=font, fill=(222, 226, 229))
            if label in {"F", "J"}:
                draw.line(
                    (cell_x + 28, cell_y + 54, cell_x + 40, cell_y + 54),
                    fill=(170, 176, 183),
                    width=2,
                )
            start = len(vertices)
            vertices += [
                [xx - kw * 0.38, top + 0.00005, zz - kd * 0.38],
                [xx + kw * 0.38, top + 0.00005, zz - kd * 0.38],
                [xx + kw * 0.38, top + 0.00005, zz + kd * 0.38],
                [xx - kw * 0.38, top + 0.00005, zz + kd * 0.38],
            ]
            faces += [[start, start + 2, start + 1], [start, start + 3, start + 2]]
            u0, u1 = cell_x / 1024, (cell_x + 64) / 1024
            v0, v1 = 1 - cell_y / 512, 1 - (cell_y + 64) / 512
            uv += [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
            index += 1
    textured(
        m,
        "键帽字符与定位标记",
        vertices,
        faces,
        uv,
        PBRMaterial(
            name="电脑_键帽字标",
            baseColorTexture=atlas,
            roughnessFactor=0.72,
            metallicFactor=0,
        ),
    )


def ring(m, name, center, radius, thickness, role="keycap", axis="z"):
    mesh = trimesh.creation.torus(
        major_radius=radius, minor_radius=thickness, major_sections=40, minor_sections=8
    )
    if axis == "x":
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0])
        )
    mesh.apply_translation(center)
    m.add(name, mesh, role, smooth=True)


def fan(m, center, radius, axis="z"):
    ring(m, "散热风扇外圈", center, radius, 0.003, "aluminum", axis)
    cx, cy, cz = center
    for angle in np.linspace(0, math.tau, 7, endpoint=False):
        mesh = trimesh.creation.box(extents=[radius * 0.68, radius * 0.20, 0.004])
        mesh.apply_translation([radius * 0.48, 0, 0])
        mesh.apply_transform(trimesh.transformations.rotation_matrix(angle, [0, 0, 1]))
        if axis == "x":
            mesh.apply_transform(
                trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0])
            )
        mesh.apply_translation(center)
        m.add("散热风扇叶片", mesh, "keycap")
    a, b = np.array([cx, cy, cz]), np.array([cx, cy, cz])
    a[0 if axis == "x" else 2] -= 0.003
    b[0 if axis == "x" else 2] += 0.003
    m.rod("风扇轴心", a, b, radius * 0.18, "charcoal")


def tower(m):
    for x in [0.275, 0.425]:
        for z in [-0.17, 0.14]:
            m.box("机箱防滑脚", [x, 0.009, z], [0.032, 0.018, 0.044], "dark", 0.005)
    for name, center, size in [
        ("机箱底框", [0.35, 0.023, -0.01], [0.20, 0.012, 0.39]),
        ("机箱顶盖", [0.35, 0.443, -0.01], [0.20, 0.009, 0.39]),
        ("机箱背板", [0.35, 0.232, -0.201], [0.20, 0.42, 0.008]),
        ("机箱左侧板", [0.253, 0.232, -0.01], [0.006, 0.42, 0.38]),
        ("机箱前框左", [0.265, 0.231, 0.183], [0.03, 0.42, 0.014]),
        ("机箱前框右", [0.435, 0.231, 0.183], [0.03, 0.42, 0.014]),
        ("机箱前框上", [0.35, 0.405, 0.183], [0.17, 0.075, 0.014]),
        ("机箱前框下", [0.35, 0.047, 0.183], [0.17, 0.055, 0.014]),
    ]:
        m.box(name, center, size, "charcoal", 0.003)
    m.box("电源仓", [0.35, 0.067, -0.025], [0.18, 0.075, 0.34], "dark", 0.004)
    m.box("主板", [0.262, 0.27, -0.032], [0.007, 0.255, 0.275], "keycap", 0.001)
    m.box("显卡外壳", [0.344, 0.163, -0.016], [0.14, 0.032, 0.235], "charcoal", 0.003)
    for z in np.linspace(-0.11, 0.08, 12):
        m.box("显卡散热鳍片", [0.35, 0.178, z], [0.12, 0.007, 0.003], "aluminum", 0)
    m.box("CPU散热器", [0.30, 0.285, -0.055], [0.055, 0.095, 0.10], "aluminum", 0.003)
    fan(m, [0.333, 0.285, -0.055], 0.043, "x")
    for z in [0.02, 0.044]:
        m.box("内存条", [0.282, 0.305, z], [0.023, 0.12, 0.007], "dark", 0.001)
    for y in [0.145, 0.285]:
        fan(m, [0.35, y, 0.17], 0.056)
    for y in np.linspace(0.082, 0.361, 30):
        m.box("前面板通风格栅", [0.35, y, 0.182], [0.14, 0.003, 0.008], "keycap", 0.001)
    for z in np.linspace(-0.15, 0.10, 15):
        m.box("顶盖散热开槽", [0.35, 0.448, z], [0.12, 0.001, 0.006], "dark", 0)
    m.box("主机电源键", [0.35, 0.411, 0.192], [0.022, 0.01, 0.003], "aluminum", 0.003)
    m.box("电源状态灯", [0.374, 0.411, 0.194], [0.004, 0.003, 0.001], "screen_light", 0)
    for x in [0.308, 0.344]:
        m.box("前置USB-A接口", [x, 0.38, 0.192], [0.018, 0.008, 0.003], "dark", 0.001)
        m.box("USB接口内芯", [x, 0.379, 0.194], [0.012, 0.003, 0.001], "screen", 0)
    m.box("前置USB-C接口", [0.389, 0.38, 0.192], [0.012, 0.005, 0.003], "dark", 0.002)
    ring(m, "耳机插孔", [0.413, 0.38, 0.193], 0.0035, 0.001, "aluminum")
    for y in [0.25, 0.28, 0.31]:
        m.box(
            "后置主板接口", [0.30, y, -0.206], [0.034, 0.013, 0.002], "aluminum", 0.001
        )
    m.box("侧透玻璃", [0.447, 0.234, -0.012], [0.003, 0.395, 0.361], "mirror", 0.001)
    glass = list(m.scene.geometry.values())[-1]
    glass.visual.material = PBRMaterial(
        name="电脑_烟灰侧透玻璃",
        baseColorFactor=[125, 151, 163, 65],
        metallicFactor=0,
        roughnessFactor=0.14,
        alphaMode="BLEND",
        doubleSided=True,
    )
    for y in [0.048, 0.42]:
        for z in [-0.178, 0.153]:
            m.rod("侧板固定螺丝", [0.448, y, z], [0.452, y, z], 0.004, "aluminum")


def mouse(m):
    mesh = trimesh.creation.uv_sphere(count=[20, 32])
    mesh.vertices *= [0.032, 0.021, 0.052]
    mesh.vertices[:, 1] = np.maximum(mesh.vertices[:, 1], -0.012)
    mesh.apply_translation([0.145, 0.020, 0.18])
    m.add("人体工学鼠标外壳", mesh, "charcoal", smooth=True)
    for x in [0.13, 0.16]:
        m.plate("鼠标按键", [x, 0.037, 0.158], [0.026, 0.004, 0.034], "keycap", 0.006)
    m.rod("鼠标滚轮", [0.140, 0.040, 0.156], [0.150, 0.040, 0.156], 0.007, "dark")
    for z in [0.152, 0.157, 0.162]:
        m.rod("滚轮防滑刻纹", [0.141, 0.046, z], [0.149, 0.046, z], 0.0005, "aluminum")
    m.box("鼠标中缝", [0.145, 0.040, 0.143], [0.001, 0.001, 0.022], "dark", 0)


def desktop(m):
    m.plate(
        "显示器薄底座", [-0.13, 0.008, -0.075], [0.245, 0.016, 0.17], "aluminum", 0.025
    )
    m.box("显示器支柱", [-0.13, 0.09, -0.115], [0.035, 0.16, 0.022], "aluminum", 0.006)
    m.rod(
        "俯仰调节铰链", [-0.175, 0.197, -0.145], [-0.085, 0.197, -0.145], 0.014, "dark"
    )
    m.box("显示器背壳", [-0.13, 0.308, -0.115], [0.63, 0.36, 0.018], "charcoal", 0.008)
    m.box(
        "显示器背部支架座", [-0.13, 0.233, -0.13], [0.13, 0.135, 0.024], "dark", 0.012
    )
    m.box("窄边屏幕玻璃", [-0.13, 0.31, -0.104], [0.619, 0.345, 0.003], "dark", 0.004)
    screen(m, "显示器高清壁纸", [-0.13, 0.312, -0.1023], 0.608, 0.331)
    m.box(
        "显示器下边框", [-0.13, 0.137, -0.102], [0.614, 0.012, 0.005], "charcoal", 0.002
    )
    m.box(
        "显示器指示灯",
        [0.15, 0.137, -0.0985],
        [0.004, 0.0015, 0.001],
        "screen_light",
        0,
    )
    for x in np.linspace(-0.36, 0.10, 24):
        m.box("显示器背部散热孔", [x, 0.154, -0.125], [0.009, 0.003, 0.001], "dark", 0)
    for x in [-0.18, -0.13, -0.08]:
        m.box(
            "显示器背部接口",
            [x, 0.185, -0.143],
            [0.024, 0.009, 0.002],
            "aluminum",
            0.001,
        )
    keyboard(m, [-0.16, 0.012, 0.17], 0.43, 0.14)
    mouse(m)
    tower(m)


def laptop(m):
    m.plate("轻薄机身底壳", [0, 0.006, 0.026], [0.35, 0.012, 0.23], "aluminum", 0.009)
    m.plate("机身装配分缝", [0, 0.0108, 0.026], [0.348, 0.001, 0.228], "keycap", 0.008)
    m.plate(
        "铝合金掌托面板", [0, 0.012, 0.026], [0.35, 0.0025, 0.23], "aluminum", 0.009
    )
    keyboard(m, [0, 0.0145, -0.009], 0.294, 0.119, laptop=True)
    for x in [-0.162, 0.162]:
        for z in np.linspace(-0.053, 0.043, 20):
            m.box(
                "立体声扬声器开孔",
                [x, 0.0135, z],
                [0.004, 0.0006, 0.0014],
                "dark",
                0.0003,
            )
    m.plate("触控板切边", [0, 0.0135, 0.093], [0.125, 0.0005, 0.060], "keycap", 0.004)
    m.plate("玻璃触控板", [0, 0.0139, 0.093], [0.123, 0.0005, 0.058], "aluminum", 0.004)
    m.box("开盖指扣凹口", [0, 0.01, 0.141], [0.058, 0.004, 0.001], "keycap", 0.001)
    for x in [-0.13, 0.13]:
        m.rod(
            "独立金属转轴",
            [x - 0.018, 0.018, -0.082],
            [x + 0.018, 0.018, -0.082],
            0.006,
            "aluminum",
        )
    m.box("后部出风口", [0, 0.014, -0.082], [0.19, 0.008, 0.008], "dark", 0.002)
    for x in np.linspace(-0.09, 0.09, 24):
        m.box("出风口隔栅", [x, 0.017, -0.079], [0.002, 0.005, 0.004], "keycap", 0)
    transform = trimesh.transformations.rotation_matrix(-math.radians(14), [1, 0, 0])
    transform[:3, 3] = [0, 0.018, -0.082]
    for name, center, size, role, radius in [
        ("圆角屏幕铝合金外壳", [0, 0.111, 0], [0.35, 0.222, 0.006], "aluminum", 0.0025),
        ("窄边屏幕玻璃", [0, 0.112, 0.0035], [0.341, 0.213, 0.0015], "dark", 0.0006),
        ("摄像头镜头", [0, 0.214, 0.0048], [0.004, 0.004, 0.001], "mirror", 0.0004),
        ("摄像头状态灯", [0.008, 0.214, 0.0047], [0.001, 0.001, 0.0005], "keycap", 0),
    ]:
        m.box(name, center, size, role, radius)
        list(m.scene.geometry.values())[-1].apply_transform(transform)
    screen(m, "笔记本高清壁纸", [0, 0.112, 0.0048], 0.328, 0.194, transform)
    for x in [-0.175, 0.175]:
        for z in [-0.054, -0.025]:
            m.box("USB-C金属端口", [x, 0.006, z], [0.0012, 0.005, 0.013], "dark", 0.001)
            m.box(
                "USB-C内芯",
                [x * 1.0005, 0.006, z],
                [0.0013, 0.001, 0.008],
                "aluminum",
                0,
            )
    m.box("HDMI接口", [-0.1755, 0.006, 0.008], [0.001, 0.006, 0.019], "dark", 0.001)
    m.box("USB-A接口", [0.1755, 0.006, 0.013], [0.001, 0.006, 0.016], "dark", 0.001)
    m.rod("耳机插孔", [0.174, 0.006, 0.044], [0.176, 0.006, 0.044], 0.002, "dark")
    for x in [-0.13, 0.13]:
        for z in [-0.06, 0.11]:
            m.plate(
                "底部橡胶脚垫", [x, -0.001, z], [0.025, 0.002, 0.011], "dark", 0.004
            )
