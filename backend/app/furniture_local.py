"""Bounded single-furniture AI proposals. No automatic project writes."""

import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TypedDict
from uuid import UUID
from fastapi import HTTPException, Request
from pydantic import Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langgraph.graph import StateGraph, START, END
from .schemas import StrictModel, ManualEditRequest, JobOptions
from .codex import CodexChatModel, CodexError
from .disconnect import while_connected
from .ai_requests import asset_input, layout_input
from .public_errors import public_message
from .quality import furnishing_issues


class FurnitureLocalRequest(ManualEditRequest):
    target_id: str = Field(min_length=1, max_length=100)
    notes: str = Field(min_length=1, max_length=1500)
    model: str | None = Field(default=None, max_length=160)
    reasoning_effort: str | None = Field(default=None, max_length=40)


class FurnitureProposal(StrictModel):
    summary: str = Field(min_length=1, max_length=500)
    asset_id: str | None = Field(default=None, max_length=100)
    x: float
    y: float
    elevation: float = Field(ge=0, le=3)
    rotation: float = Field(ge=-360, le=360)
    width: float = Field(ge=0.1, le=6)
    depth: float = Field(ge=0.1, le=6)
    height: float = Field(ge=0.02, le=3)


def apply_furniture_proposal(body, proposal, template=None):
    data = body.furniture.model_dump()
    target = next(
        (f for f in data["items"] if f.get("edit_id") == body.target_id), None
    )
    if not target or target.get("edit_locked"):
        raise ValueError("所选家具不存在或已锁定，请重新选择")
    if any(
        f.parent_furniture_id == body.target_id for f in body.furniture.items
    ) or any(
        l.parent_furniture_id == body.target_id for l in body.layout.presentation_layers
    ):
        raise ValueError(
            "这件家具有跟随物品，请先解除联动后使用 AI 单件调整；手动移动仍可整组联动"
        )
    if template:
        for key in ("kind", "asset_id", "source_asset_id", "asset_family", "diy"):
            target[key] = template.get(key)
    for key in ("x", "y", "elevation", "rotation", "width", "depth", "height"):
        target[key] = getattr(proposal, key)
    # 全屋结构与所有其他家具原样保留；只验证并返回所选对象。
    validated = ManualEditRequest(name=body.name, layout=body.layout, furniture=data)
    original_issues = set(furnishing_issues(body.furniture, body.layout))
    warnings = [
        text
        for text in furnishing_issues(validated.furniture, validated.layout)
        if text not in original_issues
    ]
    return {
        "item": next(
            f.model_dump()
            for f in validated.furniture.items
            if f.edit_id == body.target_id
        ),
        "summary": proposal.summary,
        "warnings": warnings[:8],
    }


class ProposalState(TypedDict, total=False):
    proposal: dict
    result: dict


def install_furniture_local(
    app, store, settings, client, registry, resolve_model, library
):
    gate = asyncio.Semaphore(1)

    @app.post("/api/jobs/{job_id}/furniture-proposal")
    async def propose(job_id: UUID, body: FurnitureLocalRequest, request: Request):
        job = await store.get(job_id.hex)
        if not job or job["status"] != "succeeded":
            raise HTTPException(409, "请先完成户型生成")
        selected = next(
            (item for item in body.furniture.items if item.edit_id == body.target_id),
            None,
        )
        if not selected or selected.edit_locked:
            raise HTTPException(422, "请选中未锁定的家具")
        if not body.notes.strip():
            raise HTTPException(422, "请填写需要调整的内容")
        if any(
            item.parent_furniture_id == body.target_id
            for item in [*body.furniture.items, *body.layout.presentation_layers]
        ):
            raise HTTPException(
                422, "请先解除跟随物品，再使用 AI 单件调整；也可以继续手动整组移动"
            )
        try:
            options = await resolve_model(
                JobOptions(model=body.model, reasoning_effort=body.reasoning_effort),
                require_image=False,
            )
            catalog = [
                item
                for item in await library.catalog(for_ai=True)
                if item.get("kind") == selected.kind
            ][:24]
            allowed = {item["asset_id"] for item in catalog}
            instructions, skills = registry.compose("furniture-local-edit")
            async with asyncio.timeout(min(settings.codex_timeout, 180)), gate:
                with TemporaryDirectory(
                    prefix="furniture-proposal-", dir=settings.data_dir
                ) as directory:
                    llm = CodexChatModel(
                        client=client,
                        workspace=Path(directory),
                        instructions=instructions,
                        response_schema=FurnitureProposal.model_json_schema(),
                        model_name=options.model,
                        reasoning_effort=options.reasoning_effort,
                    )
                    chain = (
                        ChatPromptTemplate.from_messages(
                            [
                                (
                                    "human",
                                    "用户要求：{notes}\n所选家具：{selected}\n房屋结构：{layout}\n其他家具：{others}\n同类可用款式：{catalog}",
                                )
                            ]
                        )
                        | llm
                        | PydanticOutputParser(pydantic_object=FurnitureProposal)
                    )

                    async def generate(state):
                        value = await chain.ainvoke(
                            {
                                "notes": body.notes,
                                "selected": selected.model_dump_json(),
                                "layout": json.dumps(
                                    layout_input(body.layout), ensure_ascii=False
                                ),
                                "others": json.dumps(
                                    [
                                        f.model_dump(
                                            include={
                                                "name",
                                                "kind",
                                                "x",
                                                "y",
                                                "width",
                                                "depth",
                                                "height",
                                                "rotation",
                                                "elevation",
                                            }
                                        )
                                        for f in body.furniture.items
                                        if f.edit_id != body.target_id
                                    ],
                                    ensure_ascii=False,
                                ),
                                "catalog": json.dumps(
                                    asset_input(catalog), ensure_ascii=False
                                ),
                            }
                        )
                        return {"proposal": value.model_dump()}

                    async def validate(state):
                        value = FurnitureProposal.model_validate(state["proposal"])
                        template = None
                        if value.asset_id and value.asset_id != selected.asset_id:
                            if value.asset_id not in allowed:
                                raise ValueError("AI 选择的款式不在本次同类素材范围内")
                            template = await library.placement(value.asset_id)
                        return {
                            "result": apply_furniture_proposal(body, value, template)
                        }

                    graph = StateGraph(ProposalState)
                    graph.add_node("propose", generate)
                    graph.add_node("validate", validate)
                    graph.add_edge(START, "propose")
                    graph.add_edge("propose", "validate")
                    graph.add_edge("validate", END)
                    result = await while_connected(request, graph.compile().ainvoke({}))
                    return {**result["result"], "skills": skills}
        except TimeoutError as exc:
            raise HTTPException(
                504, "调整建议等待超时，当前设计未修改，请重试"
            ) from exc
        except (ValueError, CodexError) as exc:
            raise HTTPException(
                422,
                public_message(
                    exc, "调整建议未通过检查，当前设计未修改，请换一种具体描述重试"
                ),
            ) from exc
