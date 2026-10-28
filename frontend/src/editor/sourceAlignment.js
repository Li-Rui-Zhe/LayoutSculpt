export function validSourceAlignment(value) {
  const boundaryValid = (points) =>
    points == null ||
    (Array.isArray(points) &&
      points.length <= 512 &&
      points.every(
        (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
      ));
  const findingsValid =
    value?.findings == null ||
    (Array.isArray(value.findings) &&
      value.findings.every(
        (f) =>
          f &&
          typeof f.message === "string" &&
          (f.box == null ||
            (Array.isArray(f.box) &&
              f.box.length === 4 &&
              f.box.every(Number.isFinite))),
      ));
  return (
    !!value &&
    Number.isFinite(value.meters_per_pixel) &&
    value.meters_per_pixel > 0 &&
    [value.image_width, value.image_height].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 4096,
    ) &&
    Array.isArray(value.origin_px) &&
    value.origin_px.length === 2 &&
    value.origin_px.every(Number.isFinite) &&
    boundaryValid(value.evidence_outline) &&
    boundaryValid(value.audit_outline) &&
    findingsValid
  );
}

export function sourcePixel(point, alignment) {
  if (
    !validSourceAlignment(alignment) ||
    ![point?.x, point?.y].every(Number.isFinite)
  )
    return null;
  return {
    x: point.x / alignment.meters_per_pixel + alignment.origin_px[0],
    y: point.y / alignment.meters_per_pixel + alignment.origin_px[1],
  };
}
