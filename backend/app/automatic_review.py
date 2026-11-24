"""Check automatic structure decisions against the original image and saved reads."""

import numpy as np
from PIL import Image

from .ai_contracts import apply_review_patch
from .consistency import structure_hash
from .floorplan_evidence import MASK_FILE, compare_floorplan_mask
from .local_structure_repair import same_place, validate_access, validate_repair_extent
from .outline_recesses import layout_recess_findings
from .source_evidence import SourceEvidence, compare_source, image_wall_findings
from .wall_evidence import combine_wall_observations


def merged_findings(primary, independent):
    walls = combine_wall_observations(primary, independent)
    distinct = []
    for item in [
        f for f in primary + independent if f["code"] != "missing_wall"
    ] + walls:
        if item not in distinct:
            distinct.append(item)
    return distinct


def assess_candidate(state, workspace, candidate):
    """Reuse this job's evidence and segmentation when assessing a final correction."""
    alignment = state["source_alignment"]
    primary = SourceEvidence.model_validate(state["source_evidence"])
    prepared = state.get("prepared_audit") or {}
    audit = (
        SourceEvidence.model_validate(prepared["data"])
        if prepared.get("status") == "completed"
        else None
    )
    local = alignment.get("local_segmentation")
    mask = None
    if (
        local
        and local.get("artifact") == MASK_FILE
        and (workspace / MASK_FILE).is_file()
    ):
        with Image.open(workspace / MASK_FILE) as image:
            mask = np.array(image)
    source = workspace / "source.png"

    layout = candidate.model_dump()
    comparison = compare_source(layout, primary, alignment, source=source)
    findings = comparison["findings"]
    if audit:
        comparison = compare_source(layout, audit, alignment, source=source)
        findings = merged_findings(findings, comparison["findings"])
    pixels = image_wall_findings(
        source, layout, alignment, mask=mask
    ) + layout_recess_findings(layout, alignment)
    findings.extend(pixels)
    findings.extend(
        f for f in alignment["findings"] if f["code"] == "dimension_disagreement"
    )
    updated = {
        **alignment,
        "outline_overlap": comparison["outline_overlap"],
        "findings": findings,
        "image_findings": pixels,
    }
    if mask is not None:
        updated["local_segmentation"] = {
            **local,
            "findings": compare_floorplan_mask(mask, layout, alignment),
        }
    return updated


def apply_evidence_patch(state, workspace, candidate, patch):
    alignment = state.get("source_alignment")
    proposed = apply_review_patch(candidate, patch)
    if structure_hash(proposed) == structure_hash(candidate):
        return proposed, alignment

    before, after = candidate.model_dump(), proposed.model_dump()
    validate_access(before, after)
    if not (alignment and state.get("source_evidence")):
        return proposed, alignment

    old = [f for f in alignment["findings"] if f["blocking"]]
    if old and all(
        f["code"] in {"opening_mismatch", "missing_wall", "weak_image_wall"}
        and f.get("box")
        for f in old
    ):
        # Limit a localized repair to the disputed area, including adjacent jambs.
        pad = max(4, 0.6 / alignment["meters_per_pixel"])
        views = [
            {"box": [x1 - pad, y1 - pad, x2 + pad, y2 + pad]}
            for finding in old
            for x1, y1, x2, y2 in [finding["box"]]
        ]
        validate_repair_extent(before, after, views, alignment)

    updated = assess_candidate(state, workspace, proposed)
    new = [f for f in updated["findings"] if f["blocking"]]

    def same_issue(a, b):
        return same_place(a, b) and a.get("expected_kind") == b.get("expected_kind")

    if any(not any(same_issue(f, previous) for previous in old) for f in new):
        raise ValueError("自动修正引入了新的原图分歧")
    if old and all(any(same_issue(f, current) for current in new) for f in old):
        raise ValueError("自动修正没有消除已定位的原图分歧")
    return proposed, updated
