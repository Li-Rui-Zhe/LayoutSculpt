import { useMemo } from "react";
import { sameArchitecture, deriveOutline } from "./autoOutline.js";
import { manualDesignChecks, feedbackKey } from "./manualValidation.js";
import { useDesignCheck } from "./useDesignCheck.js";

// 检查仅依赖落定后的草稿；拖动预览、视角和选中状态不重跑全屋检查。
export function useEditorValidation({
  document,
  base,
  active,
  reviewing,
  error,
  storageError,
}) {
  const outlineIssue = useMemo(
    () =>
      !document || !base || sameArchitecture(document.layout, base.layout)
        ? null
        : deriveOutline(document.layout).issue,
    [document, base],
  );
  const { errors: issues, warnings: placementWarnings } = useMemo(
    () => manualDesignChecks(document, outlineIssue),
    [document, outlineIssue],
  );
  const serverCheck = useDesignCheck(
    document,
    active && !reviewing && !issues.length,
  );
  const feedback = useMemo(() => {
    const texts = new Set(
      [...issues, ...placementWarnings].map((issue) => feedbackKey(issue.text)),
    );
    const detailError =
      error && error !== storageError && !texts.has(feedbackKey(error))
        ? error
        : "";
    if (error) texts.add(feedbackKey(error));
    if (storageError) texts.add(feedbackKey(storageError));
    const feedbackSuggestions = serverCheck.issues.filter((issue) => {
      const key = feedbackKey(issue.text);
      if (texts.has(key)) return false;
      texts.add(key);
      return true;
    });
    return {
      detailError,
      feedbackSuggestions,
      adviceCount: placementWarnings.length + feedbackSuggestions.length,
      hasFeedback: !!(
        issues.length ||
        placementWarnings.length ||
        serverCheck.issues.length ||
        error ||
        storageError
      ),
    };
  }, [issues, placementWarnings, serverCheck.issues, error, storageError]);
  return { issues, placementWarnings, serverCheck, ...feedback };
}
