"""Detailed door/window variants in wall-local coordinates, matching the editor."""

import math


def opening_parts(opening, thickness=0.16):
    w, h, bottom = opening["width"], opening["height"], opening.get("bottom", 0)
    parts = []
    bar = min(0.045, w / 8, h / 8)
    glass = "frosted" if opening.get("glass_type") == "frosted" else "glass"

    def box(name, size, position, material="frame", angle=0):
        if min(size) > 0:
            parts.append(
                {"name":name,"size":size,"position":position,"material":material,"angle":angle}
            )

    def panel(name, x, y, width, height, z, material, angle=0, hinge=None):
        def push(label, size, px, py, pz, mat):
            if hinge is not None:
                dx = px - hinge
                px, pz = (
                    hinge + math.cos(angle) * dx + math.sin(angle) * pz,
                    -math.sin(angle) * dx + math.cos(angle) * pz,
                )
            box(label, size, [px, py, pz], mat, angle)

        push(name, [width, height, 0.025], x, y, z, material)
        if material in {"glass", "frosted"}:
            for px in [x - width / 2, x + width / 2]:
                push("扇竖框", [bar, height, 0.04], px, y, z, "frame")
            for py in [y - height / 2, y + height / 2]:
                push("扇横框", [width, bar, 0.04], x, py, z, "frame")
        push("把手", [0.025, 0.13, 0.045], x + width / 2 - 0.1, y, z + 0.04, "metal")

    if opening["kind"] == "passage":
        return parts
    for x in [bar / 2, w - bar / 2]:
        box("竖框", [bar, h, max(0.07, thickness + 0.02)], [x, bottom + h / 2, 0])
    for y in (
        [bottom + h - bar / 2]
        if opening["kind"] == "door"
        else [bottom + bar / 2, bottom + h - bar / 2]
    ):
        box("横框", [w, bar, max(0.07, thickness + 0.02)], [w / 2, y, 0])
    if opening["kind"] == "door":
        if not opening.get("door_leaf", True):
            return parts
        style = opening.get("door_style", "hinged")
        material = glass if opening.get("door_material") == "glass" else "wood"
        if style == "sliding":
            leaf = (w - 2 * bar) / 2
            for i in range(2):
                panel(
                    "推拉门扇",
                    bar + leaf * (i + 0.5),
                    bottom + h / 2,
                    leaf,
                    h - 2 * bar,
                    (i - 0.5) * 0.055,
                    material,
                )
            box("门下轨", [w, 0.025, 0.13], [w / 2, bottom + 0.0125, 0])
        else:
            angle = math.radians(opening.get("angle", 90)) * (
                -1 if opening.get("swing") == "right" else 1
            )
            if style == "double":
                leaf = (w - 2 * bar) / 2
                panel(
                    "双开门扇",
                    bar + leaf / 2,
                    bottom + h / 2,
                    leaf,
                    h - 0.05,
                    0,
                    material,
                    angle,
                    bar,
                )
                panel(
                    "双开门扇",
                    w - bar + leaf / 2,
                    bottom + h / 2,
                    leaf,
                    h - 0.05,
                    0,
                    material,
                    math.pi - angle,
                    w - bar,
                )
            else:
                end = opening.get("hinge") == "end"
                hinge = w - bar if end else bar
                panel(
                    "单开门扇",
                    hinge + (w - 2 * bar) / 2,
                    bottom + h / 2,
                    w - 2 * bar,
                    h - 0.05,
                    0,
                    material,
                    angle + (math.pi if end else 0),
                    hinge,
                )
    else:
        style = opening.get("window_style", "fixed")
        if style == "fixed":
            box(
                "固定窗玻璃",
                [w - 2 * bar, h - 2 * bar, 0.018],
                [w / 2, bottom + h / 2, 0],
                glass,
            )
            count = max(1, math.ceil(w / 1.2))
            for i in range(1, count):
                box(
                    "固定窗中梃",
                    [bar, h - 2 * bar, 0.06],
                    [w * i / count, bottom + h / 2, 0],
                )
        else:
            leaf = (w - 2 * bar) / 2
            for i in range(2):
                panel(
                    "推拉窗扇" if style == "sliding" else "平开窗扇",
                    bar + leaf * (i + 0.5),
                    bottom + h / 2,
                    leaf - bar / 2,
                    h - 2 * bar,
                    (i - 0.5) * 0.055 if style == "sliding" else 0,
                    glass,
                )
            if style == "sliding":
                box("窗下轨", [w, 0.025, 0.13], [w / 2, bottom + bar, 0])
    return parts


def add_opening_variant(builder, wall, opening):
    dx, dz = (
        wall["end"]["x"] - wall["start"]["x"],
        wall["end"]["y"] - wall["start"]["y"],
    )
    length = math.hypot(dx, dz)
    angle = -math.atan2(dz, dx)
    from trimesh.visual.material import PBRMaterial

    frosted = PBRMaterial(
        name="磨砂窗玻璃",
        baseColorFactor=[215, 229, 229, 165],
        alphaMode="BLEND",
        doubleSided=True,
        roughnessFactor=0.65,
        metallicFactor=0,
    )
    for part in opening_parts(opening, wall["thickness"]):
        x, y, z = part["position"]
        x += opening["offset"]
        builder.architectural_box(
            part["name"],
            [
                wall["start"]["x"] + x * dx / length - z * dz / length - builder.cx,
                y,
                wall["start"]["y"] + x * dz / length + z * dx / length - builder.cz,
            ],
            part["size"],
            {"frame": "white", "frosted": "glass"}.get(
                part["material"], part["material"]
            ),
            angle + part["angle"],
            frosted if part["material"] == "frosted" else None,
        )
