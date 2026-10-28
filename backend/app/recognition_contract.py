"""识别阶段只向模型请求原图结构，不要求填写人工编辑器的全部属性。"""

from typing import Literal

from pydantic import ConfigDict, Field

from .ai_contracts import XY, WallWire
from .schemas import Positive, StrictModel


class RecognitionRoom(StrictModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    kind: Literal[
        "living",
        "dining",
        "bedroom",
        "kitchen",
        "bathroom",
        "balcony",
        "hall",
        "study",
        "other",
    ]
    polygon: list[XY] = Field(min_length=3, max_length=24)
    balcony_type: Literal["unknown", "open", "enclosed"] = "unknown"
    floor_finish: Literal["default", "oak", "walnut", "tile", "stone"] = "default"


class RecognitionOpening(StrictModel):
    wall_id: str = Field(min_length=1, max_length=40)
    kind: Literal["door", "window", "passage"]
    offset: float = Field(ge=0, le=60)
    width: Positive
    height: float = Field(gt=0, le=4.5)
    bottom: float = Field(ge=0, le=3)
    hinge: Literal["start", "end"] = "start"
    swing: Literal["left", "right"] = "left"
    door_style: Literal["hinged", "double", "sliding"] = "hinged"
    door_material: Literal["wood", "glass"] = "wood"
    window_style: Literal["fixed", "casement", "sliding"] = "fixed"
    glass_type: Literal["clear", "frosted"] = "clear"


class RecognitionContract(StrictModel):
    model_config = ConfigDict(title="LayoutExtraction")
    title: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    scale_note: str = Field(max_length=800)
    warnings: list[str] = Field(max_length=30)
    outline: list[XY] = Field(min_length=3, max_length=512)
    rooms: list[RecognitionRoom] = Field(max_length=35)
    walls: list[WallWire] = Field(max_length=120)
    openings: list[RecognitionOpening] = Field(max_length=80)
