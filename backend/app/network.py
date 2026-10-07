"""Use the existing Windows proxy for the CLI child without changing global settings."""

import os


def parse_windows_proxy(server):
    entries = {}
    for entry in server.split(";"):
        protocol, separator, address = entry.strip().partition("=")
        if separator:
            entries[protocol.lower()] = address.strip()
        elif protocol:
            entries["all"] = protocol
    proxies = {}
    for protocol in ("http", "https"):
        address = entries.get(protocol) or entries.get("all")
        if address:
            proxies[f"{protocol.upper()}_PROXY"] = (
                address if "://" in address else f"http://{address}"
            )
    return proxies


def windows_system_proxies():
    if os.name != "nt":
        return {}
    import winreg

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        ) as key:
            if not winreg.QueryValueEx(key, "ProxyEnable")[0]:
                return {}
            server = winreg.QueryValueEx(key, "ProxyServer")[0]
    except OSError:
        return {}
    return parse_windows_proxy(server) if isinstance(server, str) else {}


def codex_environment(environment=None):
    env = dict(os.environ if environment is None else environment)
    # Explicit CLI/service configuration takes precedence over the Windows GUI.
    if any(env.get(name) for name in (
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
        "http_proxy", "https_proxy", "all_proxy",
    )):
        return env
    proxies = windows_system_proxies()
    if proxies:
        env.update(proxies)
        if not env.get("NO_PROXY") and not env.get("no_proxy"):
            env["NO_PROXY"] = "127.0.0.1,localhost,::1"
    return env
