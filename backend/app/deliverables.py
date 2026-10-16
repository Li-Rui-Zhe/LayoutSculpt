"""Human-readable project reports and version-specific download bundles."""

import asyncio
import csv
import html
import io
import json
import math
from .archive_limits import PortableArchive
from uuid import UUID

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, Response
from .plan_drawing import plan_svg, plan_dxf
from tempfile import SpooledTemporaryFile
from starlette.background import BackgroundTask

from .schemas import signed_area, Point
from .library_models import snapshot_file
from .surface_materials import MATERIALS


def material_name(identifier):
    if (identifier or "").startswith("texture:"):
        return "自定义贴图"
    return MATERIALS.get(identifier, {}).get("name", identifier or "原方案")


def floor_spec(room):
    if room.get("floor_enabled") is False:
        return "未铺地板"
    if room.get("floor_pattern") != "tiles":
        return f"原材质纹理 · 方向 {room.get('floor_rotation', 0):g}°"
    return (
        f"{room.get('floor_tile_width', 0.6) * 1000:g} × {room.get('floor_tile_depth', 0.6) * 1000:g} mm"
        f" · 缝 {room.get('floor_grout', 0.003) * 1000:g} mm · 美缝 {room.get('floor_grout_color', '#b9b5ad')}"
        f" · 方向 {room.get('floor_rotation', 0):g}°"
    )


