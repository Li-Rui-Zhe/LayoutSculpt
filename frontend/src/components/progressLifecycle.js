// 每次操作独立记录；失败、取消和迟到的完成回调均不能触发“成功”。
export function progressLifecycle(state, event) {
  if (event.type === "start") return { run: state.run + 1, phase: "waiting" };
  if (event.run != null && event.run !== state.run) return state;
  if (event.type === "stop") return { ...state, phase: "idle" };
  if (event.type === "show" && state.phase === "waiting")
    return { ...state, phase: "running" };
  if (event.type === "success")
    return {
      ...state,
      phase:
        state.phase === "running"
          ? "finishing"
          : ["finishing", "settled"].includes(state.phase)
            ? state.phase
            : "idle",
    };
  if (event.type === "settle" && state.phase === "finishing")
    return { ...state, phase: "settled" };
  return state;
}
