"""Optional ONNX worker. Runs with a separate Python when the server uses an unsupported version."""

import argparse
import json
import platform

import numpy as np
from PIL import Image

CLASSES = ("background", "wall", "window", "door")
PALETTE = [(0, 0, 0), (21, 144, 104), (27, 118, 209), (177, 62, 182)]
CPU = "CPUExecutionProvider"


def accelerated_providers(available, system):
    candidates = {
        "Darwin": ["CoreMLExecutionProvider"],
        "Windows": ["DmlExecutionProvider", "CUDAExecutionProvider"],
        "Linux": ["CUDAExecutionProvider"],
    }
    return [
        provider for provider in candidates.get(system, []) if provider in available
    ]


def predict(ort, model, image, device):
    preferred = (
        []
        if device == "cpu"
        else accelerated_providers(ort.get_available_providers(), platform.system())
    )
    for provider in [*preferred, CPU]:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        providers = [provider]
        if provider != CPU:
            providers.append(CPU)
        if provider == "DmlExecutionProvider":
            options.enable_mem_pattern = False
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        if provider == "CoreMLExecutionProvider":
            providers[0] = (
                provider,
                {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"},
            )
        try:
            session = ort.InferenceSession(
                model, sess_options=options, providers=providers
            )
            session.disable_fallback()
            if provider not in session.get_providers():
                continue
            inputs = session.get_inputs()
            if len(inputs) != 1 or inputs[0].type != "tensor(float)":
                raise ValueError("模型需要一个 float32 RGB 输入")
            shape = inputs[0].shape
            if len(shape) != 4 or shape[:2] != [1, 3]:
                raise ValueError("模型需要固定尺寸的 1×3×H×W 输入")
            height, width = shape[2:]
            if not all(
                isinstance(n, int) and 128 <= n <= 1024 for n in (height, width)
            ):
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
        except (
            RuntimeError,
            ValueError,
            ort.capi.onnxruntime_pybind11_state.Fail,
            ort.capi.onnxruntime_pybind11_state.EPFail,
            ort.capi.onnxruntime_pybind11_state.RuntimeException,
            ort.capi.onnxruntime_pybind11_state.InvalidArgument,
        ):
            if provider == CPU:
                raise
            continue
        logits = result[0]
        weights = np.exp(logits - logits.max(axis=0))
        classes = logits.argmax(axis=0).astype(np.uint8)
        classes[1 / weights.sum(axis=0) < 0.80] = 0
        return classes, provider
    raise RuntimeError("没有可用的推理后端")


def main():
    import onnxruntime as ort

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model")
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--device", choices=["auto", "cpu"], default="auto")
    args = parser.parse_args()
    with Image.open(args.source) as source:
        classes, provider = predict(ort, args.model, source.convert("RGB"), args.device)
    mask = Image.fromarray(classes).convert("P")
    mask.putpalette([channel for color in PALETTE for channel in color])
    mask.save(args.output, transparency=0)
    print(json.dumps({"provider": provider}))


if __name__ == "__main__":
    main()
