export function generationDraftContent(value = {}) {
  const text = (v) => (typeof v === "string" ? v : "");
  return {
    version: 1,
    file: value.file instanceof Blob && value.file.size ? value.file : null,
    name: text(value.name),
    style: text(value.style) || "natural",
    styleDescription: text(value.styleDescription),
    notes: text(value.notes),
    finishes: {
      walls: text(value.finishes?.walls),
      floor: text(value.finishes?.floor),
    },
    collaboration: value.collaboration !== false,
    manualReview: value.manualReview === true,
    recognitionMode: value.recognitionMode === "fast" ? "fast" : "precise",
    furnitureMode: text(value.furnitureMode) || "library",
  };
}

export function hasGenerationDraft(value) {
  const d = generationDraftContent(value);
  return Boolean(
    d.file ||
    d.name.trim() ||
    d.notes.trim() ||
    d.styleDescription.trim() ||
    d.style !== "natural" ||
    d.finishes.walls ||
    d.finishes.floor ||
    !d.collaboration ||
    d.manualReview ||
    d.recognitionMode !== "precise" ||
    d.furnitureMode !== "library",
  );
}
