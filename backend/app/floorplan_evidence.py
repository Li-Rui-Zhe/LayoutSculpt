"""Run the local segmenter and compare its pixel evidence with candidate geometry."""

import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

from .architecture import wall_line
from .opening_review import NAMES, classify_span

MASK_FILE = "local-floorplan-mask.png"
WORKER = Path(__file__).with_name("floorplan_inference.py")
LOGGER = logging.getLogger(__name__)


def configuration(data_dir):
    model = Path(
        os.getenv("STUDIO_FLOORPLAN_MODEL")
        or data_dir / "floorplan-model" / "structure.onnx"
    )
    executable = (
        data_dir
        / "floorplan-runtime"
        / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    python = os.getenv("STUDIO_FLOORPLAN_PYTHON") or (
        str(executable) if executable.is_file() else sys.executable
    )
    return model, python


def run_floorplan_evidence(data_dir, source):
    model, python = configuration(data_dir)
    if not model.is_file():
        return None
    device = "cpu" if os.getenv("STUDIO_FLOORPLAN_DEVICE") == "cpu" else "auto"
    try:
        with TemporaryDirectory(prefix="floorplan-", dir=source.parent) as scratch:
            file = Path(scratch) / MASK_FILE
            command = [
                python,
                str(WORKER),
                str(model.resolve()),
                str(source),
                str(file),
                "--device",
                device,
            ]
            result = subprocess.run(
                command,
                capture_output=True,
                check=True,
                timeout=45,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            metadata = json.loads(result.stdout)
            with Image.open(file) as image:
                if image.mode != "P" or max(image.size) > 1024:
                    raise ValueError("无效的本地分割图")
                mask = np.asarray(image).copy()
            if not (0 < np.count_nonzero(mask) <= mask.size * 0.65):
                return None
            if mask.max() > 3 or not np.any(mask == 1):
                return None
            file.replace(source.parent / MASK_FILE)
            return mask, {"provider": metadata["provider"], "artifact": MASK_FILE}
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        LOGGER.warning("本地户型分割暂不可用 (%s)", type(error).__name__)
        return None


def compare_floorplan_mask(mask, layout, alignment):
    """Report positive class disagreement, without treating missing pixels as proof."""
    height, width = mask.shape
    ratio = np.array(
        [width / alignment["image_width"], height / alignment["image_height"]]
    )
    origin = np.array(alignment["origin_px"])
    scale = alignment["meters_per_pixel"]
    walls = {wall["id"]: wall_line(wall) for wall in layout["walls"]}
    findings = []

    for opening in layout["openings"]:
        if opening["kind"] not in {"window", "door"}:
            continue
        wall = walls[opening["wall_id"]]
        points = [
            wall.interpolate(offset)
            for offset in (opening["offset"], opening["offset"] + opening["width"])
        ]
        ends = np.array([(point.x, point.y) for point in points]) / scale + origin
        predicted = classify_span(
            mask, *ends, (alignment["image_width"], alignment["image_height"])
        )
        if predicted is None or predicted == opening["kind"]:
            continue
        kind = NAMES[opening["kind"]]
        suggestion = NAMES[predicted]
        left, top = ends.min(axis=0).tolist()
        right, bottom = ends.max(axis=0).tolist()
        x_pad, y_pad = (4 / ratio).tolist()
        findings.append(
            {
                "code": "local_opening_disagreement",
                "blocking": False,
                "message": f"本地分割在候选{kind}位置读到{suggestion}，请对照原图核对。",
                "box": [
                    max(0.0, left - x_pad),
                    max(0.0, top - y_pad),
                    min(alignment["image_width"], right + x_pad),
                    min(alignment["image_height"], bottom + y_pad),
                ],
            }
        )
    return findings[:12]
