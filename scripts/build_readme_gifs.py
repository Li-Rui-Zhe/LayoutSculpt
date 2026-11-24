"""Encode complete, isolated UI recordings into a coherent README media set."""

import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.getenv("README_RECORDING_DIR", ROOT / "data/readme-recording"))
TARGET = ROOT / "docs/images"
GROUPS = {
    "showcase": ("01", "空间预览", "SPACE", "workbench.webp"),
    "materials": ("02", "材质搭配", "MATERIALS", "materials-poster.webp"),
    "furniture": ("03", "家具素材", "CATALOG", "furniture-poster.webp"),
    "diy": ("04", "家具创作", "FURNITURE", "diy-poster.webp"),
    "ai-connections": ("05", "模型接入", "CONNECTIONS", "ai-connections-poster.webp"),
    "recognition": ("06", "户型图转 3D", "FLOOR PLAN", "recognition-poster.webp"),
}


def font(size):
    for p in (
        "C:/Windows/Fonts/msyh.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size=size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("group", nargs="?", choices=GROUPS)
    group = parser.parse_args().group
    names = [group] if group else [
        name for name in GROUPS
        if name != "recognition" or (SOURCE / "recognition.json").is_file()
    ]
    manifests = {
        name: json.loads((SOURCE / f"{name}.json").read_text(encoding="utf-8-sig"))
        for name in names
    }
    for name, m in manifests.items():
        if (
            m.get("schema") != 2
            or m.get("status") != "complete"
            or not m.get("frames")
            or m.get("errors")
            or m.get("blocked_writes")
        ):
            raise ValueError(f"{name}: 录制尚未完整通过，不发布不完整 GIF")
        for item in m["frames"]:
            if not Path(item["file"]).is_file():
                raise FileNotFoundError(item["file"])
    TARGET.mkdir(parents=True, exist_ok=True)
    summary = []
    for name, m in manifests.items():
        number, title, english, poster = GROUPS[name]
        labels = list(dict.fromkeys(x["label"] for x in m["frames"]))
        scenes = []
        for item in m["frames"]:
            with Image.open(item["file"]) as image:
                image = image.convert("RGB")
                if name == "recognition":
                    scenes.append(ImageOps.pad(image, (1024, 620), method=Image.Resampling.LANCZOS, color="white"))
                    continue
                h = round(image.height * 1024 / image.width)
                scenes.append(image.resize((1024, h), Image.Resampling.LANCZOS))
        height = max(x.height for x in scenes)
        duration = sum(x["duration"] for x in m["frames"])
        elapsed = 0
        frames = []
        for image, item in zip(scenes, m["frames"]):
            frame = Image.new("RGB", (1024, height + 74), "#f5f3ec")
            frame.paste(image, (0, 0))
            d = ImageDraw.Draw(frame)
            d.line((0, height, 1024, height), fill="#d9dfd2")
            d.text(
                (22, height + 12), f"{number} / {title}", font=font(16), fill="#294e3d"
            )
            d.text((22, height + 38), item["label"], font=font(13), fill="#657261")
            step = labels.index(item["label"]) + 1
            d.text((826, height + 15), english, font=font(12), fill="#71816c")
            d.text(
                (941, height + 38),
                f"{step:02d} / {len(labels):02d}",
                font=font(12),
                fill="#8b947f",
            )
            elapsed += item["duration"]
            d.rectangle(
                (0, height + 71, round(1024 * elapsed / duration), height + 73),
                fill="#a5b99b",
            )
            frames.append(frame)
        if name == "recognition":
            # Preserve the thin, saturated opening marks alongside the muted GLB frames.
            indexed = [
                f.quantize(colors=256, method=Image.Quantize.MAXCOVERAGE)
                for f in frames
            ]
        else:
            strip = Image.new("RGB", (256, 192 * len(frames)))
            for i, f in enumerate(frames):
                strip.paste(f.resize((256, 192)), (0, i * 192))
            palette = strip.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
            indexed = [
                f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames
            ]
        target = TARGET / f"{name}.gif"
        indexed[0].save(
            target,
            save_all=True,
            append_images=indexed[1:],
            duration=[x["duration"] for x in m["frames"]],
            loop=0,
            optimize=True,
            disposal=1,
        )
        cover = frames[0]
        if name == "recognition":
            cover = Image.new("RGB", (1024, 362), "#f5f3ec")
            draw = ImageDraw.Draw(cover)
            for x, scene, caption in [(0, scenes[0], "合成户型原图"), (512, scenes[-1], "同一户型的三维成品")]:
                cover.paste(scene.resize((512, 310), Image.Resampling.LANCZOS), (x, 0))
                draw.text((x + 24, 325), caption, font=font(16), fill="#294e3d")
        cover.save(TARGET / poster, format="WEBP", quality=88, method=6)
        for index in sorted({0, len(indexed) // 2, len(indexed) - 1}):
            indexed[index].convert("RGB").save(SOURCE / f"{name}-qa-{index}.png")
        with Image.open(target) as check:
            total = 0
            for i in range(check.n_frames):
                check.seek(i)
                check.load()
                total += check.info.get("duration", 0)
            if abs(total - duration) > len(frames) * 10:
                raise ValueError(f"{name}: 动画时长异常")
            summary.append(
                {
                    "name": name,
                    "frames": check.n_frames,
                    "size": check.size,
                    "duration_ms": total,
                    "bytes": target.stat().st_size,
                }
            )
    if "showcase" in manifests:
        with Image.open(SOURCE / "showcase-canvas.png") as image:
            image = image.convert("RGB")
            image.thumbnail((1200, 900), Image.Resampling.LANCZOS)
            image.save(TARGET / "showcase-garden.webp", quality=89, method=6)
    (SOURCE / "media-report.json").write_text(
        json.dumps(
            {"groups": summary, "total_gif_bytes": sum(x["bytes"] for x in summary)},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {"groups": summary, "total_gif_bytes": sum(x["bytes"] for x in summary)},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
