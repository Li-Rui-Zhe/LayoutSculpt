export const PAINT_SIZE = 1024;

export function canvasPoint(rect, clientX, clientY) {
  return {
    x: Math.max(
      0,
      Math.min(PAINT_SIZE, ((clientX - rect.left) / rect.width) * PAINT_SIZE),
    ),
    y: Math.max(
      0,
      Math.min(PAINT_SIZE, ((clientY - rect.top) / rect.height) * PAINT_SIZE),
    ),
  };
}

export function paintMark(
  context,
  from,
  to,
  { tool, color, width, opacity, wrap = true },
) {
  context.save();
  context.globalCompositeOperation =
    tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = tool === "eraser" ? 1 : opacity;
  for (const x of wrap ? [-PAINT_SIZE, 0, PAINT_SIZE] : [0])
    for (const y of wrap ? [-PAINT_SIZE, 0, PAINT_SIZE] : [0]) {
      context.save();
      context.translate(x, y);
      context.beginPath();
      if (tool === "rect")
        context.rect(from.x, from.y, to.x - from.x, to.y - from.y);
      else if (tool === "ellipse")
        context.ellipse(
          (from.x + to.x) / 2,
          (from.y + to.y) / 2,
          Math.max(0.01, Math.abs(to.x - from.x) / 2),
          Math.max(0.01, Math.abs(to.y - from.y) / 2),
          0,
          0,
          Math.PI * 2,
        );
      else {
        context.moveTo(from.x, from.y);
        context.lineTo(to.x + 0.01, to.y + 0.01);
      }
      context.stroke();
      context.restore();
    }
  context.restore();
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("surface-artwork", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readArtwork(category) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("drafts")
        .objectStore("drafts")
        .get(category);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeArtwork(category, value) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(value, category);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
