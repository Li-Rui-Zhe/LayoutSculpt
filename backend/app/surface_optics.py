"""墙地面光学参数；与颜色贴图分开保存，导出使用标准 glTF 扩展。"""

from pydantic import BaseModel, ConfigDict, Field


class SurfaceOptics(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    transmission: float = Field(default=0, ge=0, le=1)
    metalness: float = Field(default=0, ge=0, le=1)
    ior: float = Field(default=1.5, ge=1, le=2.5)
    thickness: float = Field(default=0.01, ge=0, le=0.5)


def gltf_optics(optics):
    if not optics or optics.transmission <= 0:
        return {}
    return {
        "KHR_materials_transmission": {"transmissionFactor": optics.transmission},
        "KHR_materials_ior": {"ior": optics.ior},
        "KHR_materials_volume": {"thicknessFactor": optics.thickness},
    }
