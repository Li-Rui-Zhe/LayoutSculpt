"""在 multipart/JSON 解析前限制请求体；大请求暂存磁盘，不无限占用内存。"""

import asyncio
from tempfile import SpooledTemporaryFile

from starlette.responses import JSONResponse

MiB = 1024 * 1024


class RequestLimits:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        route = scope["path"]
        limit = {
            "/api/jobs": 21 * MiB,
            "/api/projects/import": 201 * MiB,
            "/api/library/import": 101 * MiB,
            "/api/materials/custom": 11 * MiB,
            "/api/materials/source": 11 * MiB,
            "/api/diy/references": 11 * MiB,
        }.get(route, 3 * MiB)
        headers = dict(scope["headers"])
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"detail": "请求长度无效"}, 400)(
                scope, receive, send
            )
        if declared > limit:
            return await JSONResponse(
                {"detail": "上传内容过大，请缩小文件或减少设计对象"}, 413
            )(scope, receive, send)
        with SpooledTemporaryFile(max_size=MiB) as body:
            total = 0
            try:
                async with asyncio.timeout(120):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        total += len(chunk)
                        if total > limit:
                            return await JSONResponse(
                                {"detail": "上传内容过大，请缩小文件或减少设计对象"},
                                413,
                            )(scope, receive, send)
                        await asyncio.to_thread(body.write, chunk)
                        if not message.get("more_body", False):
                            break
            except TimeoutError:
                return await JSONResponse({"detail": "上传超时，请重试"}, 408)(
                    scope, receive, send
                )
            body.seek(0)
            remaining = total
            sent = False

            async def replay():
                nonlocal remaining, sent
                if sent:
                    return await receive()
                chunk = await asyncio.to_thread(body.read, min(MiB, remaining))
                remaining -= len(chunk)
                sent = remaining == 0
                return {"type": "http.request", "body": chunk, "more_body": not sent}

            await self.app(scope, replay, send)
