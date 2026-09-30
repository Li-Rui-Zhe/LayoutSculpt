"""SQLite 是任务、状态和 SSE 事件的事实来源，断线可以从事件 ID 续读。"""

import json
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

TERMINAL = {"succeeded", "failed", "cancelled"}


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path):
        self.path = path

    async def connect(self):
        db = await aiosqlite.connect(self.path, timeout=30)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        return db

    async def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = await self.connect()
        try:
            await db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, options TEXT NOT NULL,
                    status TEXT NOT NULL, stage TEXT NOT NULL, progress INTEGER NOT NULL,
                    result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id),
                    payload TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_job_id ON events(job_id,id);
            """)
            await db.commit()
        finally:
            await db.close()

    @staticmethod
    def decode(row):
        if row is None:
            return None
        value = dict(row)
        for key in ["options", "result"]:
            if value[key]:
                value[key] = json.loads(value[key])
        return value

    async def create(
        self, job_id, name, options, message="户型图上传成功，任务已加入队列"
    ):
        db = await self.connect()
        try:
            await db.execute(
                "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    job_id,
                    name,
                    json.dumps(options, ensure_ascii=False),
                    "queued",
                    "等待处理",
                    0,
                    None,
                    None,
                    now(),
                    now(),
                ),
            )
            await db.commit()
        finally:
            await db.close()
        await self.update(job_id, message=message)

    async def get(self, job_id):
        db = await self.connect()
        try:
            async with db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)) as cursor:
                return self.decode(await cursor.fetchone())
        finally:
            await db.close()

    async def list(self, limit=None):
        db = await self.connect()
        try:
            query = "SELECT * FROM jobs ORDER BY created_at DESC"
            params = ()
            if limit is not None:
                query += " LIMIT ?"
                params = (limit,)
            async with db.execute(query, params) as cursor:
                return [self.decode(r) for r in await cursor.fetchall()]
        finally:
            await db.close()

    async def update(
        self,
        job_id,
        *,
        status=None,
        stage=None,
        progress=None,
        result=None,
        error=None,
        message=None,
        agent=None,
    ):
        db = await self.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)) as cursor:
                job = self.decode(await cursor.fetchone())
            if not job or job["status"] in TERMINAL:
                await db.rollback()
                return False
            for key, value in [
                ("status", status),
                ("stage", stage),
                ("progress", progress),
                ("result", result),
                ("error", error),
            ]:
                if value is not None:
                    job[key] = value
            job["updated_at"] = now()
            await db.execute(
                "UPDATE jobs SET status=?,stage=?,progress=?,result=?,error=?,updated_at=? WHERE id=?",
                (
                    job["status"],
                    job["stage"],
                    job["progress"],
                    json.dumps(job["result"], ensure_ascii=False)
                    if job["result"]
                    else None,
                    job["error"],
                    job["updated_at"],
                    job_id,
                ),
            )
            event = {
                "job_id": job_id,
                "status": job["status"],
                "stage": job["stage"],
                "progress": job["progress"],
                "message": message or stage or job["stage"],
                "agent": agent,
                "result": job["result"],
                "error": job["error"],
            }
            await db.execute(
                "INSERT INTO events(job_id,payload,created_at) VALUES(?,?,?)",
                (job_id, json.dumps(event, ensure_ascii=False), now()),
            )
            await db.commit()
            return True
        finally:
            await db.close()

    async def events(self, job_id, after=0):
        db = await self.connect()
        try:
            async with db.execute(
                "SELECT * FROM events WHERE job_id=? AND id>? ORDER BY id LIMIT 100",
                (job_id, after),
            ) as cursor:
                return [
                    {
                        "id": r["id"],
                        **json.loads(r["payload"]),
                        "created_at": r["created_at"],
                    }
                    for r in await cursor.fetchall()
                ]
        finally:
            await db.close()

    async def recover(self):
        """不把服务器中断伪装成完成；保留数据，供用户显式重试。"""
        db = await self.connect()
        try:
            async with db.execute(
                "SELECT id FROM jobs WHERE status IN ('queued','running')"
            ) as cursor:
                ids = [r["id"] for r in await cursor.fetchall()]
        finally:
            await db.close()
        for job_id in ids:
            await self.update(
                job_id,
                status="failed",
                stage="任务中断",
                error="服务在处理过程中重启，请重试。原图和中间结果已保留。",
            )
