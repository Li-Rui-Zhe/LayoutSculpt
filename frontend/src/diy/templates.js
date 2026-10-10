import { newPart } from "./design.js";

const part = (name, values) => ({ ...newPart(), name, ...values });
export function furnitureTemplate(kind) {
  let parts;
  if (kind === "table") {
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
    name: { table: "圆角实木餐桌", cabinet: "双门玄关柜", chair: "软包餐椅" }[
      kind
    ],
    category: "furniture",
    parts,
  };
}
