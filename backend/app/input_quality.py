"""原图可用性检查；拒绝原图不属于可重试的结构解析错误。"""

from typing import Literal

from pydantic import Field, model_validator

from .schemas import StrictModel


class InputCheck(StrictModel):
    status: Literal["usable", "rejected"]
    reason: Literal["none", "not_floorplan", "severe_blur", "cropped_structure", "unreadable"]
    evidence: str = Field(min_length=4, max_length=300, description="基于原图说明具体可见依据，不能只写置信度低")

    @model_validator(mode="after")
    def consistent(self):
        if (self.status == "usable") != (self.reason == "none"):
            raise ValueError("原图可用性状态与原因不一致")
        if len(self.evidence.strip()) < 4:
            raise ValueError("请说明原图中的具体依据")
        return self


INPUT_MESSAGES = {
    "not_floorplan": "这张图片未能识别为二维户型图，请上传展示房间、墙体和门窗的平面图。",
    "severe_blur": "这张图片的主要墙线过于模糊，无法可靠识别，请更换清晰原图。",
    "cropped_structure": "这张图片缺少关键户型结构，请上传包含完整住宅边界的图片。",
    "unreadable": "这张图片的主要空间结构无法辨认，请更换完整、清晰的户型图。",
}


class SourceImageRejected(Exception):
    def __init__(self, check: InputCheck):
        self.check = check
        super().__init__(INPUT_MESSAGES[check.reason])
