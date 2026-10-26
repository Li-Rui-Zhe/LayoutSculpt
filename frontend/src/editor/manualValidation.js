import { problems } from "./geometry.js";
import { showerProblems } from "./showerPlacement.js";

// Manual design keeps structural/data validation, while approximate usability
// checks remain visible advice. Automatic furniture placement stays strict.
export function manualDesignChecks(document, outlineIssue = null) {
  if (!document) return { errors: [], warnings: [] };
  return {
    errors: [...(outlineIssue ? [outlineIssue] : []), ...problems(document)],
    warnings: showerProblems(document).map((issue) => ({
      ...issue,
      severity: "warning",
    })),
  };
}

export function feedbackKey(text) {
  return text.trim().replace(/[。.;；]+$/u, "");
}
