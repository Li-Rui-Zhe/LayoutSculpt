// Keep geometry and lighting intact; reduce pixel work only during gestures.
export function interactionQuality({ apply, ratio = 1, delay = 220 }) {
  const full = Math.min(Math.max(ratio, 1), 2);
  const moving = Math.min(full, 1.25);
  let timer,
    current = full,
    closed = false;
  function set(value) {
    if (closed || current === value) return;
    current = value;
    apply(value);
  }
  return {
    start() {
      clearTimeout(timer);
      set(moving);
    },
    end() {
      clearTimeout(timer);
      timer = setTimeout(() => set(full), delay);
    },
    restore() {
      clearTimeout(timer);
      set(full);
    },
    close() {
      closed = true;
      clearTimeout(timer);
    },
  };
}
