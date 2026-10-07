export const selectableModel = (item) =>
  Boolean(item) && item.available !== false && item.supports_image !== false;

export function chooseModel(catalog, current) {
  const items = catalog?.items || [];
  return (
    [current, catalog?.default_model].find((id) =>
      items.some((item) => item.id === id && selectableModel(item)),
    ) ||
    items.find(selectableModel)?.id ||
    ""
  );
}

export function generationError(value) {
  const text = String(value || "")
    .replaceAll("\\'", "'")
    .replaceAll('\\"', '"');
  const model = text.match(/The ['"]([^'"]+)['"] model is not supported/i)?.[1];
  return model
    ? `当前本地 Codex 登录不支持模型「${model}」。请刷新模型列表，选择其他模型后重试。若其他客户端能使用该模型，请检查本项目的 Codex CLI 版本和登录账号。`
    : value;
}
