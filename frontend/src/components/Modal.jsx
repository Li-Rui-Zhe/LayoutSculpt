import { useEffect, useRef, useId } from "react";
import { X } from "lucide-react";

export default function Modal({
  title,
  children,
  onClose,
  className = "",
  focusTitle = false,
}) {
  const ref = useRef(null);
  const titleRef = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    element.showModal();
    titleRef.current?.focus({ preventScroll: true });
    const leave = () => close.current();
    window.addEventListener("hashchange", leave);
    window.addEventListener("popstate", leave);
    return () => {
      window.removeEventListener("hashchange", leave);
      window.removeEventListener("popstate", leave);
      element.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          (event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom)
        )
          onClose();
      }}
    >
      <div className="dialog-title">
        <h2
          id={titleId}
          ref={focusTitle ? titleRef : null}
          tabIndex={focusTitle ? -1 : undefined}
        >
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
