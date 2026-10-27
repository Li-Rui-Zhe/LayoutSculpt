import { useCallback, useEffect, useReducer, useRef } from "react";
import { progressLifecycle } from "./progressLifecycle.js";
import { PROGRESS_HOLD_MS, PROGRESS_FADE_MS } from "./progressMotion.js";

export function useProgressLifecycle({
  active,
  failed = false,
  cancelled = false,
  operationKey,
  delay = 700,
}) {
  const [state, dispatch] = useReducer(progressLifecycle, {
    run: 0,
    phase: "idle",
  });
  const previousKey = useRef(operationKey);
  useEffect(() => {
    const changed = previousKey.current !== operationKey;
    previousKey.current = operationKey;
    dispatch({
      type:
        failed || cancelled || (changed && !active)
          ? "stop"
          : active
            ? "start"
            : "success",
    });
  }, [!!active, !!failed, !!cancelled, operationKey]);
  useEffect(() => {
    const duration =
      state.phase === "waiting"
        ? delay
        : state.phase === "settled"
          ? PROGRESS_HOLD_MS + PROGRESS_FADE_MS
          : null;
    if (duration === null) return;
    const timer = setTimeout(
      () =>
        dispatch({
          type: state.phase === "waiting" ? "show" : "stop",
          run: state.run,
        }),
      duration,
    );
    return () => clearTimeout(timer);
  }, [state.phase, state.run, delay]);
  const settle = useCallback(
    () => dispatch({ type: "settle", run: state.run }),
    [state.run],
  );
  return {
    ...state,
    visible:
      !failed &&
      !cancelled &&
      ["running", "finishing", "settled"].includes(state.phase),
    complete: ["finishing", "settled"].includes(state.phase),
    settle,
  };
}
