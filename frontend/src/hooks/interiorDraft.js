// 独立保存取景草稿，不与户型、家具的草稿互相覆盖。
export function validInteriorDraft(value) {
  const ref = value?.reference;
  if (
    !ref ||
    typeof ref.image !== "string" ||
    !(
      /^(data:image\/jpeg;base64,)/.test(ref.image) ||
      /^\/api\/interior-images\/[a-f0-9]{32}\/view\.jpg$/.test(ref.image)
    )
  )
    return null;
  if (ref.image.length > 6_000_000) return null;
  return {
    reference: ref,
    prompt: typeof value.prompt === "string" ? value.prompt.slice(0, 1200) : "",
    submissionId: /^[a-f0-9]{32}$/.test(value.submissionId || "")
      ? value.submissionId
      : null,
  };
}

let queue = Promise.resolve();
function transact(mode, action) {
  const result = queue.then(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("layoutsculpt-interior", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("drafts");
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error("请关闭其他旧版工作台后重试"));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("drafts", mode);
          const request = action(tx.objectStore("drafts"));
          tx.oncomplete = () => {
            db.close();
            resolve(request.result);
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error || new Error("草稿保存中断"));
          };
        };
      }),
  );
  queue = result.catch(() => {});
  return result;
}
export const readInteriorDraft = async () =>
  validInteriorDraft(await transact("readonly", (s) => s.get("current")));
export const writeInteriorDraft = (value) =>
  transact("readwrite", (s) =>
    value?.reference ? s.put(value, "current") : s.delete("current"),
  );
