"""Optional ONNX worker. Runs with a separate Python when the server uses an unsupported version."""

import argparse
import json

import numpy as np
from PIL import Image

CLASSES = ("background", "wall", "window", "door")
PALETTE = [(0, 0, 0), (21, 144, 104), (27, 118, 209), (177, 62, 182)]
CPU = "CPUExecutionProvider"


def classify_span(mask, a, b, image_size):
    """Return the dominant supported class along an aperture's span, or abstain."""
    height, width = mask.shape
    ratio = np.array([width, height]) / image_size
    if np.linalg.norm((np.asarray(b) - a) * ratio) < 8:
        return None
    return classify_points(mask, np.linspace(a, b, 21)[3:-3], image_size)


def classify_points(mask, centers, image_size):
    """Classify retained source-image samples, including disjoint solid spans around openings."""
    height, width = mask.shape
    points = np.rint(centers * (np.array([width, height]) / image_size)).astype(int)
    samples = []
    for x, y in points:
        if 0 <= x < width and 0 <= y < height:
            band = mask[max(0, y - 2) : y + 3, max(0, x - 2) : x + 3]
            samples.append(np.bincount(band.ravel(), minlength=4)[1:] >= 3)
    if len(samples) < 12:
        return None
    ranked = sorted(
        zip(CLASSES[1:], np.mean(samples, axis=0), strict=True),
        key=lambda item: -item[1],
    )
    (kind, coverage), (_, second) = ranked[:2]
    return kind if coverage >= 0.8 and second <= 0.2 else None


def predict(ort, model, image):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(model, sess_options=options, providers=[CPU])
    session.disable_fallback()
    if session.get_providers() != [CPU]:
        raise RuntimeError("本地户型识别需要 CPU 推理后端")
    inputs = session.get_inputs()
    if len(inputs) != 1 or inputs[0].type != "tensor(float)":
        raise ValueError("模型需要一个 float32 RGB 输入")
    shape = inputs[0].shape
    if len(shape) != 4 or shape[:2] != [1, 3]:
        raise ValueError("模型需要固定尺寸的 1×3×H×W 输入")
    height, width = shape[2:]
    if not all(isinstance(n, int) and 128 <= n <= 1024 for n in (height, width)):
        raise ValueError("模型输入尺寸应介于 128 和 1024 之间")
    pixels = (
        np.asarray(
            image.resize((width, height), Image.Resampling.BILINEAR),
            dtype=np.float32,
        )
        / 255
    )
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = ((pixels - mean) / std).transpose(2, 0, 1)[None]
    result = session.run(None, {inputs[0].name: tensor})[0]
    if (
        result.shape != (1, len(CLASSES), height, width)
        or not np.isfinite(result).all()
    ):
        raise ValueError("模型需要输出与输入对齐的墙、窗、门分割 logits")
    logits = result[0]
    weights = np.exp(logits - logits.max(axis=0))
    classes = logits.argmax(axis=0).astype(np.uint8)
    classes[1 / weights.sum(axis=0) < 0.80] = 0
    return classes


def main():
    import onnxruntime as ort

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model")
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument(
        "--device", choices=["auto", "cpu"], help="兼容旧命令，识别始终使用 CPU"
    )
    args = parser.parse_args()
    with Image.open(args.source) as source:
        classes = predict(ort, args.model, source.convert("RGB"))
    mask = Image.fromarray(classes).convert("P")
    mask.putpalette([channel for color in PALETTE for channel in color])
    mask.save(args.output, transparency=0)
    print(json.dumps({"provider": CPU}))


if __name__ == "__main__":
    main()
