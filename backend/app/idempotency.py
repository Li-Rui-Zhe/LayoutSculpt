"""按请求加锁；任务与请求标识同事务写入，响应丢失后仍可恢复。"""

import asyncio
import hashlib
import json
import re
from contextvars import ContextVar

from fastapi.responses import JSONResponse, Response
from starlette.datastructures import UploadFile

creation_context = ContextVar("creation_context", default=None)


async def fingerprint_request(request):
    raw = await request.body()
    if "multipart/form-data" not in request.headers.get("content-type", ""):
        return hashlib.sha256(raw).hexdigest()
    values = []
    async with request.form() as form:
        for name, value in form.multi_items():
            if isinstance(value, UploadFile):
                digest = hashlib.sha256()
                while chunk := await value.read(1024 * 1024):
                    digest.update(chunk)
                value = {
                    "filename": value.filename,
                    "type": value.content_type,
                    "sha256": digest.hexdigest(),
                }
            values.append([name, value])
    values.sort(key=lambda row: (row[0], json.dumps(row[1], sort_keys=True)))
    return hashlib.sha256(
        json.dumps(values, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


def install_idempotency(app, store, public=None):
    locks = {}

    @app.middleware("http")
    async def retry_safe(request, call_next):
        key = request.headers.get("Idempotency-Key")
        if (
            request.method != "POST"
            or not key
            or not re.fullmatch(
                r"/api/(jobs(?:/[a-f0-9-]+/(?:edit|retry|rebuild))?|projects/import)",
                request.url.path,
            )
        ):
            return await call_next(request)
        if not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", key):
            return JSONResponse({"detail": "请求标识无效"}, 422)
        route = request.url.path + "?" + request.url.query
        try:
            fingerprint = await fingerprint_request(request)
        except (ValueError, UnicodeError):
            return JSONResponse(
                {"detail": "请求内容无法读取，请重新选择文件后提交"}, 422
            )
        entry = locks.setdefault(key, {"lock": asyncio.Lock(), "users": 0})
        entry["users"] += 1
        try:
            async with entry["lock"]:
                db = await store.connect()
                try:
                    cursor = await db.execute(
                        "SELECT route,fingerprint,status,body FROM creation_requests WHERE key=?",
                        (key,),
                    )
                    existing = await cursor.fetchone()
                    if existing:
                        # 旧版 multipart 未记录内容摘要，按原 key 只返回已提交结果，绝不再次创建。
                        if existing[0] != route or existing[1] not in {
                            fingerprint,
                            "multipart",
                        }:
                            return JSONResponse(
                                {"detail": "请求标识已用于其他内容，请重新提交"}, 409
                            )
                        return Response(
                            existing[3],
                            status_code=existing[2],
                            media_type="application/json",
                        )
                    cursor = await db.execute(
                        "SELECT route,fingerprint,job_id FROM creation_jobs WHERE key=?",
                        (key,),
                    )
                    committed = await cursor.fetchone()
                    if committed:
                        if tuple(committed[:2]) != (route, fingerprint):
                            return JSONResponse(
                                {"detail": "请求标识已用于其他内容，请重新提交"}, 409
                            )
                        job = await store.get(committed[2])
                        if job["status"] == "queued" and hasattr(app.state, "runner"):
                            app.state.runner.schedule(job["id"], resume=True)
                        return JSONResponse(public(job) if public else job, 201)
                    token = creation_context.set(
                        {
                            "key": key,
                            "route": route,
                            "fingerprint": fingerprint,
                            "store": str(store.path),
                        }
                    )
                    try:
                        response = await call_next(request)
                    finally:
                        creation_context.reset(token)
                    if not 200 <= response.status_code < 300:
                        return response
                    body = b"".join([chunk async for chunk in response.body_iterator])
                    await db.execute(
                        "INSERT INTO creation_requests VALUES(?,?,?,?,?)",
                        (key, route, fingerprint, response.status_code, body),
                    )
                    await db.commit()
                    return Response(
                        body,
                        status_code=response.status_code,
                        headers=dict(response.headers),
                        background=response.background,
                    )
                finally:
                    await db.close()
        finally:
            entry["users"] -= 1
            if entry["users"] == 0:
                locks.pop(key, None)
