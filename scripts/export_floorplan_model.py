"""Export an OpenBIM FloorPlan AI M2-DA checkpoint to the optional ONNX runtime."""

import argparse
from pathlib import Path
from tempfile import TemporaryDirectory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    import numpy as np
    import segmentation_models_pytorch as smp
    import torch

    torch.set_num_threads(2)
    scalar = np._core.multiarray.scalar
    # The released checkpoint includes NumPy training metrics as well as tensors.
    with torch.serialization.safe_globals(
        [
            (scalar, "numpy.core.multiarray.scalar"),
            np.dtype,
            np.dtypes.Float64DType,
            np.dtypes.Float32DType,
            np.dtypes.Int64DType,
        ]
    ):
        checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)

    model = smp.Unet(encoder_name="resnet34", encoder_weights=None, classes=4)
    model.load_state_dict(checkpoint.get("model_state_dict", checkpoint))
    model.eval()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with (
        TemporaryDirectory(dir=args.output.parent) as temporary,
        torch.inference_mode(),
    ):
        exported = Path(temporary) / "structure.onnx"
        torch.onnx.export(
            model,
            torch.zeros(1, 3, 512, 512),
            str(exported),
            input_names=["image"],
            output_names=["logits"],
            opset_version=17,
            dynamo=False,
            external_data=False,
        )
        exported.replace(args.output)


if __name__ == "__main__":
    main()
