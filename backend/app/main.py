import asyncio
import json
import shutil
import warnings
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from .codex import CodexClient
from .config import ROOT, Settings
from .schemas import (
    Furnishing,
    JobOptions,
    Layout,
    ManualEditRequest,
    validate_furnishing,
)
from .skills import SkillRegistry
from .store import TERMINAL, Store
from .workflow import JobRunner, create_graph

ALLOWED_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
}
ARTIFACTS = {
    "source.png",
    "model.glb",
    "model.blend",
    "layout.json",
    "manifest.json",
    "blender.log",
    "furniture-report.json",
}


def normalize_image(content: bytes) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError("仅支持 PNG、JPG 和 WebP 户型图")
                if image.width * image.height > 40_000_000:
                    raise ValueError("图片像素过大，请缩小至 4000 万像素以内")
                image.load()
                image = ImageOps.exif_transpose(image).convert("RGB")
                image.thumbnail((4096, 4096))
                out = BytesIO()
                image.save(out, format="PNG")
                return out.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise ValueError("图片损坏或尺寸过大，请上传有效的户型图片") from exc


def create_app(settings=None, *, client=None, model_builder=None):
    settings = settings or Settings()
    store = Store(settings.db_path)
    codex = client or CodexClient(settings)
    registry = SkillRegistry(settings.skills_dir)

    @asynccontextmanager
    async def lifespan(app):
        await store.initialize()
        await store.recover()
        async with AsyncSqliteSaver.from_conn_string(
            str(settings.data_dir / "graph.sqlite3")
        ) as checkpoints:
            await checkpoints.setup()
            kwargs = {"model_builder": model_builder} if model_builder else {}
            graph = create_graph(
                settings, store, codex, registry, checkpoints, **kwargs
            )
            app.state.runner = JobRunner(graph, store, settings.concurrency, settings)
            try:
                yield
            finally:
                await app.state.runner.close()
                await codex.stop()

    app = FastAPI(title="栖境户型工作台", version="2.0.0", lifespan=lifespan)
    app.state.store = store
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(ALLOWED_ORIGINS),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Last-Event-ID"],
    )

    @app.middleware("http")
    async def restrict_local_writes(request, call_next):
        if (
            request.method not in {"GET", "HEAD", "OPTIONS"}
            and request.headers.get("origin")
            and request.headers["origin"] not in ALLOWED_ORIGINS
        ):
            return JSONResponse(
                {"detail": "不允许来自其他站点的写入请求"}, status_code=403
            )
        return await call_next(request)

    async def require_job(job_id):
        job = await store.get(str(job_id))
        if job is None:
            raise HTTPException(404, "任务不存在")
        return job

    def public(job):
        seed = settings.workspace(job["id"]) / "rebuild-seed.json"
        origin = json.loads(seed.read_text(encoding="utf-8")) if seed.exists() else {}
        return {
            **job,
            "source_url": f"/api/jobs/{job['id']}/artifacts/source.png",
            "rebuild_of": origin.get("rebuild_of"),
            "edited_of": origin.get("edited_of"),
        }

    def read_furniture_catalog():
        try:
            data = json.loads(settings.furniture_catalog.read_text(encoding="utf-8"))
            root = settings.furniture_catalog.resolve().parent
            library = (root / data["library"]).resolve()
            if (
                not library.is_relative_to(root)
                or library.suffix != ".blend"
                or not library.is_file()
            ):
                raise ValueError("家具工程不存在")
            for key in ["version", "blender_version", "license", "items"]:
                if key not in data:
                    raise ValueError("资产索引不完整")
            return data
        except (OSError, ValueError, KeyError) as exc:
            raise HTTPException(
                503,
                "家具库不可用，请运行 .venv/Scripts/python.exe scripts/build_assets.py",
            ) from exc

    @app.get("/api/health")
    async def health():
        try:
            assets = read_furniture_catalog()
            asset_status = {
                "available": True,
                "version": assets["version"],
                "count": len(assets["items"]),
            }
        except HTTPException:
            asset_status = {"available": False}
        return {
            "status": "ok",
            "codex": {
                "available": bool(
                    shutil.which(settings.codex_command)
                    or Path(settings.codex_command).is_file()
                ),
                "connected": codex.alive,
                "model": settings.codex_model or "使用本地 Codex 配置",
            },
            "blender": {
                "available": bool(
                    settings.blender_path and Path(settings.blender_path).is_file()
                )
            },
            "furniture_library": asset_status,
            "architecture": ["React", "FastAPI", "LangChain", "LangGraph", "SQLite"],
            "skills": registry.list(),
        }

    @app.post("/api/runtime/check")
    async def check_runtime():
        try:
            await codex.ensure_started()
        except Exception as exc:
            raise HTTPException(503, str(exc)) from exc
        return await health()

    @app.get("/api/skills")
    async def skills():
        return {"items": registry.list()}

    @app.get("/api/furniture")
    async def furniture_catalog():
        data = read_furniture_catalog()
        return {
            key: data[key] for key in ["version", "blender_version", "license", "items"]
        }

    @app.get("/api/models")
    async def models(refresh: bool = False):
        try:
            return await codex.list_models(refresh=refresh)
        except Exception as exc:
            raise HTTPException(503, f"无法读取本地 Codex 模型：{exc}") from exc

    async def resolve_model(options):
        catalog = await models()
        selected = options.model or catalog["default_model"]
        item = next((m for m in catalog["items"] if m["id"] == selected), None)
        if not item:
            raise HTTPException(422, "所选模型已不可用，请刷新模型列表后重新选择")
        if item["supports_image"] is False:
            raise HTTPException(422, "所选模型不支持图片，请选择支持户型图识别的模型")
        options.model = selected
        if options.reasoning_effort and options.reasoning_effort not in item["efforts"]:
            raise HTTPException(
                422, "所选模型不支持该推理强度，请刷新模型列表后重新选择"
            )
        effort = options.reasoning_effort or settings.codex_effort
        options.reasoning_effort = (
            effort if effort in item["efforts"] else item["default_effort"]
        )
        return options

    @app.get("/api/jobs")
    async def jobs():
        return {"items": [public(job) for job in await store.list()]}

    @app.post("/api/jobs", status_code=201)
    async def upload(
        request: Request,
        file: Annotated[UploadFile, File()],
        name: str = Form("", max_length=120),
        style: str = Form("natural"),
        notes: str = Form(""),
        collaboration: bool = Form(True),
        model: str = Form(""),
        reasoning_effort: str = Form(""),
        furniture_mode: str = Form("library"),
    ):
        try:
            options = JobOptions(
                style=style,
                notes=notes,
                collaboration=collaboration,
                model=model.strip() or None,
                reasoning_effort=reasoning_effort.strip() or None,
                furniture_mode=furniture_mode,
            )
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from exc
        content = bytearray()
        try:
            while chunk := await file.read(1024 * 1024):
                content.extend(chunk)
                if len(content) > settings.max_upload_bytes:
                    raise HTTPException(413, "图片不能超过 20 MB")
            normalized = await asyncio.to_thread(normalize_image, bytes(content))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            await file.close()
        if options.furniture_mode == "library":
            read_furniture_catalog()
        options = await resolve_model(options)
        job_id = uuid4().hex
        workspace = settings.workspace(job_id)
        workspace.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread((workspace / "source.png").write_bytes, normalized)
        name = (
            name.strip()
            or (file.filename or "我的户型").replace("\\", "/").split("/")[-1][:120]
        )
        await store.create(job_id, name, options.model_dump())
        request.app.state.runner.schedule(job_id)
        return public(await store.get(job_id))

    @app.get("/api/jobs/{job_id}")
    async def detail(job_id: UUID):
        return public(await require_job(job_id.hex))

    @app.get("/api/jobs/{job_id}/timeline")
    async def timeline(job_id: UUID, after: int = 0):
        await require_job(job_id.hex)
        return {"items": await store.events(job_id.hex, max(0, after))}

    @app.post("/api/jobs/{job_id}/cancel")
    async def cancel(job_id: UUID, request: Request):
        job = await require_job(job_id.hex)
        if job["status"] not in TERMINAL:
            await request.app.state.runner.cancel(job_id.hex)
        return public(await store.get(job_id.hex))

    @app.post("/api/jobs/{job_id}/retry", status_code=201)
    async def retry(job_id: UUID, request: Request):
        previous = await require_job(job_id.hex)
        if previous["status"] not in {"failed", "cancelled"}:
            raise HTTPException(409, "仅失败或取消的任务可以重试")
        source = settings.workspace(job_id.hex) / "source.png"
        if not source.exists():
            raise HTTPException(409, "原图已丢失，请重新上传")
        seed_path = settings.workspace(job_id.hex) / "rebuild-seed.json"
        options = JobOptions.model_validate(previous["options"])
        if not seed_path.exists():
            options = await resolve_model(options)
        new_id = uuid4().hex
        workspace = settings.workspace(new_id)
        workspace.mkdir(parents=True)
        await asyncio.to_thread(shutil.copyfile, source, workspace / "source.png")
        if seed_path.exists():
            await asyncio.to_thread(
                shutil.copyfile, seed_path, workspace / "rebuild-seed.json"
            )
        await store.create(new_id, previous["name"], options.model_dump())
        request.app.state.runner.schedule(new_id)
        return public(await store.get(new_id))

    @app.post("/api/jobs/{job_id}/rebuild", status_code=201)
    async def rebuild(job_id: UUID, request: Request):
        previous = await require_job(job_id.hex)
        if previous["status"] != "succeeded":
            raise HTTPException(409, "请等待户型生成成功后再更新家具")
        source_dir = settings.workspace(job_id.hex)
        try:
            data = json.loads((source_dir / "layout.json").read_text(encoding="utf-8"))
            layout = Layout.model_validate(
                {key: data[key] for key in Layout.model_fields if key in data}
            )
            furniture = Furnishing.model_validate(
                {"items": data["furniture"], "notes": data.get("furniture_notes", [])}
            )
            validate_furnishing(furniture, layout)
            if not (source_dir / "source.png").exists():
                raise ValueError("原图缺失")
        except (OSError, ValueError, KeyError) as exc:
            raise HTTPException(409, "原始结构数据不完整，请重新上传户型图") from exc
        await furniture_catalog()
        new_id = uuid4().hex
        workspace = settings.workspace(new_id)
        workspace.mkdir(parents=True)
        await asyncio.to_thread(
            shutil.copyfile, source_dir / "source.png", workspace / "source.png"
        )
        seed = {
            "layout": layout.model_dump(),
            "furniture": furniture.model_dump(),
            "rebuild_of": previous["id"],
        }
        (workspace / "rebuild-seed.json").write_text(
            json.dumps(seed, ensure_ascii=False), encoding="utf-8"
        )
        options = JobOptions.model_validate(
            {**previous["options"], "furniture_mode": "library"}
        )
        await store.create(
            new_id,
            previous["name"],
            options.model_dump(),
            message="复用原户型布局，精细家具更新任务已加入队列",
        )
        request.app.state.runner.schedule(new_id)
        return public(await store.get(new_id))

    @app.post("/api/jobs/{job_id}/edit", status_code=201)
    async def edit(job_id: UUID, document: ManualEditRequest, request: Request):
        previous = await require_job(job_id.hex)
        if previous["status"] != "succeeded":
            raise HTTPException(409, "请等待户型生成成功后再进行人工设计")
        source = settings.workspace(job_id.hex) / "source.png"
        if not source.is_file():
            raise HTTPException(409, "原始户型图缺失，无法创建设计版本")
        options = JobOptions.model_validate(previous["options"])
        if options.furniture_mode == "library":
            read_furniture_catalog()
        new_id = uuid4().hex
        workspace = settings.workspace(new_id)
        workspace.mkdir(parents=True)
        await asyncio.to_thread(shutil.copyfile, source, workspace / "source.png")
        seed = {
            "layout": document.layout.model_dump(),
            "furniture": document.furniture.model_dump(),
            "rebuild_of": previous["id"],
            "edited_of": previous["id"],
        }
        (workspace / "rebuild-seed.json").write_text(
            json.dumps(seed, ensure_ascii=False), encoding="utf-8"
        )
        await store.create(
            new_id,
            document.name.strip() or "人工设计方案",
            options.model_dump(),
            message="人工设计已保存，正在准备生成新的三维版本",
        )
        request.app.state.runner.schedule(new_id)
        return public(await store.get(new_id))

    @app.get("/api/jobs/{job_id}/events")
    async def events(job_id: UUID, request: Request, after: int = 0):
        await require_job(job_id.hex)
        try:
            cursor = max(0, int(request.headers.get("last-event-id") or after))
        except ValueError:
            raise HTTPException(422, "事件游标无效")

        async def stream():
            nonlocal cursor
            ticks = 0
            while not await request.is_disconnected():
                batch = await store.events(job_id.hex, cursor)
                for event in batch:
                    cursor = event["id"]
                    yield f"id: {cursor}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                job = await store.get(job_id.hex)
                if job["status"] in TERMINAL and len(batch) < 100:
                    break
                ticks += 1
                if ticks % 20 == 0:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(0.5)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/jobs/{job_id}/artifacts/{filename}")
    async def artifact(job_id: UUID, filename: str):
        job = await require_job(job_id.hex)
        if filename not in ARTIFACTS:
            raise HTTPException(404, "文件不存在")
        if (
            filename
            in {
                "model.glb",
                "model.blend",
                "layout.json",
                "manifest.json",
                "furniture-report.json",
            }
            and job["status"] != "succeeded"
        ):
            raise HTTPException(409, "任务尚未成功完成")
        path = settings.workspace(job_id.hex) / filename
        if not path.is_file():
            raise HTTPException(404, "文件不存在")
        media = {
            "model.glb": "model/gltf-binary",
            "source.png": "image/png",
            "layout.json": "application/json",
            "manifest.json": "application/json",
            "furniture-report.json": "application/json",
            "blender.log": "text/plain",
        }.get(filename, "application/octet-stream")
        return FileResponse(
            path,
            media_type=media,
            filename=filename,
            content_disposition_type="inline"
            if filename in {"source.png", "model.glb"}
            else "attachment",
        )

    if (ROOT / "dist" / "index.html").exists():
        app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
    return app


app = create_app()
