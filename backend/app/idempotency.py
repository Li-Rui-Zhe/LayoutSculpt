"""Retry-safe creation endpoints for one local backend process."""

import asyncio
import hashlib
import re

from fastapi.responses import JSONResponse, Response


def install_idempotency(app, store):
    lock = asyncio.Lock()

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
        route = str(request.url.path) + "?" + str(request.url.query)
        # The upload form's multipart boundary changes between retries. The
        # unique key belongs to that upload attempt; JSON additionally verifies content.
        fingerprint = "multipart"
        if "application/json" in request.headers.get("content-type", ""):
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 2 * 1024 * 1024:
                    return JSONResponse({"detail": "设计请求超过 2 MB"}, 413)
            # Starlette's middleware replays a cached body to the downstream request.
            request._body = bytes(raw)
            fingerprint = hashlib.sha256(raw).hexdigest()
        async with lock:
            db = await store.connect()
            try:
                await db.execute(
                    "CREATE TABLE IF NOT EXISTS creation_requests (key TEXT PRIMARY KEY,route TEXT NOT NULL,fingerprint TEXT NOT NULL,status INTEGER NOT NULL,body BLOB NOT NULL)"
                )
                async with db.execute(
                    "SELECT route,fingerprint,status,body FROM creation_requests WHERE key=?",
                    (key,),
                ) as cursor:
                    existing = await cursor.fetchone()
                if existing:
                    if existing[0] != route or existing[1] != fingerprint:
                        return JSONResponse({"detail": "请求标识已用于其他操作"}, 409)
                    return Response(
                        existing[3],
                        status_code=existing[2],
                        media_type="application/json",
                    )
                response = await call_next(request)
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