def report_html(job, data):
    esc = lambda value: html.escape(str(value))
    points = data["outline"]
    xs, ys = [p["x"] for p in points], [p["y"] for p in points]
    origin_x, origin_y = min(xs) - 0.6, min(ys) - 0.6
    w, h = max(xs) - origin_x + 0.6, max(ys) - origin_y + 0.6
    drawing = []
    for room in data["rooms"]:
        polygon = " ".join(f"{p['x']},{p['y']}" for p in room["polygon"])
        cx = sum(p["x"] for p in room["polygon"]) / len(room["polygon"])
        cy = sum(p["y"] for p in room["polygon"]) / len(room["polygon"])
        drawing.append(
            f'<polygon points="{polygon}" fill="#eee8db" stroke="#fff" stroke-width=".02"/><text x="{cx}" y="{cy}" text-anchor="middle" font-size=".17">{esc(room["name"])}</text>'
        )
    for wall in data["walls"]:
        a, b = wall["start"], wall["end"]
        length = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
        drawing.append(
            f'<line x1="{a["x"]}" y1="{a["y"]}" x2="{b["x"]}" y2="{b["y"]}" stroke="#334d41" stroke-width="{wall["thickness"]}"/><text x="{(a["x"] + b["x"]) / 2 + 0.12}" y="{(a["y"] + b["y"]) / 2 - 0.13}" font-size=".14">{length:.2f}m</text>'
        )
    for opening in data["openings"]:
        wall = next(w for w in data["walls"] if w["id"] == opening["wall_id"])
        a, b = wall["start"], wall["end"]
        length = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        x1, y1 = (a[k] + (b[k] - a[k]) * opening["offset"] / length for k in ["x", "y"])
        x2, y2 = (
            a[k] + (b[k] - a[k]) * (opening["offset"] + opening["width"]) / length
            for k in ["x", "y"]
        )
        color = "#75aec4" if opening["kind"] == "window" else "#cfa768"
        drawing.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{wall["thickness"] + 0.03}"/>'
        )
    room_rows = "".join(
        f"<tr><td>{esc(r['name'])}</td><td>{abs(signed_area([Point(**p) for p in r['polygon']])):.2f} ㎡</td><td>{esc(material_name(r.get('floor_material')))}</td><td>{esc(floor_spec(r))}</td></tr>"
        for r in data["rooms"]
    )
    room_names = {r["id"]: r["name"] for r in data["rooms"]}
    furniture_rows = "".join(
        f"<tr><td>{esc(i.get('name') or i['kind'])}</td><td>{esc(room_names.get(i['room_id'], i['room_id']))}</td><td>{i['width']:.2f} × {i['depth']:.2f} × {i['height']:.2f} m</td></tr>"
        for i in data.get("furniture", [])
    )
    wall_rows = "".join(
        f"<tr><td>墙体 {i + 1}</td><td>{esc(material_name(r.get('material_left') or r.get('wall_material')))}</td><td>{esc(material_name(r.get('material_right') or r.get('wall_material')))}</td></tr>"
        for i, r in enumerate(data["walls"])
    )
    warnings = (job.get("result") or {}).get("quality", {}).get("issues", [])
    light_rows = "".join(
        f"<tr><td>{esc(l['name'])}</td><td>{esc(l.get('edit_group') or '未分组')}</td><td>{l.get('lumens', 800):g} lm · {l.get('temperature', 3000)} K</td><td>{'开启' if l.get('enabled', True) else '关闭'}</td></tr>"
        for l in data.get("lights", [])
    )
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>{esc(job["name"])} · 设计报告</title>
<style>body{{font:15px/1.7 system-ui,sans-serif;color:#263d32;max-width:960px;margin:32px auto;padding:0 24px}}table{{border-collapse:collapse;width:100%}}td,th{{padding:10px;border-bottom:1px solid #ddd;text-align:left}}svg{{width:100%;height:420px}}small{{color:#66766b}}h2{{margin-top:32px}}@media print{{button{{display:none}}body{{margin:0}}tr{{break-inside:avoid}}}}</style>
<button onclick="window.print()">打印 / 保存为 PDF</button><h1>{esc(job["name"])}</h1><small>版本编号 {esc(job["id"])} · {esc(job["created_at"])} · 单位：米</small>
<h2>平面与墙长</h2><svg viewBox="{origin_x} {origin_y} {w} {h}">{"".join(drawing)}</svg>
<h2>空间面积与地板</h2><table><tr><th>空间</th><th>面积</th><th>地板</th><th>铺贴规格</th></tr>{room_rows}</table>
<h2>墙面饰面</h2><table><tr><th>墙体</th><th>A 面</th><th>B 面</th></tr>{wall_rows}</table>
<h2>家具清单</h2><table><tr><th>家具</th><th>所在空间</th><th>宽 × 深 × 高</th></tr>{furniture_rows}</table>
<h2>灯光分组</h2><table><tr><th>灯具</th><th>灯组</th><th>光通量与色温</th><th>夜晚状态</th></tr>{light_rows}</table>
<h2>设计检查</h2>{"".join(f"<p>{esc(v)}</p>" for v in warnings) or "<p>本版本未记录家具检查问题。</p>"}<p>原图识别及尺寸估算请对照现场核实；本报告为方案记录。</p></html>'''


def install_delivery_routes(app, store, settings):
    async def load(job_id):
        job = await store.get(job_id.hex)
        path = settings.workspace(job_id.hex) / "layout.json"
        if not job or job["status"] != "succeeded" or not path.is_file():
            raise HTTPException(409, "请先完成此版本生成")
        return job, json.loads(
            await asyncio.to_thread(path.read_text, encoding="utf-8")
        )

    @app.get("/api/jobs/{job_id}/report", response_class=HTMLResponse)
    async def report(job_id: UUID):
        job, data = await load(job_id)
        return report_html(job, data)

    @app.get("/api/jobs/{job_id}/bundle")
    async def bundle(job_id: UUID):
        job, data = await load(job_id)

        def pack():
            output = SpooledTemporaryFile(max_size=8 * 1024 * 1024)
            with PortableArchive(output) as archive:
                for filename in [
                    "model.glb",
                    "model.blend",
                    "layout.json",
                    "manifest.json",
                    "quality-report.json",
                    "consistency-report.json",
                    "source.png",
                ]:
                    path = settings.workspace(job_id.hex) / filename
                    if path.is_file():
                        archive.write(path, filename)
                for item in data.get("furniture", []):
                    if (item.get("asset_id") or "").startswith("snapshot:"):
                        path = snapshot_file(
                            settings.data_dir / "library", item["asset_id"]
                        )
                        name = f"furniture/{path.name}"
                        if name not in archive.namelist():
                            archive.write(path, name)
                refs = [r.get("floor_material") for r in data["rooms"]]
                for w in data["walls"]:
                    refs.extend(
                        [
                            w.get("wall_material"),
                            w.get("material_left"),
                            w.get("material_right"),
                            *[r["material"] for r in w.get("finish_regions", [])],
                        ]
                    )
                for ref in set(refs):
                    if isinstance(ref, str) and ref.startswith("texture:"):
                        import re

                        if not re.fullmatch(r"texture:[a-f0-9]{64}", ref):
                            continue
                        name = f"{ref.split(':')[1]}.png"
                        archive.write(
                            settings.data_dir / "materials" / name, f"textures/{name}"
                        )
                archive.writestr("设计报告.html", report_html(job, data))
                archive.writestr("平面方案.svg", plan_svg(data))
                archive.writestr("平面方案-毫米.dxf", plan_dxf(data))
                rows = io.StringIO()
                writer = csv.writer(rows)
                writer.writerow(["家具", "房间编号", "宽(m)", "深(m)", "高(m)"])

                def safe(value):
                    text = str(value)
                    return (
                        "'" + text
                        if text.lstrip().startswith(("=", "+", "-", "@"))
                        else text
                    )

                writer.writerows(
                    [
                        safe(i.get("name") or i["kind"]),
                        safe(i["room_id"]),
                        i["width"],
                        i["depth"],
                        i["height"],
                    ]
                    for i in data.get("furniture", [])
                )
                archive.writestr("家具清单.csv", rows.getvalue().encode("utf-8-sig"))
            output.seek(0)
            return output

        try:
            output = await asyncio.to_thread(pack)
        except (ValueError, OSError) as exc:
            raise HTTPException(422, str(exc)) from exc

        def chunks():
            while chunk := output.read(1024 * 1024):
                yield chunk

        return StreamingResponse(
            chunks(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="design-{job_id.hex[:8]}.zip"'
            },
            background=BackgroundTask(output.close),
        )

    @app.get("/api/jobs/{job_id}/drawing/{format}")
    async def drawing(job_id: UUID, format: str):
        if format not in {"svg", "dxf"}:
            raise HTTPException(404, "不支持的图纸格式")
        _, data = await load(job_id)
        return Response(
            plan_svg(data) if format == "svg" else plan_dxf(data),
            media_type="image/svg+xml" if format == "svg" else "application/dxf",
            headers={
                "Content-Disposition": f'attachment; filename="plan-{job_id.hex[:8]}.{format}"'
            },
        )
