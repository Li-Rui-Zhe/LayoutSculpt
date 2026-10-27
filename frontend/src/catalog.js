import materialCatalog from "../../assets/materials/catalog.json" with { type: "json" };
import showcase from "./showcase.json" with { type: "json" };

export { showcase };

export const materials = materialCatalog.items;
export const materialCategories = materialCatalog.categories;
export const compatibleMaterialCategories = Object.fromEntries(
  Object.entries(materialCategories).map(([category, ids]) => [
    category,
    [
      ...new Set([
        ...ids,
        ...(materialCatalog.legacy_categories?.[category] || []),
      ]),
    ],
  ]),
);
export const presets = [
  {
    id: "midday",
    name: "晴天",
    description: "明净日光 · 自然层次",
    time: "12:00",
    icon: "sun",
    intensity: 2.6,
    color: "#fff2db",
    position: [-4, 9, 6],
    ambient: 1.0,
    exposure: 1.02,
    sky: "#e4efff",
    bounce: "#998975",
    fill: 0.65,
    fillColor: "#d4e6f1",
    environment: 0.42,
    background: "#e8ede7",
    ground: "#e8ede7",
    ao: 0.5,
  },
  {
    id: "sunset",
    name: "日落",
    description: "琥珀斜阳 · 温暖归家",
    time: "日落",
    icon: "sunset",
    intensity: 3.1,
    color: "#ffba78",
    position: [-9, 4.5, 7],
    ambient: 0.68,
    exposure: 0.96,
    sky: "#d4dcf3",
    bounce: "#b48a72",
    fill: 0.4,
    fillColor: "#b9c9ed",
    environment: 0.33,
    background: "#e6cfc2",
    ground: "#e6cfc2",
    ao: 0.48,
  },
  {
    id: "night",
    name: "夜晚",
    description: "静谧夜色 · 室内暖光",
    time: "21:00",
    icon: "moon",
    intensity: 0.07,
    color: "#96c7ff",
    position: [6, 8, -3],
    ambient: 0.18,
    exposure: 0.9,
    sky: "#b4c6de",
    bounce: "#b9a28e",
    fill: 0.16,
    fillColor: "#9ebbe7",
    environment: 0.25,
    background: "#293941",
    ground: "#293941",
    ao: 0.42,
  },
];
