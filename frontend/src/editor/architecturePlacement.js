import {
  applyArchitecture,
  architecturePreset,
} from "../library/architectureCatalog.js";
import { problems, round, wallLength, contains } from "./geometry.js";
import { fitOutline } from "./autoOutline.js";
import lightingCatalog from "../library/lightingCatalog.json" with { type: "json" };

export function placementPreset(configuration) {
  if (!configuration?.light_kind) return architecturePreset(configuration);
  const preset = lightingCatalog.find(
    (item) => item.kind === configuration.light_kind,
  );
  return preset ? { ...preset, light: true } : null;
}

function lightPlacementAt(document, configuration, point) {
  const preset = placementPreset(configuration);
  if (!preset) return { valid: false, message: "请选择有效灯具。" };
  if (!point)
    return {
      valid: false,
      message: "移动到落点查看位置，点击放置；Esc 取消。",
    };
  const fixture = {
    id: "__light_candidate__",
    name: preset.name,
    kind: preset.kind,
    x: round(point.x),
    y: round(point.y),
    elevation: configuration.elevation ?? preset.elevation,
    lumens: configuration.lumens ?? preset.lumens,
    temperature: 3000,
    enabled: true,
  };
  if (
    ![fixture.x, fixture.y, fixture.elevation, fixture.lumens].every(
      Number.isFinite,
    ) ||
    fixture.elevation < 0.1 ||
    fixture.elevation > 4.5 ||
    fixture.lumens < 0 ||
    fixture.lumens > 3000
  )
    return { valid: false, message: "请检查光源高度和亮度。" };
  const item = {
    x: fixture.x,
    y: fixture.y,
    width: 0.49,
    depth: 0.49,
    height: 0.18,
    elevation: Math.max(0, fixture.elevation - 0.09),
    rotation: 0,
  };
  if (document.layout.lights.length >= 12)
    return { valid: false, item, message: "最多支持 12 盏灯具。" };
  if (!contains(fixture, document.layout.outline))
    return { valid: false, item, message: "请将灯具放在户型范围内。" };
  const next = structuredClone(document);
  next.layout.lights.push(fixture);
  return {
    valid: true,
    item,
    next,
    selection: { type: "lights", index: next.layout.lights.length - 1 },
    message: `${preset.name} · 点击放置，放好后可拖动和调整高度、亮度。`,
  };
}

export function nearestArchitectureWall(layout, point) {
  let best = null;
  for (const wall of layout.walls) {
    if (wall.edit_hidden || (point.wallId && wall.id !== point.wallId))
      continue;
    const length = wallLength(wall);
    if (length < 0.05) continue;
    const dx = (wall.end.x - wall.start.x) / length;
    const dy = (wall.end.y - wall.start.y) / length;
    const along = Math.max(
      0,
      Math.min(
        length,
        (point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy,
      ),
    );
    const x = wall.start.x + dx * along,
      y = wall.start.y + dy * along;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance)
      best = { wall, along, distance, dx, dy };
  }
  return best && (point.wallId || best.distance <= 0.5) ? best : null;
}

// Both editors use the same candidate and validation; hovering never writes a draft.
export function architecturePlacementAt(
  document,
  configuration,
  point,
  rotation = 0,
) {
  if (configuration?.light_kind)
    return lightPlacementAt(document, configuration, point);
  const preset = architecturePreset(configuration);
  let item = null;
  try {
    if (!preset) throw Error("请选择有效的建筑构件。");
    if (!point)
      return {
        valid: false,
        message: preset.opening
          ? "移动到安装墙面，点击确认位置。"
          : "移动到落点，点击放置；R 旋转，Esc 取消。",
      };
    if (![point.x, point.y, rotation].every(Number.isFinite))
      throw Error("位置或角度无效。");
    let next, selection;
    if (preset.opening) {
      if (document.layout.openings.length >= 80)
        throw Error("最多可放置 80 个门窗或通道。");
      const target = nearestArchitectureWall(document.layout, point);
      if (!target) throw Error("请靠近或点击要安装的墙面。");
      const { wall, along, dx, dy } = target;
      const width = configuration.width ?? preset.opening.width;
      const offset = round(
        Math.max(0, Math.min(wallLength(wall) - width, along - width / 2)),
      );
      const center = offset + width / 2;
      item = {
        x: wall.start.x + dx * center,
        y: wall.start.y + dy * center,
        width,
        depth: wall.thickness + 0.02,
        height: configuration.height ?? preset.height,
        elevation: configuration.bottom ?? preset.opening.bottom,
        rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      };
      next = applyArchitecture(document, wall.id, {
        ...configuration,
        opening_ref: undefined,
        offset,
      });
      selection = { type: "openings", index: next.layout.openings.length - 1 };
    } else {
      const length = configuration.length ?? 2.4;
      if (!Number.isFinite(length) || length < 0.1 || length > 30)
        throw Error("新墙段长度需为 0.10–30 米。");
      if (document.layout.walls.length >= 120)
        throw Error("最多支持 120 面墙。");
      const angle = (rotation * Math.PI) / 180,
        dx = (Math.cos(angle) * length) / 2,
        dy = (Math.sin(angle) * length) / 2;
      item = {
        x: point.x,
        y: point.y,
        width: length,
        depth: configuration.thickness ?? preset.thickness,
        height: configuration.height ?? preset.height,
        elevation: 0,
        rotation,
      };
      const wall = {
        id: "__architecture_candidate__",
        start: { x: round(point.x - dx), y: round(point.y - dy) },
        end: { x: round(point.x + dx), y: round(point.y + dy) },
        height: item.height,
        thickness: item.depth,
        exterior: preset.category === "阳台",
        finish: "default",
      };
      if (
        [wall.start.x, wall.start.y, wall.end.x, wall.end.y].some(
          (v) => Math.abs(v) > 60,
        )
      )
        throw Error("墙体端点需位于 -60～60 米范围。");
      next = structuredClone(document);
      next.layout.walls.push(wall);
      next = applyArchitecture(next, wall.id, configuration);
      selection = { type: "walls", index: next.layout.walls.length - 1 };
    }
    next = fitOutline(document, next);
    const previous = new Set(
      problems(document).map((p) => `${p.type}:${p.index}:${p.text}`),
    );
    const issue = problems(next).find(
      (p) => !previous.has(`${p.type}:${p.index}:${p.text}`),
    );
    if (issue) throw Error(issue.text);
    return {
      valid: true,
      item,
      next,
      selection,
      message: `${preset.name} · 点击放置，放好后可拖动和修改参数。`,
    };
  } catch (error) {
    if (
      item &&
      (![
        item.x,
        item.y,
        item.width,
        item.height,
        item.depth,
        item.elevation,
        item.rotation,
      ].every(Number.isFinite) ||
        Math.min(item.width, item.height, item.depth) <= 0)
    )
      item = null;
    return { valid: false, item, message: error.message };
  }
}

export function commitArchitecturePlacement(result) {
  if (!result?.valid) throw Error(result?.message || "请先选择有效位置。");
  const next = structuredClone(result.next);
  const object = next.layout[result.selection.type][result.selection.index];
  if (result.selection.type === "walls")
    object.id = `manual_${crypto.randomUUID().slice(0, 12)}`;
  if (result.selection.type === "lights")
    object.id = `light_${crypto.randomUUID().slice(0, 12)}`;
  object.edit_id = crypto.randomUUID();
  return { document: next, selection: result.selection };
}
