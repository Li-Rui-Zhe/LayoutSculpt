"""导入和导出共用的项目包预算。"""

import zipfile
from pathlib import Path

MAX_ENTRIES = 200
MAX_COMPRESSED = 200 * 1024 * 1024
MAX_UNCOMPRESSED = 400 * 1024 * 1024


def entry_limit(name):
    if name == "layout.json":
        return 2 * 1024 * 1024
    if name == "source.png":
        return 20 * 1024 * 1024
    if name.startswith("furniture/"):
        return 100 * 1024 * 1024
    if name.startswith("textures/"):
        return 10 * 1024 * 1024
    return MAX_UNCOMPRESSED


class PortableArchive(zipfile.ZipFile):
    def __init__(self, output):
        super().__init__(output, "w", zipfile.ZIP_DEFLATED)
        self.output = output
        self.total = 0

    def reserve(self, name, size):
        if (
            len(self.filelist) >= MAX_ENTRIES
            or self.total + size > MAX_UNCOMPRESSED
            or size > entry_limit(name)
        ):
            raise ValueError(
                "项目包超过可恢复上限，请减少模型或贴图数量；可单独下载 GLB 成果"
            )
        self.total += size

    def check_size(self):
        if self.output.tell() > MAX_COMPRESSED:
            raise ValueError("项目包超过 200 MB，无法导入恢复；请减少模型或贴图数量")

    def write(self, filename, arcname=None, **kwargs):
        self.reserve(arcname or str(filename), Path(filename).stat().st_size)
        super().write(filename, arcname, **kwargs)
        self.check_size()

    def writestr(self, name, data, **kwargs):
        self.reserve(name, len(data.encode("utf-8") if isinstance(data, str) else data))
        super().writestr(name, data, **kwargs)
        self.check_size()

    def __exit__(self, kind, value, tb):
        try:
            super().__exit__(kind, value, tb)
            if kind is None:
                self.check_size()
        except BaseException:
            self.output.close()
            raise
        if kind is not None:
            self.output.close()
