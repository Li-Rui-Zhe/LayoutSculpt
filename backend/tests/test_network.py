import pytest

from backend.app import network


@pytest.mark.parametrize("server,expected", [
    ("127.0.0.1:7897", {"HTTP_PROXY": "http://127.0.0.1:7897", "HTTPS_PROXY": "http://127.0.0.1:7897"}),
    ("http=localhost:80;https=socks5://localhost:81;socks=localhost:82", {"HTTP_PROXY": "http://localhost:80", "HTTPS_PROXY": "socks5://localhost:81"}),
    ("", {}),
    ("socks=localhost:82", {}),
])
def test_parse_windows_proxy(server, expected):
    assert network.parse_windows_proxy(server) == expected


def test_child_inherits_system_proxy_without_mutating_parent(monkeypatch):
    monkeypatch.setattr(network, "windows_system_proxies", lambda: {"HTTPS_PROXY": "http://localhost:7897"})
    parent = {"PATH": "original"}
    child = network.codex_environment(parent)
    assert child["HTTPS_PROXY"] == "http://localhost:7897"
    assert child["NO_PROXY"] == "127.0.0.1,localhost,::1"
    assert parent == {"PATH": "original"}
    assert network.codex_environment({"no_proxy": "example.test"})["no_proxy"] == "example.test"


@pytest.mark.parametrize("name", ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"])
def test_explicit_proxy_configuration_takes_precedence(monkeypatch, name):
    def unexpected_read():
        pytest.fail("Explicit proxy configuration must not read Windows settings")
    monkeypatch.setattr(network, "windows_system_proxies", unexpected_read)
    parent = {name: "http://custom:8080", "NO_PROXY": "private.test"}
    assert network.codex_environment(parent) == parent


def test_no_proxy_settings_leave_child_environment_unchanged(monkeypatch):
    monkeypatch.setattr(network, "windows_system_proxies", lambda: {})
    assert network.codex_environment({"PATH": "original"}) == {"PATH": "original"}
