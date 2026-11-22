import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export default function WorkspaceSidebar({
  label,
  compactToggle,
  className = "",
  children,
  ...props
}) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={`workspace-sidebar ${className}`}
      aria-label={label}
      {...props}
    >
      {compactToggle ? (
        <>
          <button
            type="button"
            className="sidebar-compact-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded(!expanded)}
          >
            {compactToggle}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div
            id={panelId}
            className="sidebar-compact-body"
            data-expanded={expanded}
          >
            {children}
          </div>
        </>
      ) : (
        children
      )}
    </aside>
  );
}
