"""将 record_readme.mjs 的实际页面帧编码为公开 GIF，原始帧留在 data/。"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]


def main():
    fonts = [Path("C:/Windows/Fonts/msyh.ttc"), Path("/System/Library/Fonts/PingFang.ttc")]
    font = next((ImageFont.truetype(str(p), 17) for p in fonts if p.exists()), ImageFont.load_default())
    for name in ("showcase", "materials", "diy", "ai-connections"):
        manifest = json.loads((ROOT / "data/readme-recording" / f"{name}.json").read_text(encoding="utf-8"))
        frames = []
        for item in manifest["frames"]:
            with Image.open(item["file"]) as original:
                scene = original.convert("RGB").resize((1024, 720), Image.Resampling.LANCZOS)
            frame = Image.new("RGB", (1024, 764), "#17392f")
            frame.paste(scene, (0, 0))
            ImageDraw.Draw(frame).text((22, 731), item["label"], font=font, fill="#f3f3e7")
            frames.append(frame)
        # 全局色板减少帧间颜色闪烁，不使用会造成文字噪点的抖动。
        strip = Image.new("RGB", (256, 192 * len(frames)))
        for index, frame in enumerate(frames):
            strip.paste(frame.resize((256, 192)), (0, index * 192))
        palette = strip.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
        indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
        target = ROOT / "docs/images" / f"{name}.gif"
        indexed[0].save(target, save_all=True, append_images=indexed[1:],
                        duration=[item["duration"] for item in manifest["frames"]],
                        loop=0, optimize=True, disposal=1)
        print(f"{name}: {len(frames)} frames, {target.stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
