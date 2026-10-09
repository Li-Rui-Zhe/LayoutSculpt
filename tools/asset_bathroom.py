"""卫浴造型：连续陶瓷曲面、薄座圈与完整玻璃淋浴房。"""
import math
import bpy
from asset_geometry import box, cylinder, sphere
from asset_materials import material


def contour(name, rings, mat, exponent=2.6, caps=True):
    """沿水平圆角矩形截面放样；环顺序允许折回形成座圈内壁。"""
    vertices, faces, steps = [], [], 96
    for z, rx, ry, cy in rings:
        for i in range(steps):
            t = i * math.tau / steps
            c, s = math.cos(t), math.sin(t)
            vertices.append((rx * math.copysign(abs(c) ** (2 / exponent), c),
                             cy + ry * math.copysign(abs(s) ** (2 / exponent), s), z))
    for j in range(len(rings) - 1):
        for i in range(steps):
            a, b = j * steps + i, j * steps + (i + 1) % steps
            faces.append((a, b, b + steps, a + steps))
    if caps:
        faces.extend([tuple(reversed(range(steps))), tuple((len(rings) - 1) * steps + i for i in range(steps))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = True
    return obj


def toilet(m, pipe):
    ceramic = m["white"]
    seat = material("卫浴_温润白座圈", (0.96, 0.955, 0.94), 0.28)
    shadow = material("卫浴_座圈细缝", (0.43, 0.46, 0.45), 0.6)
    # 底座与裙包盆体是连续曲面，前端圆润、后端收束，无球体拼接。
    contour("一体裙包陶瓷主体", [
        (0.015, .142, .233, .015), (.025, .156, .245, .01),
        (.075, .157, .243, .005), (.16, .152, .235, -.008),
        (.24, .166, .25, -.035), (.32, .185, .269, -.052),
        (.38, .199, .279, -.06), (.413, .2, .28, -.06),
        (.427, .195, .275, -.06), (.427, .164, .235, -.06),
        (.40, .155, .225, -.06), (.35, .137, .205, -.052),
        (.29, .086, .124, -.03), (.275, .042, .070, -.018),
        (.277, .002, .002, -.018),
    ], ceramic)
    contour("后部连体水箱", [
        (.30, .145, .074, .238), (.37, .172, .086, .238),
        (.64, .175, .088, .238), (.719, .17, .084, .238),
        (.729, .156, .073, .238),
    ], ceramic, 4)
    contour("水箱盖细缝", [(.731, .17, .086, .238), (.734, .17, .086, .238)], shadow, 4)
    contour("独立圆角水箱盖", [(.735, .17, .086, .238), (.751, .174, .09, .238), (.76, .159, .078, .238)], ceramic, 4)
    # 独立座圈有真实开孔，盖板抬起，便于看出器具结构。
    contour("缓降座圈", [
        (.435, .191, .264, -.063), (.444, .199, .272, -.063),
        (.459, .196, .269, -.063), (.465, .184, .258, -.063),
        (.465, .133, .19, -.071), (.456, .125, .182, -.071),
        (.44, .128, .185, -.071), (.435, .14, .198, -.071),
        (.435, .191, .264, -.063),
    ], seat, caps=False)
    lid = contour("抬起的缓降盖板", [
        (0, .187, .257, 0), (.009, .196, .265, 0),
        (.024, .192, .262, 0), (.032, .178, .249, 0),
    ], seat)
    # 盖板绕后缘上翻约 64°，顶部低于水箱上缘，保留标准尺寸。
    for v in lid.data.vertices:
        v.co.y -= .265
        v.co.y *= .66
    lid.rotation_euler.x = math.radians(-64)
    lid.location = (0, .185, .46)
    for x in [-.105, .105]:
        box("盖板缓降铰链", (x, .168, .453), (.035, .045, .024), m["steel"], .006)
    for x, r in [(-.022, .019), (.022, .016)]:
        cylinder("双档冲水按钮", (x, .238, .763), r, .005, m["steel"])
    for x in [-.142, .142]:
        sphere("底脚检修装饰盖", (x, .08, .09), (.009, .021, .021), ceramic)


def shower(m, pipe, style="enclosed"):
    frame = material("卫浴_哑黑铝框", (.026, .032, .035), .36, .65)
    tile = material("卫浴_暖灰瓷板", (.69, .70, .68), .56)
    grout = material("卫浴_瓷板细缝", (.43, .46, .44), .72)
    clear = material("卫浴_无色透明玻璃", (.79, .89, .9), .12)
    shader = clear.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Alpha"].default_value = .14
    clear.diffuse_color = (.79, .89, .9, .14)
    clear.surface_render_method = "DITHERED"
    if style == "enclosed":
        box("薄边防水底盘", (0, 0, .025), (1, 1, .05), m["white"], .014)
        box("哑光防滑底板", (0, 0, .052), (.958, .958, .012), tile, .004)
    else:
        box("一体防滑湿区地面", (0, 0, .006), (1, 1, .012), tile, .002)
    # 有实体背板承托五金，正面为固定屏加平开门，左侧固定玻璃。
    if style == "enclosed":
        box("淋浴背部瓷板", (0, .483, 1.066), (.982, .026, 2.068), tile, .004)
        box("淋浴右侧瓷板", (.483, 0, 1.066), (.026, .948, 2.068), tile, .004)
        for z in [.57, 1.08, 1.59]:
            box("背板水平砖缝", (0, .4685, z), (.945, .001, .0018), grout, 0)
            box("侧板水平砖缝", (.4685, 0, z), (.001, .934, .0018), grout, 0)
        box("正面固定玻璃", (-.327, -.474, 1.074), (.285, .006, 1.998), clear, 0)
        box("正面平开玻璃门", (.145, -.474, 1.066), (.626, .006, 1.965), clear, 0)
        for x, y in [(-.478, -.478), (-.478, .478), (.478, -.478)]:
            box("细窄立框", (x, y, 1.075), (.016, .016, 2.05), frame, .002)
        for z in [.064, 2.092]:
            box("正面横框", (0, -.478, z), (.974, .016, .016), frame, .002)
            box("侧面横框", (-.478, 0, z), (.016, .974, .016), frame, .002)
        box("固定玻璃收边", (-.18, -.474, 1.074), (.009, .01, 2.00), frame, .001)
        for z in [.48, 1.64]:
            box("玻璃门铰链", (.458, -.48, z), (.038, .024, .058), m["steel"], .005)
        for z in [.92, 1.17]:
            pipe("拉手连接座", [(-.105, -.474, z), (-.105, -.501, z)], .007, frame)
        pipe("竖向门拉手", [(-.105, -.501, .90), (-.105, -.501, 1.19)], .009, frame)
    if style != "open":
        box("左侧整片玻璃", (-.474, 0, 1.074), (.006, .942, 1.998), clear, 0)
    if style == "walk_in":
        box("玻璃落地细槽", (-.474, 0, .024), (.016, .95, .024), frame, .002)
        box("靠墙玻璃收边", (-.474, .472, 1.057), (.012, .012, 2.07), frame, .002)
        pipe("玻璃稳定拉杆", [(-.474, -.20, 2.05), (-.474, .48, 2.05)], .007, frame)
    drain = .060 if style == "enclosed" else .014
    box("线性排水饰盖", (0, .33, drain), (.57, .046, .003), m["steel"], .001)
    for i in range(18):
        box("排水细孔", (-.255 + i * .03, .33, drain + .002), (.012, .026, .001), frame, 0)
    # 弯管采用细分圆弧，手持花洒软管连续下垂。
    pipe("花洒立管", [(0, .43, 1), (0, .43, 1.91)], .012, m["steel"])
    arc = [(0, .35 + .08 * math.cos(i * math.pi / 24), 1.91 + .08 * math.sin(i * math.pi / 24)) for i in range(13)]
    pipe("弧形顶喷弯管", arc + [(0, .10, 1.99)], .012, m["steel"])
    cylinder("超薄圆形顶喷", (0, .10, 1.969), .13, .017, m["steel"])
    cylinder("顶喷硅胶出水面", (0, .10, 1.959), .119, .003, frame)
    box("恒温龙头主体", (0, .423, 1.04), (.26, .068, .05), m["steel"], .018)
    for x in [-.16, .16]:
        control = cylinder("恒温调节旋钮", (x, .423, 1.04), .027, .038, m["steel"])
        control.rotation_euler.y = math.pi / 2
    hose = []
    for i in range(33):
        t = i / 32
        hose.append((.07 + .15 * t, .388 - .04 * math.sin(math.pi * t), 1.01 * (1-t) + 1.36*t - .53*math.sin(math.pi*t)))
    pipe("连续柔性淋浴软管", hose, .006, m["steel"])
    pipe("手持花洒握柄", [(.22, .388, 1.36), (.22, .36, 1.48)], .012, m["steel"])
    head = cylinder("手持花洒圆头", (.22, .347, 1.515), .044, .014, m["steel"])
    head.rotation_euler.x = math.pi/2
    box("壁面置物架", (-.26, .384, 1.26), (.29, .16, .018), frame, .004)
    for x, color in [(-.33, m["white"]), (-.20, m["indicator"])]:
        cylinder("洗浴用品瓶身", (x, .385, 1.35), .025, .16, color)
        cylinder("按压瓶盖", (x, .385, 1.436), .016, .012, frame)
