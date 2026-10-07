export const MIN_PLAN_ZOOM = 0.5;
export const MAX_PLAN_ZOOM = 8;

export function zoomPlan(view, box, factor, anchor = null) {
  const zoom = Math.max(
    MIN_PLAN_ZOOM,
    Math.min(MAX_PLAN_ZOOM, view.zoom * factor),
  );
  if (zoom === view.zoom) return view;
  const center = view.center || {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const point = anchor || center;
  const ratio = view.zoom / zoom;
  return {
    zoom,
    center: {
      x: point.x + (center.x - point.x) * ratio,
      y: point.y + (center.y - point.y) * ratio,
    },
  };
}

export function panPlan(center, origin, point) {
  return { x: center.x + origin.x - point.x, y: center.y + origin.y - point.y };
}
