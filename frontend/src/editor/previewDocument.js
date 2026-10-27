// 仅为显示裁切超出墙顶的门窗，保留对象 ID、顺序和原始草稿。
// 保存仍校验原稿；用户显式应用修正后才进入撤销记录。
export function preparePreviewDocument(document) {
  const walls = new Map(document.layout.walls.map((wall) => [wall.id, wall]));
  const adjustments = [];
  const openings = document.layout.openings.map((opening, index) => {
    const wall = walls.get(opening.wall_id);
    if (
      !wall ||
      ![opening.bottom, opening.height, wall.height].every(Number.isFinite) ||
      opening.bottom < 0 ||
      opening.height <= 0 ||
      wall.height < 0.3 ||
      opening.bottom + opening.height <= wall.height + 1e-6
    )
      return opening;
    const height = Math.min(opening.height, wall.height);
    // 保留窗台位置优先；窗台本身高于墙顶时下移到能放下最小开口的位置。
    const bottom =
      opening.kind === "window"
        ? Math.min(opening.bottom, wall.height - Math.min(height, 0.1))
        : 0;
    const nextHeight = Math.min(height, wall.height - bottom);
    const label = `${{ window: "窗户", door: "门", passage: "通道" }[opening.kind]} ${index + 1}`;
    const adjusted = { ...opening, bottom, height: nextHeight };
    adjustments.push({
      index,
      label,
      wallId: wall.id,
      wallHeight: wall.height,
      top: opening.bottom + opening.height,
      locked: Boolean(opening.edit_locked),
      bottom,
      height: nextHeight,
    });
    return adjusted;
  });
  return {
    document: adjustments.length
      ? { ...document, layout: { ...document.layout, openings } }
      : document,
    adjustments,
  };
}

export function applyOpeningHeightFix(document, index) {
  const preview = preparePreviewDocument(document);
  const change = preview.adjustments.find((entry) => entry.index === index);
  if (!change) return document;
  if (change.locked) throw Error("该门窗已锁定，请先解锁再修正。");
  return {
    ...document,
    layout: {
      ...document.layout,
      openings: document.layout.openings.map((opening, i) =>
        i === index
          ? { ...opening, bottom: change.bottom, height: change.height }
          : opening,
      ),
    },
  };
}
