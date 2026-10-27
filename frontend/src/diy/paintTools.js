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
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () => fail(Error("读取手绘草稿超时，请关闭其他工作台页面后重试")),
      5000,
    );
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () =>
      fail(Error("手绘草稿正被其他页面占用，请关闭旧页面后重试"));
    request.onerror = () => fail(request.error || Error("无法读取手绘草稿"));
  });
}
export async function readArtwork(category) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts");
      const request = tx.objectStore("drafts").get(category);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error || Error("手绘草稿读取被中断"));
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
      tx.onabort = () => reject(tx.error || Error("手绘草稿保存被中断"));
    });
  } finally {
    db.close();
  }
}
