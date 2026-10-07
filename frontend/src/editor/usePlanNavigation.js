import { useEffect, useRef, useState } from "react";
import { zoomPlan, panPlan } from "./planNavigation.js";

export function usePlanNavigation(svg, box, active, canNavigate) {
  const [view, setView] = useState({ zoom: 1, center: null });
  const [panMode, setPanMode] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const currentView = useRef(view),
    latest = useRef(null),
    gesture = useRef(null),
    space = useRef(false),
    hovering = useRef(false);
  latest.current = { box, active, canNavigate };
  const updateView = (next) => {
    currentView.current = next;
    setView(next);
  };
  const reset = () => updateView({ zoom: 1, center: null });
  const zoomBy = (factor, anchor = null) => {
    if (!latest.current.box || gesture.current || !latest.current.canNavigate())
      return;
    updateView(
      zoomPlan(currentView.current, latest.current.box, factor, anchor),
    );
  };
  const finishPan = (event, cancel = false) => {
    const started = gesture.current;
    if (!started || (event && event.pointerId !== started.pointerId))
      return false;
    gesture.current = null;
    if (cancel) updateView(started.view);
    setPanning(false);
    if (svg.current?.hasPointerCapture(started.pointerId))
      svg.current.releasePointerCapture(started.pointerId);
    return true;
  };
  const beginPan = (event) => {
    if (
      !latest.current.active ||
      !latest.current.box ||
      !latest.current.canNavigate() ||
      gesture.current
    )
      return;
    const matrix = svg.current?.getScreenCTM()?.inverse();
    if (!matrix) return;
    event.preventDefault();
    event.stopPropagation();
    svg.current.focus({ preventScroll: true });
    const fit = latest.current.box,
      value = currentView.current;
    gesture.current = {
      pointerId: event.pointerId,
      matrix,
      view: value,
      center: value.center || {
        x: fit.x + fit.width / 2,
        y: fit.y + fit.height / 2,
      },
      origin: new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix,
      ),
    };
    svg.current.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const movePan = (event) => {
    if (!gesture.current) return false;
    if (event.pointerId === gesture.current.pointerId) {
      const started = gesture.current;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        started.matrix,
      );
      updateView({
        zoom: started.view.zoom,
        center: panPlan(started.center, started.origin, point),
      });
    }
    return true;
  };
  useEffect(() => {
    const element = svg.current;
    if (!element || !box || !active) return;
    const wheel = (event) => {
      event.preventDefault();
      if (!latest.current.canNavigate() || gesture.current) return;
      const matrix = element.getScreenCTM()?.inverse();
      if (!matrix) return;
      const pixels =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      zoomBy(
        Math.exp(-Math.max(-0.6, Math.min(0.6, pixels * 0.0018))),
        new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix),
      );
    };
    const editable = (target) =>
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
      target.isContentEditable;
    const down = (event) => {
      if (editable(event.target)) return;
      const focused = element.contains(event.target);
      if (event.code === "Space" && (focused || hovering.current)) {
        event.preventDefault();
        space.current = true;
        setSpaceHeld(true);
      }
      if (!focused || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!latest.current.canNavigate()) return;
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") {
          finishPan(null, true);
          reset();
        } else zoomBy(event.key === "-" ? 1 / 1.2 : 1.2);
      }
    };
    const up = (event) => {
      if (event.code === "Space") {
        space.current = false;
        setSpaceHeld(false);
      }
    };
    const blur = () => {
      space.current = false;
      hovering.current = false;
      setSpaceHeld(false);
      finishPan(null, true);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, [!!box, active]);
  return {
    zoom: view.zoom,
    focusPoint: view.center,
    panMode,
    spaceHeld,
    panning,
    zoomBy,
    reset,
    beginPan,
    movePan,
    finishPan,
    focus: (center, zoom) => updateView({ center, zoom }),
    setPanMode,
    onPointerEnter: () => {
      hovering.current = true;
    },
    onPointerLeave: () => {
      hovering.current = false;
    },
    onPointerDownCapture: (event) => {
      if (
        event.button === 1 ||
        (event.button === 0 && (panMode || space.current))
      )
        beginPan(event);
    },
  };
}
