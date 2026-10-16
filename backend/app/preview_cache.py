"""短期、有容量上限的交互预览缓存，不替代正式任务产物。"""

from collections import OrderedDict
from time import monotonic


class PreviewCache:
    def __init__(self, max_bytes=64 * 1024 * 1024, ttl=120, clock=monotonic):
        self.max_bytes, self.ttl, self.clock = max_bytes, ttl, clock
        self.entries = OrderedDict()
        self.size = 0

    def get(self, key):
        entry = self.entries.get(key)
        if entry is None:
            return None
        deadline, value = entry
        if self.clock() >= deadline:
            self.size -= len(self.entries.pop(key)[1])
            return None
        self.entries.move_to_end(key)
        return value

    def put(self, key, value):
        if len(value) > self.max_bytes:
            return
        if key in self.entries:
            self.size -= len(self.entries.pop(key)[1])
        self.entries[key] = (self.clock() + self.ttl, value)
        self.size += len(value)
        while self.size > self.max_bytes:
            self.size -= len(self.entries.popitem(last=False)[1][1])
