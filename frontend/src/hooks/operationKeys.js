const memory = new Map();
const storageKey = (type) => `layoutsculpt-pending:${type}`;
export function operationKey(type, signature) {
  let old = memory.get(type);
  try {
    old ||= JSON.parse(sessionStorage.getItem(storageKey(type)));
  } catch {}
  if (old?.signature === signature) return old.key;
  const value = { signature, key: crypto.randomUUID() };
  memory.set(type, value);
  try {
    sessionStorage.setItem(storageKey(type), JSON.stringify(value));
  } catch {}
  return value.key;
}
export function finishOperation(type) {
  memory.delete(type);
  try {
    sessionStorage.removeItem(storageKey(type));
  } catch {}
}
export async function formSignature(form) {
  const fields = await Promise.all(
    [...form.entries()].map(async ([key, value]) => [
      key,
      typeof value === "string"
        ? value
        : [
            value.name,
            value.type,
            [
              ...new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  await value.arrayBuffer(),
                ),
              ),
            ]
              .map((n) => n.toString(16).padStart(2, "0"))
              .join(""),
          ],
    ]),
  );
  return JSON.stringify(fields);
}
