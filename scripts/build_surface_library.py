"""Build deterministic, tileable color/normal maps for the material sample library.

Maps are neutral so the shared catalog controls the finish, not baked-in colors.
Run with the project's Python environment; no AI service is needed.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "public" / "materials"
SIZE = 512


def noise(seed, waves=22):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[:SIZE, :SIZE] / SIZE * 2 * np.pi
    value = np.zeros((SIZE, SIZE))
    for _ in range(waves):
        a, b = rng.integers(1, 14, 2)
        value += np.sin(x * a + y * b + rng.uniform(0, 6.28)) / np.hypot(a, b)
    return value / max(value.std(), .01)


def save(name, luminance, height, strength=2):
    pixels = np.clip(luminance, 0, 255).astype(np.uint8)
    Image.fromarray(np.repeat(pixels[..., None], 3, axis=2)).save(ROOT / f"{name}_color.png")
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    normal = np.stack([-dx, -dy, np.ones_like(dx)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    Image.fromarray(np.uint8(np.clip((normal + 1) * 127.5, 0, 255))).save(ROOT / f"{name}_normal.png")


def build():
    ROOT.mkdir(parents=True, exist_ok=True)
    y, x = np.mgrid[:SIZE, :SIZE]
    rng = np.random.default_rng(42)
    grain = rng.normal(0, 1, (SIZE, SIZE))
    cloud = noise(7)
    save("plaster", 247 + grain * .6, grain * .03)
    save("limewash", 240 + cloud * 3.4 + grain * .4, cloud * .13 + grain * .03)
    save("cement", 241 + noise(10) * 1.8 + grain * .6, grain * .055)
    # Fine wood fibers and gently wandering growth lines.
    wood = np.sin(x * 2 * np.pi / 32 + np.sin(y * 2 * np.pi / SIZE) * 1.8)
    wood += .35 * np.sin(x * 2 * np.pi / 7 + np.sin(y * 4 * np.pi / SIZE))
    save("veneer", 230 + wood * 9 + grain, wood * .18)
    seams = (x % 128 < 2) | ((y + (x // 128 % 2) * 256) % 512 < 2)
    plank_tone = np.array([1, -6, 5, -2])[x // 128]
    save("boards", 232 + wood * 7 + plank_tone - seams * 30, wood * .12 - seams * .32)
    # A periodic 4:1 herringbone pattern; alternating blocks run perpendicular.
    u, v = x / 32, y / 32
    horizontal = ((np.floor(u) - np.floor(v)) % 8) < 4
    a = np.where(horizontal, u, v)
    b = np.where(horizontal, v, u)
    offset = np.where(horizontal, np.floor(v), np.floor(u) - 4)
    along = (a - offset) % 8
    joints = ((b % 1) < .05) | ((along % 4) < .05)
    fibers = np.sin(b * 22 + np.sin(a * .8))
    board = (np.floor(a - offset) // 4 + np.floor(b) * 7) % 5 - 2
    save("herringbone", 233 + fibers * 4 + board * 3 - joints * 28, fibers * .08 - joints * .28)
    joints = (x % 256 < 2) | (y % 256 < 2)
    save("tiles", 249 + grain * .4 - joints * 35, grain * .01 - joints * .3)
    veins = np.sin(y * np.pi / 16 + cloud * .8)
    pores = (cloud > 1.4) * np.maximum(veins, 0)
    save("travertine", 237 + veins * 3 - pores * 19 + grain, veins * .07 - pores * .35)
    chips = Image.new("L", (SIZE, SIZE), 244)
    draw = ImageDraw.Draw(chips)
    for _ in range(1000):
        cx, cy = rng.integers(0, SIZE, 2)
        radius = rng.integers(2, 6)
        tone = int(rng.integers(164, 248))
        points = [(int(cx + np.cos(t) * radius), int(cy + np.sin(t) * radius)) for t in np.linspace(0, 6.28, 6)[:-1]]
        for ox in (-SIZE, 0, SIZE):
            for oy in (-SIZE, 0, SIZE):
                draw.polygon([(px + ox, py + oy) for px, py in points], fill=tone)
    save("terrazzo", np.asarray(chips).astype(float) + grain * .3, grain * .025)
    threads = np.sin(x * np.pi / 4) * np.sin(y * np.pi / 4)
    save("woven", 238 + threads * 8 + grain * .5, threads * .2)
    loops = np.sin(x * np.pi / 8 + np.sin(y * np.pi / 8)) * np.cos(y * np.pi / 8)
    save("boucle", 238 + loops * 11 + grain, loops * .35 + grain * .04)
    fleece = noise(8, 80)
    save("wool", 238 + fleece * 3 + grain * 2, fleece * .08 + grain * .09)


def build_common():
    """Neutral stone prints: colour veins stay flat, joints have shallow relief."""
    ROOT.mkdir(parents=True, exist_ok=True)
    y, x = np.mgrid[:SIZE, :SIZE] / SIZE * 2 * np.pi
    grain = np.random.default_rng(106).normal(0, 1, (SIZE, SIZE))
    warp = 0.35 * noise(31, 12)
    veins = np.exp(-np.square(np.sin(x + 2 * y + warp) / 0.065))
    fine = np.exp(-np.square(np.sin(3 * x - y + warp * 0.6) / 0.035))
    color = 247 + noise(32) * 1.5 - veins * 24 - fine * 7 + grain * 0.25
    height = grain * 0.004
    save("marble", color, height)
    yy, xx = np.mgrid[:SIZE, :SIZE]
    joints = (xx % (SIZE // 2) < 2) | (yy % (SIZE // 2) < 2)
    save("marble_tiles", color - joints * 30, height - joints * 0.28)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--common-only", action="store_true")
    args = parser.parse_args()
    if not args.common_only:
        build()
    build_common()
