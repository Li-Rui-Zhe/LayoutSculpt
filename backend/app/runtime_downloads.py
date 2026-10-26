"""Verified downloads and bounded extraction; no remote scripts or shell strings."""

import asyncio
import base64
import hashlib
import json
import os
import shutil
import stat
import tarfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

import httpx

from .network import windows_system_proxies

HOSTS = {"registry.npmjs.org"}


class InstallError(RuntimeError):
    """An already-curated message safe for the local UI."""


def trusted_url(url):
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in HOSTS
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
    ):
        raise InstallError("下载地址不在受信任的软件源中，已停止安装。")
    return url


class Downloads:
    def __init__(self, root):
        self.root = Path(root)
        self.transport = None

    def client(self):
        proxy = None
        if self.transport is None and not any(
            os.getenv(k)
            for k in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")
        ):
            proxy = windows_system_proxies().get("HTTPS_PROXY")
        return httpx.AsyncClient(
            transport=self.transport,
            proxy=proxy,
            trust_env=self.transport is None,
            timeout=httpx.Timeout(45, connect=15),
            follow_redirects=False,
            headers={
                "User-Agent": "LayoutSculpt-runtime",
                "Accept": "application/json",
            },
        )

    async def _response(self, client, url):
        for _ in range(6):
            trusted_url(url)
            response = await client.send(client.build_request("GET", url), stream=True)
            if response.status_code in (301, 302, 303, 307, 308):
                target = response.headers.get("location", "")
                await response.aclose()
                # Only fully qualified HTTPS redirects to allowlisted hosts.
                url = trusted_url(target)
                continue
            if response.status_code != 200:
                await response.aclose()
                raise InstallError("软件源暂时不可用，请检查网络与代理后重试。")
            return response
        raise InstallError("软件下载发生过多重定向，请稍后重试。")

    async def metadata(self, url, *, limit=2 * 1024 * 1024, raw=False):
        async with asyncio.timeout(30), self.client() as client:
            response = await self._response(client, url)
            try:
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > limit:
                        raise InstallError("软件版本信息超过预期大小，已停止操作。")
                return bytes(content).decode("utf-8") if raw else json.loads(content)
            finally:
                await response.aclose()

    async def archive(self, url, integrity, progress, *, limit=300 * 1024 * 1024):
        algorithm, _, encoded = integrity.partition("-")
        if algorithm not in {"sha256", "sha512"}:
            raise InstallError("软件包缺少可靠的完整性校验信息，已停止下载。")
        try:
            expected = base64.b64decode(encoded, validate=True)
        except ValueError:
            raise InstallError("软件包校验信息无效。") from None
        if len(expected) != hashlib.new(algorithm).digest_size:
            raise InstallError("软件包校验信息无效。")
        identity = hashlib.sha256((url + integrity).encode()).hexdigest()
        folder = self.root / "downloads"
        folder.mkdir(parents=True, exist_ok=True)
        final, partial = folder / identity, folder / (identity + ".partial")

        def valid(path):
            if not path.is_file() or path.stat().st_size > limit:
                return False
            digest = hashlib.new(algorithm)
            with path.open("rb") as stream:
                while data := stream.read(1024 * 1024):
                    digest.update(data)
            return digest.digest() == expected

        if await asyncio.to_thread(valid, final):
            await progress(final.stat().st_size, final.stat().st_size)
            return final
        try:
            digest = hashlib.new(algorithm)
            async with asyncio.timeout(600), self.client() as client:
                response = await self._response(client, url)
                try:
                    total = int(response.headers.get("content-length", "0")) or None
                    if total and total > limit:
                        raise InstallError("软件包超过下载大小限制。")
                    count = 0
                    with partial.open("wb") as stream:
                        async for chunk in response.aiter_bytes(256 * 1024):
                            count += len(chunk)
                            if count > limit:
                                raise InstallError("软件包超过下载大小限制。")
                            stream.write(chunk)
                            digest.update(chunk)
                            await progress(count, total)
                    if digest.digest() != expected:
                        raise InstallError(
                            "软件包完整性校验失败，已保留原环境，请重试。"
                        )
                    os.replace(partial, final)
                    return final
                finally:
                    await response.aclose()
        finally:
            partial.unlink(missing_ok=True)


def sha256_integrity(hex_digest):
    if len(hex_digest) != 64:
        raise InstallError("软件包 SHA-256 信息无效。")
    return "sha256-" + base64.b64encode(bytes.fromhex(hex_digest)).decode()


def extract_archive(archive, target, *, archive_type="tar", limit=1024 * 1024 * 1024):
    """Only regular files/dirs; never follow archive links or extract special files."""
    target = Path(target).resolve()
    target.mkdir(parents=True, exist_ok=True)
    size, count = 0, 0

    def destination(name, length):
        nonlocal size, count
        path = PurePosixPath(name.replace("\\", "/"))
        if (
            path.is_absolute()
            or ".." in path.parts
            or any(":" in p for p in path.parts)
        ):
            raise InstallError("软件包包含不安全的路径，已停止解压。")
        result = (target / Path(*path.parts)).resolve()
        if not result.is_relative_to(target):
            raise InstallError("软件包路径超出安装目录。")
        size += length
        count += 1
        if size > limit or count > 20000:
            raise InstallError("软件包解压大小超过限制。")
        result.parent.mkdir(parents=True, exist_ok=True)
        return result

    if archive_type == "zip":
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                if member.is_dir():
                    continue
                if stat.S_ISLNK(member.external_attr >> 16):
                    raise InstallError("软件包包含不安全的文件链接。")
                output = destination(member.filename, member.file_size)
                with source.open(member) as incoming, output.open("wb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
    else:
        with tarfile.open(archive, "r:gz") as source:
            for member in source:
                if member.isdir() or member.issym() or member.islnk():
                    continue
                if not member.isfile():
                    raise InstallError("软件包包含不支持的特殊文件。")
                output = destination(member.name, member.size)
                with (
                    source.extractfile(member) as incoming,
                    output.open("wb") as outgoing,
                ):
                    shutil.copyfileobj(incoming, outgoing)
                output.chmod(0o755 if member.mode & 0o111 else 0o644)
