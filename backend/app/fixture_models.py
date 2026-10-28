"""Shared, metre-scale light fixtures for the catalogue, previews and exports."""
import math
import numpy as np
import trimesh
from PIL import Image
from .config import ROOT


PRESETS = [
    dict(kind="floor_lamp", name="亚麻阅读落地灯", description="暖白织物灯罩、细金属杆和稳固圆盘底座，适合沙发或阅读角。", elevation=1.5, lumens=650),
    dict(kind="table_lamp", name="陶瓷床头台灯", description="圆润陶瓷灯身配亚麻灯罩。放好后按桌面高度调整光源离地高度。", elevation=1.1, lumens=350),
    dict(kind="pendant", name="乳白玻璃吊灯", description="乳白玻璃灯罩、细吊线和金属顶盘，适合餐桌上方。", elevation=2.2, lumens=800),
    dict(kind="ceiling", name="薄边吸顶灯", description="纤薄暖白边框与整面柔光罩，适合卧室和走廊。", elevation=2.65, lumens=1200),
    dict(kind="downlight", name="防眩筒灯", description="细边装饰圈、内凹深杯和小面积光学面，适合局部照明。", elevation=2.65, lumens=450),
    dict(kind="bulb", name="磨砂灯泡", description="真实比例的磨砂灯泡和螺口灯座，可作为基础光源。", elevation=2.4, lumens=500),
]


def fixture_parts(fixture):
    """Meshes are centred horizontally; elevation denotes the emitting centre."""
    kind, y = fixture["kind"], fixture["elevation"]
    hidden = kind in {"bulb", "pendant"}
    def mat(name, color, rough=.6, metal=0):
        return trimesh.visual.material.PBRMaterial(name=name, baseColorFactor=[*color,255], roughnessFactor=rough, metallicFactor=metal)
    bronze = mat("灯具_拉丝香槟金属", [118,105,83], .42, .72)
    white = mat("灯具_暖白烤漆", [232,229,220], .48)
    ceramic = mat("灯具_细砂陶瓷", [204,191,168], .8)
    dark = mat("灯具_防眩深杯", [38,40,39], .6)
    linen = mat("灯具_亚麻织物灯罩", [231,222,201], .98)
    linen.normalTexture = Image.open(ROOT / "public/materials/linen_normal.png").copy()
    color = {2700:[255,204,145],3000:[255,222,180],4000:[255,240,216],6500:[226,237,255]}[fixture["temperature"]]
    glow = mat("灯具_磨砂柔光面", color, .8)
    glow.emissiveFactor = [v / 255 for v in color]
    parts = []
    def add(name, mesh, material, *, emitter=False, shade=False):
        meta = {"fixture_owner_id": fixture["id"], "fixture_visual_placeholder": hidden}
        if hidden and not emitter: meta["fixture_visual_id"] = fixture["id"]
        if shade: meta["fixture_soft_shadow"] = True
        if emitter:
            meta.update(fixture_id=fixture["id"], fixture_kind=kind,
                        fixture_lumens=fixture["lumens"], fixture_temperature=fixture["temperature"],
                        fixture_enabled=fixture["enabled"], fixture_cast_shadow=fixture.get("cast_shadow", True))
        mesh.visual = trimesh.visual.TextureVisuals(uv=mesh.vertices[:,[0,1]] / .25, material=material)
        _ = mesh.vertex_normals
        parts.append((name, mesh, meta))
    def lathe(name, profile, material, **kw):
        mesh = trimesh.creation.revolve(np.array([*profile, profile[0]]), sections=64)
        mesh.fix_normals()
        mesh.apply_transform(trimesh.transformations.rotation_matrix(-math.pi/2,[1,0,0]))
        add(name, mesh, material, **kw)
    def disc(name, radius, height, cy, material, **kw):
        lathe(name, [(0,cy-height/2),(radius,cy-height/2),(radius,cy+height/2),(0,cy+height/2)], material, **kw)
    def orb(name, radii, cy, material, **kw):
        mesh = trimesh.creation.icosphere(subdivisions=3); mesh.apply_scale(radii); mesh.apply_translation([0,cy,0])
        add(name, mesh, material, **kw)
    if kind in {"floor_lamp", "table_lamp"}:
        floor = kind == "floor_lamp"
        bottom = .035 if floor else max(.02, y-.35)
        radius = .205 if floor else .11
        lathe("圆盘灯座", [(0,bottom),(radius-.015,bottom),(radius,bottom+.012),(radius,bottom+.025),(radius-.015,bottom+.035),(0,bottom+.035)], bronze if floor else ceramic)
        if not floor: orb("陶瓷灯身", [.095,.12,.095], bottom+.15, ceramic)
        disc("纤细金属灯杆", .009 if floor else .007, max(.02,y-bottom-.02), (y+bottom+.04)/2, bronze)
        rb, rt, low, high = (.245,.18,y-.14,y+.20) if floor else (.185,.13,y-.09,y+.16)
        lathe("亚麻开口灯罩", [(rb,low),(rt,high),(rt-.004,high),(rb-.004,low)], linen, shade=True)
        for level, radius in [(low,rb),(high,rt)]:
            lathe("灯罩缝边", [(radius-.005,level),(radius+.001,level),(radius+.001,level+.006),(radius-.005,level+.006)], linen, shade=True)
        orb("内置磨砂光源", [.038,.05,.038], y, glow, emitter=True)
    elif kind == "pendant":
        orb("乳白玻璃灯罩", [.22,.15,.22], y, glow, emitter=True)
        disc("吊灯金属灯颈", .035,.045,y+.16,bronze)
        disc("吊灯细吊线", .0025,.34,y+.35,dark)
        disc("吊灯吸顶盘", .07,.025,y+.53,white)
    elif kind == "ceiling":
        lathe("吸顶灯薄边框", [(.265,y-.026),(.28,y-.02),(.28,y+.048),(.265,y+.055)],white)
        disc("吸顶灯柔光面",.263,.038,y,glow,emitter=True)
    elif kind == "downlight":
        lathe("筒灯细边圈",[(.055,y),(.085,y),(.085,y+.015),(.055,y+.015)],white)
        lathe("筒灯内凹防眩杯",[(.055,y),(.032,y+.055),(.036,y+.06),(.06,y+.005)],dark)
        disc("筒灯光学面",.031,.008,y+.05,glow,emitter=True)
    elif kind == "bulb":
        orb("磨砂灯泡",[.055,.07,.055],y,glow,emitter=True)
        disc("灯泡螺口灯座",.028,.055,y+.075,bronze)
        for level in np.linspace(y+.055,y+.095,5): disc("螺口细纹",.03,.003,float(level),bronze)
    else:
        raise ValueError("不支持的灯具类型")
    return parts


def add_fixture(builder, fixture):
    transform = trimesh.transformations.translation_matrix([fixture["x"]-builder.cx,0,fixture["y"]-builder.cz])
    for name, mesh, meta in fixture_parts(fixture):
        builder.node_index += 1
        label = f"{name}_{builder.node_index}"
        builder.scene.add_geometry(mesh, node_name=label, geom_name=label, transform=transform, metadata=meta)
