export function surfaceHistory(state, action) {
  if (action.type === "reset")
    return { ...state, past: [], future: [], time: 0 };
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return {
      present: state.past.at(-1),
      past: state.past.slice(0, -1),
      future: [state.present, ...state.future],
      time: 0,
    };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return {
      present: state.future[0],
      past: [...state.past, state.present],
      future: state.future.slice(1),
      time: 0,
    };
  }
  const next =
    typeof action.value === "function"
      ? action.value(state.present)
      : action.value;
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  const coalesce =
    !!action.group &&
    state.group === action.group &&
    state.past.length > 0 &&
    state.time > 0 &&
    action.time - state.time < 450 &&
    action.time >= state.time;
  return {
    present: next,
    past: coalesce ? state.past : [...state.past, state.present].slice(-40),
    future: [],
    time: action.time,
    group: action.group,
  };
}

export function surfacePixelKey(draft) {
  return JSON.stringify({
    category: draft.category,
    base_id: draft.base_id,
    color: draft.color,
    repeat: draft.repeat,
    rotation: draft.rotation,
  });
}
