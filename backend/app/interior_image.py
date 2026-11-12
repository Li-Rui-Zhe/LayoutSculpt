"""ImageGen from an explicitly submitted viewport still and description."""

import asyncio
import io
import json
import logging
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import UploadFile

from .codex import CodexError, codex_command_args
from .interior_image_gallery import MEDIA_TYPES, InteriorImageGallery
from .request_limits import INTERIOR_VIEW_LIMIT

TIMEOUT = 350
MAX_IMAGE_BYTES = 24 * 1024 * 1024
NO_STORE = {"Cache-Control": "no-store"}
logger = logging.getLogger(__name__)


class ImageContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    projectId: str = Field(default="", pattern=r"^(sample|[a-f0-9]{32})?$")
    title: str = Field(default="", max_length=120)
    roomName: str = Field(default="", max_length=80)


class ImageArchive(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    archived: bool


DISABLED_TOOLS = (
    "shell_tool",
    "unified_exec",
    "apps",
    "plugins",
    "remote_plugin",
    "view_image",
    "skill_search",
    "multi_agent",
    "multi_agent_v2",
    "browser_use",
    "browser_use_external",
    "memories",
)
INSTRUCTIONS = (
    "Use the built-in image generation tool exactly once to edit the attached 3D viewport image. "
    "Pass num_last_images_to_include=1 to the tool so it uses the image already attached "
    "to this turn. Omit referenced_image_paths and do not attempt any file reads. "
    "Use that image as the visual reference, preserving its camera direction, "
    "framing, wall and opening geometry, and furniture positions. Follow the user's description "
    "for the requested lighting, finishes, and atmosphere. Do not open other files, "
    "use external data, or use tools other than image generation. Reply briefly when finished."
)


def normalize_view(data: bytes) -> bytes:
    if not data or len(data) > INTERIOR_VIEW_LIMIT:
        raise ValueError("截图为空或超过 4 MB")
    with Image.open(io.BytesIO(data), formats=["JPEG"]) as image:
        if max(image.size) > 2048:
            raise ValueError("截图尺寸过大")
        pixels = image.convert("RGB")
        pixels.info.clear()
        output = io.BytesIO()
        pixels.save(output, format="JPEG", quality=95)
        return output.getvalue()


def generated_png(stdout: bytes, output_root: Path) -> bytes:
    thread = None
    for line in stdout.splitlines():
        event = json.loads(line)
        if event.get("type") == "thread.started":
            thread = str(UUID(event["thread_id"]))
            break
    if thread is None:
        raise ValueError("missing generation thread")
    directory = output_root / thread
    if directory.resolve() != directory or not directory.is_dir():
        raise ValueError("missing generation directory")
    # The CLI saves ImageGen output under its own thread ID. Ignore agent text and paths.
    images = [
        file
        for file in directory.glob("*.png")
        if file.is_file() and file.resolve() == file
    ]
    if len(images) != 1:
        raise ValueError("expected a single generated PNG")
    with images[0].open("rb") as stream:
        data = stream.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("generated image too large")
    with Image.open(io.BytesIO(data), formats=["PNG"]) as image:
        if max(image.size) > 4096:
            raise ValueError("generated image dimensions too large")
        # Re-encode pixels only. Metadata, including local paths, never reaches the browser.
        pixels = image.convert("RGB")
        pixels.info.clear()
        output = io.BytesIO()
        pixels.save(output, format="PNG")
        return output.getvalue()


async def generate_interior_png(client, prompt: str, view: bytes) -> bytes:
    env = {
        key: value
        for key, value in client.environment().items()
        if key.upper() == "CODEX_HOME"
        or not key.upper().startswith(("CODEX_", "OPENAI_", "CHATGPT_", "OTEL_"))
    }
    codex_home = Path(env.get("CODEX_HOME") or Path.home() / ".codex").resolve()
    env["CODEX_HOME"] = str(codex_home)
    command = [
        *codex_command_args(client.command),
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--json",
        "--skip-git-repo-check",
        "--enable",
        "image_generation",
        "-c",
        'model_provider="openai"',
        "-c",
        'approval_policy="never"',
        "-c",
        'default_permissions="image_only"',
        "-c",
        'permissions.image_only.filesystem={":workspace_roots" = "read"}',
        "-c",
        'web_search="disabled"',
        "-c",
        "project_doc_max_bytes=0",
        "-c",
        "skills.include_instructions=false",
        "-c",
        "include_permissions_instructions=false",
        "-c",
        "analytics.enabled=false",
        "-c",
        f"developer_instructions={json.dumps(INSTRUCTIONS)}",
    ]
    for tool in DISABLED_TOOLS:
        command.extend(("--disable", tool))
    with TemporaryDirectory(prefix="layoutsculpt-image-") as workspace:
        reference = Path(workspace) / "view.jpg"
        reference.write_bytes(view)
        process = await asyncio.create_subprocess_exec(
            *command,
            "--cd",
            workspace,
            "--image",
            str(reference),
            "-",
            cwd=workspace,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(
                process.communicate(prompt.encode("utf-8")), TIMEOUT
            )
        finally:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()
        if process.returncode:
            raise CodexError("ImageGen CLI failed")
    return await asyncio.to_thread(
        generated_png, stdout, (codex_home / "generated_images").resolve()
    )


def install_interior_image_route(app, ai, data_dir):
    gallery = InteriorImageGallery(data_dir)
    lock = asyncio.Lock()
    worker = None
    active_id = None

    def require_local(request):
        if request.client is None or request.client.host not in {"127.0.0.1", "::1"}:
            raise HTTPException(403, "AI 效果图只接受本机请求。")

    @app.get("/api/interior-images/capability")
    async def image_capability(request: Request):
        require_local(request)
        command = getattr(ai.local, "command", "codex")
        available = bool(shutil.which(command) or Path(command).is_file())
        return JSONResponse({
            "available": available,
            "verified": False,
            "provider": "codex",
            "message": "已发现本机 Codex；生成时需要有效登录与 ImageGen 权限。" if available
            else "未找到本机 Codex，请在 AI 接入中准备运行环境。",
        }, headers=NO_STORE)

    async def run_generation(record, view):
        try:
            png = await generate_interior_png(ai.local, record["prompt"], view)
        except asyncio.CancelledError:
            await asyncio.to_thread(gallery.fail, record, "生成已取消，底图和描述已保留，可再次生成。")
            raise
        except HTTPException as exc:
            error = exc.detail
        except TimeoutError:
            error = "生成效果图超时，请稍后重试。"
        except (
            CodexError,
            OSError,
            ValueError,
            KeyError,
            TypeError,
            Image.DecompressionBombError,
        ):
            error = (
                "Codex 未返回效果图。请确认本机 Codex 已登录并可使用 ImageGen，再重试。"
            )
        else:
            try:
                await asyncio.to_thread(gallery.complete, record["id"], png)
                return
            except (OSError, ValueError):
                error = "效果图保存失败，请检查本机磁盘和文件权限。"
        try:
            await asyncio.to_thread(gallery.fail, record, error)
        except OSError:
            logger.warning("无法写入效果图失败状态。")

    @app.get("/api/interior-images")
    async def list_interior_images(request: Request):
        require_local(request)
        async with lock:
            running = active_id if worker is not None and not worker.done() else None
            items = await asyncio.to_thread(gallery.list, running)
        return JSONResponse(
            {"items": items, "folder": str(gallery.root)}, headers=NO_STORE
        )

    @app.get("/api/interior-images/{identifier}/{filename}")
    async def interior_image_file(identifier: str, filename: str, request: Request):
        require_local(request)
        try:
            path = gallery.media_file(identifier, filename)
        except ValueError:
            path = None
        if path is None:
            raise HTTPException(404, "效果图文件不存在。")
        return FileResponse(path, media_type=MEDIA_TYPES[filename], headers=NO_STORE)

    @app.post("/api/interior-image", status_code=202)
    async def create_interior_image(request: Request):
        nonlocal worker, active_id
        require_local(request)
        async with request.form(max_files=1, max_fields=2, max_part_size=8192) as form:
            prompt, view = form.get("prompt"), form.get("view")
            if (
                not {"prompt", "view"}.issubset(form)
                or set(form) - {"prompt", "view", "context"}
                or not isinstance(prompt, str)
                or not 1 <= len(prompt.strip()) <= 1200
                or not isinstance(view, UploadFile)
            ):
                raise HTTPException(
                    422, "请提交一张当前视角截图和 1 至 1200 字的描述。"
                )
            data = await view.read(INTERIOR_VIEW_LIMIT + 1)
            try:
                context = ImageContext.model_validate_json(form.get("context") or "{}").model_dump()
            except (ValidationError, TypeError):
                raise HTTPException(422, "取景信息无效，请重新取景。") from None
        async with lock:
            if worker is not None and not worker.done():
                raise HTTPException(
                    409, "已有一张效果图正在生成，请在「我的效果图」中查看进度。"
                )
            try:
                image = await asyncio.to_thread(normalize_view, data)
            except (OSError, ValueError, Image.DecompressionBombError):
                raise HTTPException(
                    422, "当前视角截图无效，请重新取景后再试。"
                ) from None
            try:
                record = await asyncio.to_thread(gallery.create, prompt.strip(), image, context)
            except (OSError, ValueError):
                raise HTTPException(
                    503, "无法保存生图记录，请检查本机磁盘和文件权限。"
                ) from None
            active_id = record["id"]
            worker = asyncio.create_task(run_generation(record, image))
        return JSONResponse(record, status_code=202, headers=NO_STORE)

    @app.post("/api/interior-images/{identifier}/cancel")
    async def cancel_image(identifier: str, request: Request):
        require_local(request)
        async with lock:
            try:
                record = await asyncio.to_thread(gallery.read, identifier)
            except (OSError, ValueError):
                raise HTTPException(404, "生成记录不存在。") from None
            if identifier == active_id and worker is not None and not worker.done():
                worker.cancel()
                await asyncio.gather(worker, return_exceptions=True)
                record = await asyncio.to_thread(gallery.read, identifier)
            return JSONResponse(gallery.public_record(record, None), headers=NO_STORE)

    @app.post("/api/interior-images/{identifier}/archive")
    async def archive_image(identifier: str, body: ImageArchive, request: Request):
        require_local(request)
        async with lock:
            if identifier == active_id and worker is not None and not worker.done():
                raise HTTPException(409, "请先取消生成，再移入归档。")
            try:
                await asyncio.to_thread(gallery.archive, identifier, body.archived)
            except (FileNotFoundError, ValueError):
                raise HTTPException(404, "生成记录不存在。") from None
            except OSError:
                raise HTTPException(503, "归档状态未能保存，请检查本机磁盘和文件权限后重试。") from None
        return {"ok": True}

    async def close():
        if worker is not None and not worker.done():
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)

    return close
