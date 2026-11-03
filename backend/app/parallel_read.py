"""Bounded independent reads with cancellation propagation and no leaked tasks."""
import asyncio


async def independent_reads(primary, audit):
    tasks = [asyncio.create_task(primary), asyncio.create_task(audit)]
    try:
        # A failed audit must not discard a usable primary candidate.
        return await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
