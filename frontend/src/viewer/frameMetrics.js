// Opt-in local diagnostics. No network, user data, or persistent storage.
export function frameMetrics(canvas, enabled = false) {
  const frames = [],
    draws = [];
  let previous = null,
    published = 0,
    count = 0,
    longFrames = 0,
    worstFrame = 0;
  return {
    record(started, ended, interacting) {
      if (!enabled) return;
      if (!interacting) {
        previous = null;
        return;
      }
      if (previous !== null) {
        const interval = Math.max(0, started - previous);
        frames.push(interval);
        if (interval > 50) longFrames++;
        worstFrame = Math.max(worstFrame, interval);
      }
      draws.push(ended - started);
      previous = started;
      count++;
      if (frames.length > 600) frames.shift();
      if (draws.length > 600) draws.shift();
      if (ended - published < 300) return;
      published = ended;
      const percentile = (list, p) => {
        const values = [...list].sort((a, b) => a - b);
        return (
          Math.round(
            (values[Math.max(0, Math.ceil(values.length * p) - 1)] || 0) * 100,
          ) / 100
        );
      };
      canvas.dataset.frameMetrics = JSON.stringify({
        samples: count,
        longFrames,
        worstFrameMs: Math.round(worstFrame * 100) / 100,
        frameMedianMs: percentile(frames, 0.5),
        frameP95Ms: percentile(frames, 0.95),
        drawMedianMs: percentile(draws, 0.5),
        drawP95Ms: percentile(draws, 0.95),
      });
    },
  };
}
