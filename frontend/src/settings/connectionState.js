export const providerNames = { codex: "Codex", deepseek: "DeepSeek API" };

export function savedModelId(settings, provider) {
  const id = settings?.[provider]?.default_model;
  if (!id) return "";
  return provider === "deepseek" && !id.startsWith("deepseek::")
    ? `deepseek::${id}`
    : id;
}

export const readableModelId = (id) => id?.replace(/^deepseek::/, "") || "";

export function hasConnectionChanges(settings, provider, model, key = "") {
  return Boolean(
    settings &&
    (provider !== settings.default_provider ||
      model !== savedModelId(settings, provider) ||
      key.trim()),
  );
}
