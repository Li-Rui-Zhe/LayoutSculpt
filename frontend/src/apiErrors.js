// 兼容尚未更新的本地服务，避免把校验库堆栈直接展示给用户。
export function apiErrorMessage(detail, status) {
  if (typeof detail === "string") {
    if (
      /validation error.*JobOptions[\s\S]*style[\s\S]*input_value=['"]custom['"]/i.test(
        detail,
      )
    ) {
      return "当前后端版本尚不支持自定义风格，请重启本项目前后端后重试。已填写的内容仍保留。";
    }
    if (/errors\.pydantic\.dev|\[type=\w+.*input_value=/s.test(detail)) {
      return "提交的参数不符合要求，请检查填写内容后重试。已填写的内容仍保留。";
    }
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail.map((entry) => {
      const message =
        typeof entry?.msg === "string"
          ? entry.msg.replace(/^Value error, /, "")
          : "";
      return /[\u4e00-\u9fff]/.test(message)
        ? message
        : "提交的参数不符合要求，请检查填写内容后重试。";
    });
    if (messages.length) return [...new Set(messages)].join("；");
  }
  return `请求失败（${status}），请检查本地服务是否启动。`;
}
