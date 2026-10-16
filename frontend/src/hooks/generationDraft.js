function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("layoutsculpt-generation", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = action(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
let queue = Promise.resolve();
function ordered(mode, action) {
  const result = queue.then(() => transaction(mode, action));
  queue = result.catch(() => {});
  return result;
}
export const readGenerationDraft = () =>
  ordered("readonly", (store) => store.get("current"));
export const saveGenerationDraft = (value) =>
  ordered("readwrite", (store) => store.put(value, "current"));
export const clearGenerationDraft = () =>
  ordered("readwrite", (store) => store.delete("current"));
