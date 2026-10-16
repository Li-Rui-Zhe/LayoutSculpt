"""最近任务与按需历史页，附带父版本保证项目关联。"""

from fastapi import HTTPException


def install_job_pages(app, store, public):
    @app.get("/api/jobs/page")
    async def page(before: str = ""):
        parts = before.split("|", 1) if before else None
        if before and (len(before) > 100 or len(parts) != 2):
            raise HTTPException(422, "历史任务游标无效")
        db = await store.connect()
        try:
            await db.execute("BEGIN")
            latest = await (
                await db.execute(
                    "SELECT updated_at,id FROM jobs ORDER BY updated_at DESC,id DESC LIMIT 1"
                )
            ).fetchone()
            cursor = f"{latest[0]}|{latest[1]}" if latest else ""
            query = "SELECT * FROM jobs"
            values = ()
            if parts:
                query += " WHERE (created_at,id)<(?,?)"
                values = tuple(parts)
            rows = await (
                await db.execute(
                    query + " ORDER BY created_at DESC,id DESC LIMIT 41", values
                )
            ).fetchall()
            more = len(rows) > 40
            rows = rows[:40]
            next_before = f"{rows[-1]['created_at']}|{rows[-1]['id']}" if more else None
            items = {r["id"]: public(store.decode(r)) for r in rows}
            if not before:
                active = await (
                    await db.execute(
                        "SELECT * FROM jobs WHERE status IN ('queued','running','awaiting_review')"
                    )
                ).fetchall()
                items.update({r["id"]: public(store.decode(r)) for r in active})
            pending = list(items.values())
            while pending:
                item = pending.pop()
                parent = next(
                    (
                        item.get(k)
                        for k in [
                            "edited_of",
                            "refine_of",
                            "restructure_of",
                            "rebuild_of",
                        ]
                        if item.get(k)
                    ),
                    None,
                )
                if parent and parent not in items:
                    row = await (
                        await db.execute("SELECT * FROM jobs WHERE id=?", (parent,))
                    ).fetchone()
                    if row:
                        ancestor = public(store.decode(row))
                        items[parent] = ancestor
                        pending.append(ancestor)
            return {
                "items": list(items.values()),
                "before": next_before,
                "cursor": cursor,
            }
        finally:
            await db.close()
