import { newPart } from "./design.js";

const part = (name, values) => ({ ...newPart(), name, ...values });
export function furnitureTemplate(kind) {
  let parts;
  if (kind === "bed") {
    parts = [
      part("内收落地托座", {
        shape: "rounded_box",
        width: 1.3,
        depth: 1.73,
        height: 0.11,
        color: "#684c3c",
      }),
      part("原木床架", {
        shape: "rounded_box",
        width: 1.62,
        depth: 2.08,
        height: 0.22,
        z: 0.1,
        color: "#8b674e",
      }),
      part("织物床垫", {
        shape: "rounded_box",
        width: 1.58,
        depth: 2,
        height: 0.22,
        z: 0.32,
        color: "#eee7dc",
        roughness: 0.95,
      }),
      part("软包床头", {
        shape: "rounded_box",
        width: 1.7,
        depth: 0.13,
        height: 0.95,
        y: -0.99,
        z: 0.1,
        color: "#c6b8a2",
        roughness: 0.95,
      }),
      part("薄被", {
        shape: "rounded_box",
        width: 1.59,
        depth: 1.2,
        height: 0.06,
        y: 0.35,
        z: 0.54,
        color: "#a8b4aa",
        roughness: 0.95,
      }),
      ...[-0.4, 0.4].map((x) =>
        part("枕头", {
          shape: "rounded_box",
          width: 0.65,
          depth: 0.43,
          height: 0.12,
          x,
          y: -0.67,
          z: 0.54,
          color: "#f3eee5",
          roughness: 0.95,
        }),
      ),
    ];
  } else if (kind === "sofa") {
    parts = [
      part("底座", {
        shape: "rounded_box",
        width: 2.1,
        depth: 0.9,
        height: 0.18,
        z: 0.12,
        color: "#897765",
      }),
      ...[-0.45, 0.45].map((x) =>
        part("座垫", {
          shape: "rounded_box",
          width: 0.88,
          depth: 0.71,
          height: 0.17,
          x,
          y: 0.06,
          z: 0.3,
          color: "#d9d1c5",
          roughness: 0.94,
        }),
      ),
      ...[-0.45, 0.45].map((x) =>
        part("靠垫", {
          shape: "rounded_box",
          width: 0.88,
          depth: 0.19,
          height: 0.43,
          x,
          y: -0.35,
          z: 0.42,
          color: "#d9d1c5",
          roughness: 0.94,
        }),
      ),
      ...[-0.99, 0.99].map((x) =>
        part("扶手", {
          shape: "rounded_box",
          width: 0.16,
          depth: 0.89,
          height: 0.38,
          x,
          z: 0.3,
          color: "#c7bcac",
          roughness: 0.94,
        }),
      ),
      ...[-0.85, 0.85].flatMap((x) =>
        [-0.31, 0.31].map((y) =>
          part("木脚", {
            width: 0.06,
            depth: 0.06,
            height: 0.12,
            x,
            y,
            color: "#70533f",
          }),
        ),
      ),
    ];
  } else if (kind === "shelf") {
    parts = [
      ...[-0.46, 0.46].map((x) =>
        part("侧板", { x, width: 0.04, depth: 0.32, height: 1.8 }),
      ),
      ...[0.06, 0.48, 0.9, 1.32, 1.76].map((z) =>
        part("层板", { width: 0.88, depth: 0.32, height: 0.04, z }),
      ),
      part("背板", {
        width: 0.88,
        depth: 0.02,
        height: 1.76,
        y: -0.15,
        color: "#d8c2a0",
      }),
    ];
  } else if (kind === "table" || kind === "desk") {
    parts = [
      part("圆角桌面", {
        shape: "rounded_box",
        width: 1.2,
        depth: 0.75,
        height: 0.06,
        z: 0.7,
      }),
      ...[-0.48, 0.48].flatMap((x) =>
        [-0.27, 0.27].map((y) =>
          part("实木桌腿", {
            shape: "cylinder",
            x,
            y,
            width: 0.055,
            depth: 0.055,
            height: 0.7,
          }),
        ),
      ),
    ];
  } else if (kind === "cabinet") {
    parts = [
      part("内收落地底座", {
        width: 1.06,
        depth: 0.28,
        height: 0.105,
        color: "#6e5647",
      }),
      part("柜体", { width: 1.2, depth: 0.35, height: 0.85, z: 0.1 }),
      ...[-0.3, 0.3].map((x) =>
        part("柜门", {
          x,
          y: -0.19,
          width: 0.59,
          depth: 0.025,
          height: 0.79,
          z: 0.13,
          color: "#e5e0d2",
        }),
      ),
      ...[-0.08, 0.08].map((x) =>
        part("黄铜把手", {
          x,
          y: -0.215,
          width: 0.018,
          depth: 0.025,
          height: 0.15,
          z: 0.49,
          color: "#b79558",
          metallic: 0.8,
          roughness: 0.3,
        }),
      ),
    ];
  } else {
    parts = [
      part("座垫", {
        shape: "rounded_box",
        width: 0.5,
        depth: 0.48,
        height: 0.08,
        z: 0.43,
        color: "#d3c8b7",
      }),
      part("靠背", {
        shape: "rounded_box",
        width: 0.5,
        depth: 0.07,
        height: 0.4,
        y: 0.22,
        z: 0.48,
        color: "#d3c8b7",
      }),
      ...[-0.2, 0.2].flatMap((x) =>
        [-0.18, 0.18].map((y) =>
          part("椅腿", {
            shape: "cylinder",
            x,
            y,
            width: 0.035,
            depth: 0.035,
            height: 0.43,
          }),
        ),
      ),
    ];
  }
  return {
    name: {
      table: "圆角实木餐桌",
      cabinet: "双门玄关柜",
      chair: "软包餐椅",
      bed: "原木软包双人床",
      sofa: "双人布艺沙发",
      desk: "简约实木书桌",
      shelf: "五层开放书架",
    }[kind],
    category: "furniture",
    parts,
  };
}
