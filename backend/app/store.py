"""SQLite 是任务、状态和 SSE 事件的事实来源，断线可以从事件 ID 续读。"""

import json
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from fastapi import HTTPException
from .idempotency import creation_context
from .public_errors import public_message

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
                CREATE INDEX IF NOT EXISTS jobs_updated_id ON jobs(updated_at,id);
                CREATE INDEX IF NOT EXISTS jobs_created_id ON jobs(created_at,id);
                CREATE TABLE IF NOT EXISTS creation_requests (
                    key TEXT PRIMARY KEY, route TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    status INTEGER NOT NULL, body BLOB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS creation_jobs (
                    key TEXT PRIMARY KEY, route TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    job_id TEXT NOT NULL REFERENCES jobs(id)
                );
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
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')")
            if (await cursor.fetchone())[0] >= 64:
                raise HTTPException(429, "生成队列已满，请等待或取消部分任务后再提交")
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
            context = creation_context.get()
            if context and context["store"] == str(self.path):
                await db.execute(
                    "INSERT INTO creation_jobs VALUES(?,?,?,?)",
                    (context["key"], context["route"], context["fingerprint"], job_id),
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
        expected_status=None,
    ):
        db = await self.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)) as cursor:
                job = self.decode(await cursor.fetchone())
            if not job or job["status"] in TERMINAL or (expected_status and job["status"] != expected_status):
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
                result = [
                    {
                        "id": r["id"],
                        **json.loads(r["payload"]),
                        "created_at": r["created_at"],
                    }
                    for r in await cursor.fetchall()
                ]
                for item in result:
                    if item.get("error"):
                        item["error"] = public_message(item["error"])
                        item["message"] = public_message(item.get("message", ""))
                return result
        finally:
            await db.close()

    async def continue_job(self, job_id, revision):
        """只重开用户看到的失败版本；旧请求不能意外重开下一次失败。"""
        db = await self.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute("SELECT * FROM jobs WHERE id=?", (job_id,))
            job = self.decode(await cursor.fetchone())
            if not job or job["status"] not in {"failed", "cancelled"} or job["updated_at"] != revision:
                await db.rollback()
                return False
            cursor = await db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')")
            if (await cursor.fetchone())[0] >= 64:
                raise HTTPException(429, "生成队列已满，请等待部分任务完成后继续")
            result = dict(job.get("result") or {})
            result.pop("failure", None)
            stage = "等待继续生成"
            stamp = now()
            await db.execute(
                "UPDATE jobs SET status='queued',stage=?,error=NULL,result=?,updated_at=? WHERE id=?",
                (stage, json.dumps(result, ensure_ascii=False) if result else None, stamp, job_id),
            )
            await db.execute(
                "INSERT INTO events(job_id,payload,created_at) VALUES(?,?,?)",
                (job_id, json.dumps({
                    "job_id": job_id, "status": "queued", "stage": stage,
                    "progress": job["progress"], "result": result or None,
                    "error": None, "agent": None,
                    "message": "沿用原设置，检查已完成步骤后继续生成；已有设计版本保持保留",
                }, ensure_ascii=False), stamp),
            )
            await db.commit()
            return True
        finally:
            await db.close()

    async def open_recognition_review(self, job_id, revision, result):
        db = await self.connect()
        try:
            await db.execute("BEGIN IMMEDIATE")
            stamp = now()
            stage = "识别结果需要你确认"
            cursor = await db.execute(
                "UPDATE jobs SET status='awaiting_review',stage=?,progress=12,error=NULL,result=?,updated_at=? WHERE id=? AND status='failed' AND updated_at=?",
                (stage, json.dumps(result, ensure_ascii=False), stamp, job_id, revision),
            )
            if not cursor.rowcount:
                await db.rollback()
                return False
            await db.execute("INSERT INTO events(job_id,payload,created_at) VALUES(?,?,?)", (
                job_id, json.dumps({"job_id": job_id, "status": "awaiting_review", "stage": stage,
                    "progress": 12, "result": result, "error": None, "agent": None,
                    "message": result["recognition_review"]["message"]}, ensure_ascii=False), stamp))
            await db.commit()
            return True
        finally:
            await db.close()

    async def recover(self):
        """Requeue interrupted work; the runner verifies and resumes checkpoints."""
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
                status="queued",
                stage="服务已恢复，等待继续处理",
                message="服务已恢复，正在检查已完成步骤并继续处理，无需重新上传",
            )
        return ids
