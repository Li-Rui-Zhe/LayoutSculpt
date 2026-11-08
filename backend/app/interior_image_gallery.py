"""Local-only storage for submitted views and completed interior images."""

import io
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from PIL import Image

from .ai_credentials import atomic_private_write

MEDIA_TYPES = {
    "view.jpg": "image/jpeg",
    "thumbnail.jpg": "image/jpeg",
    "result.png": "image/png",
}


class InteriorImageGallery:
    def __init__(self, data_dir):
        self.root = data_dir.resolve() / "interior_images"

    def _folder(self, identifier):
        if not re.fullmatch(r"[0-9a-f]{32}", identifier):
            raise ValueError("invalid interior image ID")
        folder = self.root / identifier
        if folder.resolve() != folder:
            raise ValueError("invalid interior image directory")
        return folder

    def _write_record(self, folder, record):
        atomic_private_write(
            folder / "record.json",
            json.dumps(record, ensure_ascii=False).encode("utf-8"),
        )

    def create(self, prompt, view):
        record = {
            "id": uuid4().hex,
            "created_at": datetime.now(UTC).isoformat(),
            "prompt": prompt,
        }
        folder = self._folder(record["id"])
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with TemporaryDirectory(prefix=".new-", dir=self.root) as staging:
            pending = Path(staging)
            atomic_private_write(pending / "view.jpg", view)
            self._write_record(pending, record)
            pending.rename(folder)
        return self.public_record(record, active_id=record["id"])

    def complete(self, identifier, png):
        folder = self._folder(identifier)
        thumb = io.BytesIO()
        with Image.open(io.BytesIO(png), formats=["PNG"]) as image:
            image.thumbnail((480, 480), Image.Resampling.LANCZOS)
            image.convert("RGB").save(thumb, format="JPEG", quality=85)
        atomic_private_write(folder / "thumbnail.jpg", thumb.getvalue())
        # Publishing the final file is the commit point for a completed record.
        atomic_private_write(folder / "result.png", png)

    def fail(self, record, message):
        stored = {key: record[key] for key in ("id", "created_at", "prompt")}
        self._write_record(self._folder(stored["id"]), {**stored, "error": message})

    def media_file(self, identifier, filename):
        if filename not in MEDIA_TYPES:
            return None
        folder = self._folder(identifier)
        path = folder / filename
        if path.resolve() == path and path.is_file():
            return path
        return None

    def public_record(self, record, active_id):
        identifier = record["id"]
        base = f"/api/interior-images/{identifier}"
        ready = self.media_file(identifier, "result.png") is not None
        generating = not ready and identifier == active_id
        return {
            "id": identifier,
            "created_at": record["created_at"],
            "prompt": record["prompt"],
            "status": "ready" if ready else "generating" if generating else "failed",
            "view_url": f"{base}/view.jpg",
            "image_url": f"{base}/result.png" if ready else None,
            "thumbnail_url": f"{base}/thumbnail.jpg" if ready else None,
            "error": None
            if ready or generating
            else record.get("error") or "生成已中断，或图片未能保存。",
        }

    def list(self, active_id):
        if self.root.resolve() != self.root:
            raise ValueError("invalid interior image gallery directory")
        items = []
        for path in self.root.glob("*/record.json"):
            try:
                if path.resolve() != path:
                    continue
                record = json.loads(path.read_text(encoding="utf-8"))
                if record["id"] != path.parent.name or not isinstance(
                    record["prompt"], str
                ):
                    continue
                datetime.fromisoformat(record["created_at"])
                items.append(self.public_record(record, active_id))
            except (OSError, ValueError, KeyError, TypeError):
                continue
        return sorted(items, key=lambda item: item["created_at"], reverse=True)
