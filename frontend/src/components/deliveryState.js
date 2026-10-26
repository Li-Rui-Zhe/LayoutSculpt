import { designFingerprint } from "../editor/objectIdentity.js";
import { toDraft } from "../editor/geometry.js";
import { restoreDraft } from "../hooks/restoreDraft.js";

export const deliveryFingerprint = (value) =>
  JSON.stringify(designFingerprint(value));
export function deliveryState(local, remote, layout) {
  const original = toDraft(layout);
  const choice = restoreDraft(local, remote, original);
  return {
    ...choice,
    changed:
      deliveryFingerprint(choice.document) !== deliveryFingerprint(original),
  };
}
