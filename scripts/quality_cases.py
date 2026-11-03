"""独立人工标注案例的读取；不以 AI 自报置信度作真值。"""
import hashlib
import json
import re
from pathlib import Path
from PIL import Image, ImageOps
from shapely.geometry import Polygon


def load_quality_cases(manifest, folder):
    manifest = Path(manifest).resolve()
    data = json.loads(manifest.read_text(encoding="utf-8"))
    cases = data.get("cases", [])
    if not cases or not isinstance(cases, list):
        raise ValueError("案例清单必须包含非空 cases 数组")
    rows, signature = [], []
    seen = set()
    for case in cases:
        key = case.get("id", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key) or key in seen:
            raise ValueError("案例 ID 必须唯一，且仅含字母、数字、短横线和下划线")
        seen.add(key)
        if case.get("annotation") != "human_verified":
            raise ValueError(f"{key}：需要人工核对过的独立期望结构")
        expected = case.get("expected", {})
        required = {"outline", "area", "bedrooms", "windows", "doors", "room_points", "opening_points"}
        if not required <= expected.keys():
            raise ValueError(f"{key}：期望结构缺少 {sorted(required - expected.keys())}")
        polygon = Polygon(expected["outline"])
        if not polygon.is_valid or polygon.area <= 0 or expected["area"] <= 0:
            raise ValueError(f"{key}：期望外轮廓或面积无效")
        image = (manifest.parent / case["image"]).resolve()
        # 清单可以使用旁边的子目录，不能通过目录穿越读取别处文件。
        if not image.is_relative_to(manifest.parent) or not image.is_file():
            raise ValueError(f"{key}：图片必须位于清单所在目录内")
        digest = hashlib.sha256(image.read_bytes()).hexdigest()
        signature.append({"id": key, "image_sha256": digest, "expected": expected,
                          "origin": case.get("origin", "unspecified"), "annotation": "human_verified"})
        rows.append((key, image, expected))
    folder = Path(folder)
    stamp = folder / "dataset.json"
    if stamp.exists() and json.loads(stamp.read_text(encoding="utf-8")) != signature:
        raise ValueError("恢复验收时原图或人工标注已变化，请新建验收记录")
    folder.mkdir(parents=True, exist_ok=True)
    for key, image, _ in rows:
        with Image.open(image) as source:
            ImageOps.exif_transpose(source).convert("RGB").save(folder / f"{key}.png")
    stamp.write_text(json.dumps(signature, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {key: expected for key, _, expected in rows}
