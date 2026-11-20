import { doorLeafSegments } from "../editor/geometry.js";

export default function DoorLeafLines({
  opening,
  wall,
  project,
  ...lineProps
}) {
  return doorLeafSegments(opening, wall).map((segment, index) => {
    const [hinge, tip] = project ? segment.map(project) : segment;
    return (
      <line
        key={index}
        x1={hinge.x}
        y1={hinge.y}
        x2={tip.x}
        y2={tip.y}
        {...lineProps}
      />
    );
  });
}
