import { surfaceProfile } from "../materials/surfaces.js";

export default function MaterialSample({ material, className = "" }) {
  const profile = surfaceProfile(material, material.type);
  return (
    <span
      className={`surface-sample ${className}`}
      aria-hidden="true"
      style={{
        "--swatch": material.color,
        "--surface-image": profile?.surface
          ? profile.surface.startsWith("texture:")
            ? `url(/api/materials/custom/${profile.surface.slice(8)}.png)`
            : `url(/materials/${profile.surface}_color.png)`
          : "none",
      }}
    >
      {material.scheme && (
        <span className="surface-palette">
          {["upholstery", "accent", "curtain", "rug"].map((role) => (
            <i key={role} style={{ background: material.scheme[role].color }} />
          ))}
        </span>
      )}
    </span>
  );
}
