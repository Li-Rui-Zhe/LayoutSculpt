from backend.app.preview_cache import PreviewCache


def test_cache_expiry_replacement_and_byte_eviction():
    time = [0]
    cache = PreviewCache(max_bytes=10, ttl=2, clock=lambda: time[0])
    cache.put("a", b"123456")
    cache.put("b", b"1234")
    assert cache.get("a") == b"123456"
    cache.put("c", b"12")
    assert cache.get("b") is None
    assert cache.size == 8
    cache.put("a", b"123456789")
    assert cache.get("c") is None
    assert cache.size == 9
    cache.put("large", b"x" * 11)
    assert cache.get("large") is None
    assert cache.size == 9
    time[0] = 3
    assert cache.get("a") is None
    assert cache.size == 0
