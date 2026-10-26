"""Offline, verified project snapshots. Call prepare_data under instance_lock."""

import hashlib
import json
import os
import shutil
import sqlite3
import re
import zipfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

DATA_VERSION = "2026.10.26.1"
DATA_NAMES = (
    "studio.sqlite3", "graph.sqlite3", "jobs", "diy", "diy_references",
    "library", "imports", "materials", "material_sources", "material_jobs",
)
LIVE_NAMES = DATA_NAMES + tuple(name + suffix for name in ("studio.sqlite3", "graph.sqlite3") for suffix in ("-wal", "-shm"))


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def checked(root, path):
    root = root.resolve()
    if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()) or not path.resolve().is_relative_to(root) or path.resolve() == root:
        raise ValueError("数据目录包含外部链接，已停止操作，请检查数据位置。")
    return path


def remove(root, path):
    checked(root, path)
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def files(root):
    if not root.exists():
        return []
    entries = list(root.rglob("*")) if root.is_dir() else [root]
    for path in entries:
        if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
            raise ValueError("数据目录包含链接，不能安全备份。")
    return [p for p in entries if p.is_file()]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshots(root):
    result = []
    for path in (root / "backups").glob("*/manifest.json"):
        if not re.fullmatch(r"[0-9]{8}T[0-9]{6}-[0-9a-f]{8}", path.parent.name):
            continue
        try:
            checked(root, path)
            value = read_json(path)
            result.append({"id": path.parent.name, "created_at": value["created_at"],
                           "bytes": sum(v["bytes"] for v in value["files"].values()),
                           "reason": value.get("reason", "manual")})
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(result, key=lambda value: value["created_at"], reverse=True)


def create_snapshot(root, reason="manual", keep_id=None):
    root = root.resolve()
    source_files = [p for name in DATA_NAMES for p in files(checked(root, root / name))]
    size = sum(p.stat().st_size for p in source_files)
    if shutil.disk_usage(root).free < size + 128 * 1024 * 1024:
        raise ValueError("磁盘空间不足以备份，原数据未改动；请释放空间后重试。")
    identifier = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex[:8]
    target = checked(root, root / "backups" / identifier)
    staging = checked(root, root / "backups" / ("pending-" + identifier))
    staging.mkdir(parents=True)
    payload = staging / "data"
    payload.mkdir()
    try:
        for name in DATA_NAMES:
            source, dest = root / name, payload / name
            if not source.exists():
                continue
            if name.endswith(".sqlite3"):
                with closing(sqlite3.connect(source)) as original, closing(sqlite3.connect(dest)) as copy:
                    original.backup(copy)
                    if copy.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                        raise ValueError("数据库检查未通过，已保留原数据。")
            elif source.is_dir():
                shutil.copytree(source, dest)
        manifest = {"format": 1, "version": DATA_VERSION, "reason": reason,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "files": {p.relative_to(payload).as_posix(): {"bytes": p.stat().st_size, "sha256": digest(p)} for p in files(payload)}}
        atomic_json(staging / "manifest.json", manifest)
        os.replace(staging, target)
    except BaseException:
        remove(root, staging)
        raise
    # Only completed backups are eligible; keep the selected restore source.
    for old in snapshots(root)[3:]:
        if old["id"] != keep_id:
            remove(root, root / "backups" / old["id"])
    return identifier


def verified_snapshot(root, identifier):
    if not identifier or any(c not in "0123456789Tabcdef-" for c in identifier):
        raise ValueError("备份标识无效。")
    source = checked(root, root / "backups" / identifier)
    manifest = read_json(source / "manifest.json")
    if not isinstance(manifest, dict) or manifest.get("format") != 1 or not isinstance(manifest.get("files"), dict):
        raise ValueError("备份记录缺失。")
    payload = source / "data"
    actual = {p.relative_to(payload).as_posix(): p for p in files(payload)}
    if "studio.sqlite3" not in actual:
        raise ValueError("备份缺少项目数据库，已停止恢复。")
    if set(actual) != set(manifest["files"]):
        raise ValueError("备份文件不完整，已停止恢复。")
    for name, path in actual.items():
        if Path(name).parts[0] not in DATA_NAMES:
            raise ValueError("备份包含不支持的数据。")
        record = manifest["files"][name]
        if path.stat().st_size != record["bytes"] or digest(path) != record["sha256"]:
            raise ValueError("备份校验失败，原数据未改动。")
    return payload


def export_snapshot(root, identifier, target):
    """Export only the verified snapshot allowlist; never include live credentials."""
    payload = verified_snapshot(root, identifier)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        archive.write(payload.parent / "manifest.json", f"{identifier}/manifest.json")
        for path in files(payload):
            archive.write(path, f"{identifier}/data/{path.relative_to(payload).as_posix()}")
        archive.writestr("恢复说明.txt", "将备份中的时间戳文件夹解压到项目 data/backups 下，在工作台的使用帮助→本机数据与备份中选择恢复，重启后执行。\n本备份不包含 AI 密钥、Codex 登录和未同步的浏览器草稿。换电脑建议优先使用项目成果包导入。\n")


def recover_restore(root):
    journal = root / "restore-journal.json"
    state = read_json(journal)
    if not state:
        return
    rollback = checked(root, root / "restore-rollback")
    if not isinstance(state, dict) or not isinstance(state.get("present"), list) or "studio.sqlite3" not in state["present"] or any(name not in LIVE_NAMES for name in state["present"]) or not rollback.is_dir():
        raise ValueError("恢复中断记录不完整，已停止操作，请保留数据目录并检查备份。")
    for name in LIVE_NAMES:
        old, live = rollback / name, checked(root, root / name)
        if old.exists():
            remove(root, live)
            os.replace(old, live)
        elif name not in state["present"]:
            remove(root, live)
    journal.unlink()
    remove(root, rollback)


def restore_snapshot(root, identifier):
    payload = verified_snapshot(root, identifier)
    create_snapshot(root, "before_restore", keep_id=identifier)
    staging = checked(root, root / "restore-staging")
    rollback = checked(root, root / "restore-rollback")
    remove(root, staging)
    remove(root, rollback)
    shutil.copytree(payload, staging)
    rollback.mkdir()
    atomic_json(root / "restore-journal.json", {"present": [n for n in LIVE_NAMES if (root / n).exists()]})
    try:
        for name in LIVE_NAMES:
            live = checked(root, root / name)
            if live.exists():
                os.replace(live, rollback / name)
            if (staging / name).exists():
                os.replace(staging / name, live)
        (root / "restore-journal.json").unlink()
    except BaseException:
        recover_restore(root)
        raise
    finally:
        remove(root, staging)
    remove(root, rollback)


def prepare_data(root):
    """No active server or writer may hold this data directory."""
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    recover_restore(root)
    for name in ("restore-staging", "restore-rollback"):
        remove(root, root / name)
    for incomplete in (root / "backups").glob("pending-*"):
        if re.fullmatch(r"pending-[0-9]{8}T[0-9]{6}-[0-9a-f]{8}", incomplete.name):
            remove(root, incomplete)
    pending_path = root / "maintenance-request.json"
    pending = read_json(pending_path, {})
    marker = root / "data-version.json"
    previous = read_json(marker, {})
    if pending.get("action") == "restore":
        restore_snapshot(root, pending["id"])
    elif pending.get("action") == "backup" or ((root / "studio.sqlite3").exists() and previous.get("version") != DATA_VERSION):
        create_snapshot(root, "manual" if pending else "before_upgrade")
    atomic_json(marker, {"version": DATA_VERSION})
    pending_path.unlink(missing_ok=True)
