"""Local-only storage for submitted views and completed interior images."""

import io
import json
import re
import shutil
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

    def create(self, prompt, view, context=None):
        record = self.create_batch(prompt, [(view, context or {})])[0]
        return self.public_record(record, active_id=record["id"])

    def create_batch(self, prompt, entries, batch_id=None):
        records = []
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with TemporaryDirectory(prefix=".new-", dir=self.root) as staging:
            for view, context in entries:
                identifier = uuid4().hex
                record = {
                    "id": identifier,
                    "created_at": datetime.now(UTC).isoformat(),
                    "prompt": prompt,
                    "context": context,
                }
                if batch_id:
                    record.update(batch_id=batch_id, queued=True)
                folder = Path(staging) / identifier
                folder.mkdir(mode=0o700)
                atomic_private_write(folder / "view.jpg", view)
                self._write_record(folder, record)
                records.append(record)
            published = []
            try:
                for record in records:
                    identifier = record["id"]
                    folder = self._folder(identifier)
                    (Path(staging) / identifier).rename(folder)
                    published.append(folder)
            except (OSError, ValueError):
                for folder in published:
                    shutil.rmtree(folder)
                raise
        return records

    def start(self, identifier):
        record = self.read(identifier)
        view = self.media_file(identifier, "view.jpg")
        if view is None:
            raise ValueError("missing saved reference")
        data = view.read_bytes()
        self._write_record(self._folder(identifier), {**record, "queued": False})
        return record, data

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
        stored = self.read(record["id"])
        self._write_record(
            self._folder(stored["id"]), {**stored, "queued": False, "error": message}
        )

    def read(self, identifier):
        path = self._folder(identifier) / "record.json"
        if path.resolve() != path:
            raise ValueError("invalid record")
        return json.loads(path.read_text(encoding="utf-8"))

    def archive(self, identifier, archived):
        record = self.read(identifier)
        self._write_record(self._folder(identifier), {**record, "archived": archived})

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
        queued = bool(not ready and not generating and record.get("queued"))
        return {
            "id": identifier,
            "created_at": record["created_at"],
            "prompt": record["prompt"],
            "context": record.get("context", {}),
            "archived": bool(record.get("archived", False)),
            "status": "ready"
            if ready
            else "generating"
            if generating
            else "queued"
            if queued
            else "failed",
            **({"batch_id": record["batch_id"]} if record.get("batch_id") else {}),
            "view_url": f"{base}/view.jpg",
            "image_url": f"{base}/result.png" if ready else None,
            "thumbnail_url": f"{base}/thumbnail.jpg" if ready else None,
            "error": None
            if ready or generating or queued
            else record.get("error") or "生成已中断，或图片未能保存。",
        }

    def list(self, active_id, queued_only=False):
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
                if queued_only and not record.get("queued"):
                    continue
                items.append(self.public_record(record, active_id))
            except (OSError, ValueError, KeyError, TypeError):
                continue
        return sorted(items, key=lambda item: item["created_at"], reverse=True)
