"""Local credentials: DPAPI on Windows, a private Fernet vault on other systems."""

import base64
import ctypes
import json
import os
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import InvalidToken


def atomic_private_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _dpapi(data: bytes, *, decrypt=False):
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    source = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    function.restype = wintypes.BOOL
    # CRYPTPROTECT_UI_FORBIDDEN; bound to the current OS account, with no dialogs.
    if not function(
        ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)
    ):
        raise ValueError("本机密钥无法读取或保存，请重新填写连接密钥。")
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        kernel.LocalFree(outgoing.data)


class ConnectionStore:
    def __init__(self, data_dir):
        self.path = Path(data_dir) / "ai" / "connections.json"
        self.key_path = self.path.with_name(".credential.key")
        self.data = {
            "revision": 0,
            "default_provider": "codex",
            "codex_model": None,
            "deepseek_model": None,
            "secret": None,
        }
        self.error = None
        if self.path.exists():
            try:
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                if not isinstance(saved, dict) or saved.get("default_provider") not in {
                    "codex",
                    "deepseek",
                }:
                    raise ValueError()
                if not isinstance(saved.get("revision"), int) or saved["revision"] < 0:
                    raise ValueError()
                if any(
                    saved.get(key) is not None and not isinstance(saved[key], str)
                    for key in ("secret", "codex_model", "deepseek_model")
                ):
                    raise ValueError()
                self.data.update({key: saved[key] for key in self.data if key in saved})
                self.secret()
            except (ValueError, OSError, KeyError, TypeError):
                self.error = (
                    "本机 AI 连接记录无法读取，请重新填写密钥并保存；Codex 仍可使用。"
                )
                self.data["default_provider"] = "codex"

    def _fernet(self):
        from cryptography.fernet import Fernet

        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.key_path.exists():
            try:
                fd = os.open(self.key_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(Fernet.generate_key())
            except FileExistsError:
                pass
        return Fernet(self.key_path.read_bytes())

    def seal(self, secret):
        data = secret.encode("utf-8")
        if os.name == "nt":
            return "dpapi:" + base64.b64encode(_dpapi(data)).decode("ascii")
        return "fernet:" + self._fernet().encrypt(data).decode("ascii")

    def secret(self):
        value = self.data.get("secret")
        if not value:
            return None
        try:
            if value.startswith("dpapi:") and os.name == "nt":
                return _dpapi(
                    base64.b64decode(value[6:], validate=True), decrypt=True
                ).decode("utf-8")
            if value.startswith("fernet:"):
                return self._fernet().decrypt(value[7:].encode("ascii")).decode("utf-8")
        except (ValueError, OSError, UnicodeError, InvalidToken):
            raise ValueError("本机密钥无法读取，请重新填写 DeepSeek 密钥。") from None
        raise ValueError("本机密钥不可用于当前系统，请重新填写 DeepSeek 密钥。")

    def save(self, *, provider, model=None, secret=None, remove=False):
        updated = {
            **self.data,
            "revision": self.data["revision"] + 1,
            "default_provider": provider,
        }
        if model:
            updated[f"{provider}_model"] = model
        if remove:
            updated.update(secret=None, deepseek_model=None, default_provider="codex")
        elif secret is not None:
            updated["secret"] = self.seal(secret)
        atomic_private_write(
            self.path, json.dumps(updated, ensure_ascii=False).encode("utf-8")
        )
        self.data = updated
        self.error = None
