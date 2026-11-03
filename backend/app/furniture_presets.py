"""User-sized furniture templates, stored locally and reused without AI."""

import json
from uuid import UUID, uuid4
from fastapi import HTTPException
from .schemas import Furniture, Furnishing
from .store import now


def install_furniture_presets(app, store, library):
    @app.get("/api/furniture-presets")
    async def list_presets():
        db = await store.connect()
        try:
            async with db.execute(
                "SELECT * FROM furniture_presets ORDER BY created_at DESC"
            ) as cursor:
                return {
                    "items": [
                        {**dict(row), "item": json.loads(row["item"])}
                        for row in await cursor.fetchall()
                    ]
                }
        finally:
            await db.close()

    @app.post("/api/furniture-presets", status_code=201)
    async def save_preset(item: Furniture):
        if not item.name.strip():
            raise HTTPException(422, "请为这件家具填写名称")
        resolved = await library.resolve_furnishing(Furnishing(items=[item], notes=[]))
        value = resolved.items[0].model_dump()
        for key in list(value):
            if key.startswith("edit_") or key == "parent_furniture_id":
                value.pop(key)
        value.update(x=0, y=0, rotation=0, room_id="template")
        db = await store.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute("SELECT count(*) FROM furniture_presets") as cursor:
                if (await cursor.fetchone())[0] >= 200:
                    raise HTTPException(
                        409, "我的家具已达到 200 件，请先移除不再需要的记录"
                    )
            identifier = uuid4().hex
            await db.execute(
                "INSERT INTO furniture_presets VALUES(?,?,?)",
                (identifier, json.dumps(value, ensure_ascii=False), now()),
            )
            await db.commit()
            return {"id": identifier, "item": value}
        finally:
            await db.close()

    @app.delete("/api/furniture-presets/{preset_id}")
    async def delete_preset(preset_id: UUID):
        db = await store.connect()
        try:
            await db.execute(
                "DELETE FROM furniture_presets WHERE id=?", (preset_id.hex,)
            )
            await db.commit()
            return {"ok": True}
        finally:
            await db.close()
