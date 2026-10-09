import materialCatalog from "../../assets/materials/catalog.json" with { type: "json" };
import showcase from "./showcase.json" with { type: "json" };

export { showcase };

export const materials = materialCatalog.items;
export const materialCategories = materialCatalog.categories;
export const presets = [
  {
    id: "midday",
    name: "白天",
    time: "12:00",
    icon: "sun",
    intensity: 3.0,
    color: "#fffaf1",
    position: [1, 12, 2],
    ambient: 1.1,
    exposure: 1.0,
  },
  {
    id: "night",
    name: "夜晚",
    time: "21:00",
    icon: "moon",
    intensity: 0.07,
    color: "#96c7ff",
    position: [6, 8, -3],
    ambient: 0.18,
    exposure: 0.9,
  },
];
