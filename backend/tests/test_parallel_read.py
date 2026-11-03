import asyncio
from backend.app.parallel_read import independent_reads


def test_reads_overlap_without_sharing_results_and_retain_primary_on_audit_failure():
    async def run():
        started = asyncio.Event()
        async def primary():
            await asyncio.wait_for(started.wait(), 1)
            return "有效结构"
        async def audit():
            started.set()
            raise ValueError("复核失败")
        first, second = await independent_reads(primary(), audit())
        assert first == "有效结构"
        assert isinstance(second, ValueError)
    asyncio.run(run())


def test_cancelling_job_waits_for_both_reads_to_close():
    async def run():
        starts, closed = [], []
        async def read(i):
            starts.append(i)
            try:
                await asyncio.sleep(60)
            finally:
                closed.append(i)
        task = asyncio.create_task(independent_reads(read(1), read(2)))
        while len(starts) < 2:
            await asyncio.sleep(0)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert sorted(closed) == [1, 2]
    asyncio.run(run())
