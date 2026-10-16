"""请求断开时取消长任务，并等待其清理子进程/AI turn。"""

import asyncio

from fastapi import HTTPException


async def while_connected(request, operation):
    task = asyncio.create_task(operation)
    try:
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=0.25)
            if done:
                break
            if await request.is_disconnected():
                raise HTTPException(499, "操作已取消，现有设计已保留")
        return await task
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
