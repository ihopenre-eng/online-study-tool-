"use client";

import {
  ChevronDown,
  CircleDot,
  Eraser,
  Focus,
  GripVertical,
  Highlighter,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Palette,
  PenLine,
  Redo2,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type Tool = "pointer" | "pen" | "highlighter" | "laser" | "eraser";
type InkTool = "pen" | "highlighter";
type StrokeTool = "pen" | "highlighter" | "eraser";
type PopoverName = "color" | "width" | "settings" | null;
type DockEdge = "top" | "right" | "bottom" | "left" | null;

type Point = { x: number; y: number };
type Stroke = {
  tool: StrokeTool;
  points: Point[];
  color: string;
  width: number;
};

const COLORS = [
  { name: "오션 블루", value: "#0A84FF" },
  { name: "코랄 레드", value: "#FF453A" },
  { name: "선샤인 옐로", value: "#FFD60A" },
  { name: "민트 그린", value: "#30D158" },
  { name: "화이트", value: "#FFFFFF" },
  { name: "잉크 블랙", value: "#1C1C1E" },
] as const;

const TOOL_LABELS: Record<Tool, string> = {
  pointer: "포인터",
  pen: "펜",
  highlighter: "형광펜",
  laser: "레이저",
  eraser: "지우개",
};

const TOOL_SHORTCUTS: Partial<Record<Tool, string>> = {
  pointer: "V",
  pen: "P",
  highlighter: "H",
  laser: "L",
  eraser: "E",
};

const WIDTH_OPTIONS: Record<StrokeTool, number[]> = {
  pen: [2, 4, 7, 10],
  highlighter: [10, 16, 24, 32],
  eraser: [14, 24, 40, 64],
};

const WIDTH_LABELS = ["얇게", "보통", "굵게", "아주 굵게"];
const VIEWPORT_GUTTER = 14;
const SNAP_THRESHOLD = 56;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function ActiveToolIcon({ tool }: { tool: Tool }) {
  switch (tool) {
    case "pointer":
      return <MousePointer2 />;
    case "pen":
      return <PenLine />;
    case "highlighter":
      return <Highlighter />;
    case "laser":
      return <Focus />;
    case "eraser":
      return <Eraser />;
  }
}

type ToolButtonProps = {
  label: string;
  shortcut?: string;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
  colorIndicator?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
};

function ToolButton({
  label,
  shortcut,
  selected,
  disabled,
  danger,
  className = "",
  colorIndicator,
  ariaExpanded,
  ariaControls,
  onClick,
  children,
}: ToolButtonProps) {
  const accessibleLabel = shortcut ? `${label}, 단축키 ${shortcut}` : label;

  return (
    <button
      type="button"
      className={`tool-button ${danger ? "tool-button--danger" : ""} ${className}`}
      aria-label={accessibleLabel}
      aria-pressed={selected}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      data-state={selected ? "selected" : "idle"}
      onClick={onClick}
    >
      {children}
      {colorIndicator ? (
        <span
          className="color-indicator"
          style={{ backgroundColor: colorIndicator }}
          aria-hidden="true"
        />
      ) : null}
      <span className="tooltip" aria-hidden="true">
        {label}
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </span>
    </button>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const laserRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverAnchorRef = useRef<HTMLButtonElement | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const laserTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const lastClearedRef = useRef<Stroke[] | null>(null);
  const redoClearRef = useRef(false);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);

  const dragRef = useRef({
    pointerId: -1,
    originX: 0,
    originY: 0,
    startX: 0,
    startY: 0,
    moved: false,
  });
  const suppressCollapseClickRef = useRef(false);

  const [activeTool, setActiveTool] = useState<Tool>("pen");
  const [colors, setColors] = useState<Record<InkTool, string>>({
    pen: "#0A84FF",
    highlighter: "#FFD60A",
  });
  const [widths, setWidths] = useState<Record<StrokeTool, number>>({
    pen: 4,
    highlighter: 16,
    eraser: 24,
  });
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [popover, setPopover] = useState<PopoverName>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [idle, setIdle] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [dockEdge, setDockEdge] = useState<DockEdge>("bottom");
  const [positioned, setPositioned] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [toolbarSize, setToolbarSize] = useState({ width: 520, height: 60 });
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [toolbarTheme, setToolbarTheme] = useState<"dark" | "light">("dark");
  const [sceneTheme, setSceneTheme] = useState<"light" | "dark">("light");
  const [glassEnabled, setGlassEnabled] = useState(true);
  const [announcement, setAnnouncement] = useState("펜 도구 선택됨");

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      undo:
        strokesRef.current.length + (lastClearedRef.current?.length ? 1 : 0),
      redo: redoRef.current.length + (redoClearRef.current ? 1 : 0),
    });
  }, []);

  const drawStroke = useCallback((context: CanvasRenderingContext2D, stroke: Stroke) => {
    if (!stroke.points.length) return;

    context.save();
    context.globalCompositeOperation =
      stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.globalAlpha = stroke.tool === "highlighter" ? 0.36 : 1;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let index = 1; index < stroke.points.length - 1; index += 1) {
        const point = stroke.points[index];
        const next = stroke.points[index + 1];
        const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
        context.quadraticCurveTo(point.x, point.y, midpoint.x, midpoint.y);
      }
      const lastPoint = stroke.points[stroke.points.length - 1];
      context.lineTo(lastPoint.x, lastPoint.y);
      context.stroke();
    }

    context.restore();
  }, []);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    strokesRef.current.forEach((stroke) => drawStroke(context, stroke));
  }, [drawStroke]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const nextWidth = Math.round(rect.width * ratio);
    const nextHeight = Math.round(rect.height * ratio);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      redrawCanvas();
    }
  }, [redrawCanvas]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  const updateLaser = useCallback((x: number, y: number, pressed: boolean) => {
    const laser = laserRef.current;
    if (!laser) return;
    laser.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    laser.classList.add("is-visible");
    laser.classList.toggle("is-pressed", pressed);

    if (pressed) {
      laser.classList.remove("is-pulsing");
      void laser.offsetWidth;
      laser.classList.add("is-pulsing");
    }
  }, []);

  const hideLaser = useCallback((delay = 0) => {
    if (laserTimerRef.current) clearTimeout(laserTimerRef.current);
    laserTimerRef.current = setTimeout(() => {
      const laser = laserRef.current;
      laser?.classList.remove("is-visible", "is-pressed", "is-pulsing");
    }, delay);
  }, []);

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    };
  }, []);

  const renderLiveSegment = useCallback(
    (stroke: Stroke, from: Point, to: Point) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const ratio = window.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.save();
      context.globalCompositeOperation =
        stroke.tool === "eraser" ? "destination-out" : "source-over";
      context.globalAlpha = stroke.tool === "highlighter" ? 0.36 : 1;
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.restore();
    },
    [],
  );

  const finishStroke = useCallback(
    (commit: boolean) => {
      const stroke = activeStrokeRef.current;
      if (stroke && commit) {
        strokesRef.current.push(stroke);
        redoRef.current = [];
        lastClearedRef.current = null;
        redoClearRef.current = false;
        redrawCanvas();
      } else if (stroke) {
        redrawCanvas();
      }
      activeStrokeRef.current = null;
      activePointerRef.current = null;
      syncHistoryState();
    },
    [redrawCanvas, syncHistoryState],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activeTool === "pointer") return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointerRef.current = event.pointerId;

      if (activeTool === "laser") {
        updateLaser(event.clientX, event.clientY, true);
        return;
      }

      const tool = activeTool as StrokeTool;
      const point = getCanvasPoint(event.clientX, event.clientY);
      const color = tool === "eraser" ? "#000000" : colors[tool as InkTool];
      const stroke: Stroke = {
        tool,
        points: [point],
        color,
        width: widths[tool],
      };
      activeStrokeRef.current = stroke;
      renderLiveSegment(stroke, point, { x: point.x + 0.01, y: point.y + 0.01 });
    },
    [activeTool, colors, getCanvasPoint, renderLiveSegment, updateLaser, widths],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activeTool === "laser") {
        updateLaser(
          event.clientX,
          event.clientY,
          activePointerRef.current === event.pointerId,
        );
      }

      if (activePointerRef.current !== event.pointerId || activeTool === "laser") return;
      const stroke = activeStrokeRef.current;
      if (!stroke) return;

      const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
      events.forEach((pointerEvent) => {
        const next = getCanvasPoint(pointerEvent.clientX, pointerEvent.clientY);
        const previous = stroke.points[stroke.points.length - 1];
        if (Math.hypot(next.x - previous.x, next.y - previous.y) < 0.35) return;
        stroke.points.push(next);
        renderLiveSegment(stroke, previous, next);
      });
    },
    [activeTool, getCanvasPoint, renderLiveSegment, updateLaser],
  );

  const handleCanvasPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      if (activeTool === "laser") {
        activePointerRef.current = null;
        updateLaser(event.clientX, event.clientY, false);
        hideLaser(220);
      } else {
        finishStroke(true);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [activeTool, finishStroke, hideLaser, updateLaser],
  );

  const handleCanvasPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      if (activeTool === "laser") {
        activePointerRef.current = null;
        hideLaser();
      } else {
        finishStroke(false);
      }
    },
    [activeTool, finishStroke, hideLaser],
  );

  const selectTool = useCallback(
    (tool: Tool) => {
      if (activeStrokeRef.current) finishStroke(true);
      setActiveTool(tool);
      setPopover(null);
      if (tool !== "laser") hideLaser();
      setAnnouncement(`${TOOL_LABELS[tool]} 도구 선택됨`);
    },
    [finishStroke, hideLaser],
  );

  const undo = useCallback(() => {
    if (strokesRef.current.length) {
      const stroke = strokesRef.current.pop();
      if (stroke) redoRef.current.push(stroke);
    } else if (lastClearedRef.current?.length) {
      strokesRef.current = lastClearedRef.current;
      lastClearedRef.current = null;
      redoClearRef.current = true;
    } else {
      return;
    }
    redrawCanvas();
    syncHistoryState();
    setAnnouncement("마지막 작업을 되돌렸습니다");
  }, [redrawCanvas, syncHistoryState]);

  const redo = useCallback(() => {
    if (redoClearRef.current) {
      lastClearedRef.current = strokesRef.current;
      strokesRef.current = [];
      redoClearRef.current = false;
    } else {
      const stroke = redoRef.current.pop();
      if (!stroke) return;
      strokesRef.current.push(stroke);
    }
    redrawCanvas();
    syncHistoryState();
    setAnnouncement("작업을 다시 적용했습니다");
  }, [redrawCanvas, syncHistoryState]);

  const clearCanvas = useCallback(() => {
    if (!strokesRef.current.length) return;
    lastClearedRef.current = strokesRef.current;
    strokesRef.current = [];
    redoRef.current = [];
    redoClearRef.current = false;
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    hideLaser();
    redrawCanvas();
    syncHistoryState();
    setAnnouncement("모든 주석을 지웠습니다. 실행 취소로 복원할 수 있습니다");
    setPopover(null);
  }, [hideLaser, redrawCanvas, syncHistoryState]);

  const closePopover = useCallback((restoreFocus = false) => {
    setPopover(null);
    if (restoreFocus) requestAnimationFrame(() => popoverAnchorRef.current?.focus());
  }, []);

  const togglePopover = useCallback(
    (name: Exclude<PopoverName, null>, event: React.MouseEvent<HTMLButtonElement>) => {
      popoverAnchorRef.current = event.currentTarget;
      setPopover((current) => (current === name ? null : name));
      setIdle(false);
    },
    [],
  );

  useEffect(() => {
    if (!popover) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || toolbarRef.current?.contains(target)) return;
      closePopover();
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [closePopover, popover]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (event.key === "Escape" && popover) {
        event.preventDefault();
        closePopover(true);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      const toolByKey: Record<string, Tool> = {
        v: "pointer",
        p: "pen",
        h: "highlighter",
        l: "laser",
        e: "eraser",
      };
      const nextTool = toolByKey[event.key.toLowerCase()];
      if (nextTool && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        selectTool(nextTool);
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [closePopover, popover, redo, selectTool, undo]);

  const wakeToolbar = useCallback(() => {
    setIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (!dragging && !popover) setIdle(true);
    }, 2800);
  }, [dragging, popover]);

  useEffect(() => {
    let lastPointerActivity = 0;
    const handleActivity = (event: Event) => {
      const now = Date.now();
      if (event.type === "pointermove" && now - lastPointerActivity < 420) return;
      lastPointerActivity = now;
      wakeToolbar();
    };
    window.addEventListener("pointermove", handleActivity, { passive: true });
    window.addEventListener("pointerdown", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("focus", handleActivity);
    wakeToolbar();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener("pointermove", handleActivity);
      window.removeEventListener("pointerdown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("focus", handleActivity);
    };
  }, [wakeToolbar]);

  const measureAndPlaceToolbar = useCallback(
    (initial = false) => {
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      const rect = toolbar.getBoundingClientRect();
      const size = { width: rect.width, height: rect.height };
      setToolbarSize(size);
      setPosition((current) => {
        if (initial || !positioned) {
          return {
            x: Math.round((window.innerWidth - size.width) / 2),
            y: Math.round(window.innerHeight - size.height - 24),
          };
        }
        let x = clamp(
          current.x,
          VIEWPORT_GUTTER,
          window.innerWidth - size.width - VIEWPORT_GUTTER,
        );
        let y = clamp(
          current.y,
          VIEWPORT_GUTTER,
          window.innerHeight - size.height - VIEWPORT_GUTTER,
        );
        if (dockEdge === "left") x = VIEWPORT_GUTTER;
        if (dockEdge === "right") x = window.innerWidth - size.width - VIEWPORT_GUTTER;
        if (dockEdge === "top") y = VIEWPORT_GUTTER;
        if (dockEdge === "bottom") y = window.innerHeight - size.height - VIEWPORT_GUTTER;
        return { x, y };
      });
      setPositioned(true);
    },
    [dockEdge, positioned],
  );

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => measureAndPlaceToolbar(!positioned));
    return () => cancelAnimationFrame(frame);
  }, [collapsed, measureAndPlaceToolbar, positioned]);

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      measureAndPlaceToolbar(false);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [measureAndPlaceToolbar]);

  const snapToolbar = useCallback(
    (nextPosition: { x: number; y: number }) => {
      const maxX = window.innerWidth - toolbarSize.width - VIEWPORT_GUTTER;
      const maxY = window.innerHeight - toolbarSize.height - VIEWPORT_GUTTER;
      const clamped = {
        x: clamp(nextPosition.x, VIEWPORT_GUTTER, maxX),
        y: clamp(nextPosition.y, VIEWPORT_GUTTER, maxY),
      };
      const distances: Array<{ edge: Exclude<DockEdge, null>; distance: number }> = [
        { edge: "left", distance: Math.abs(clamped.x - VIEWPORT_GUTTER) },
        { edge: "right", distance: Math.abs(maxX - clamped.x) },
        { edge: "top", distance: Math.abs(clamped.y - VIEWPORT_GUTTER) },
        { edge: "bottom", distance: Math.abs(maxY - clamped.y) },
      ];
      distances.sort((a, b) => a.distance - b.distance);
      const nearest = distances[0];
      let snapped = clamped;
      let edge: DockEdge = null;
      if (nearest.distance <= SNAP_THRESHOLD) {
        edge = nearest.edge;
        if (edge === "left") snapped = { ...clamped, x: VIEWPORT_GUTTER };
        if (edge === "right") snapped = { ...clamped, x: maxX };
        if (edge === "top") snapped = { ...clamped, y: VIEWPORT_GUTTER };
        if (edge === "bottom") snapped = { ...clamped, y: maxY };
      }
      setDockEdge(edge);
      setSnapping(true);
      setPosition(snapped);
      window.setTimeout(() => setSnapping(false), 190);
    },
    [toolbarSize.height, toolbarSize.width],
  );

  const handleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
        moved: false,
      };
      setDragging(true);
      setDockEdge(null);
      setPopover(null);
      setIdle(false);
    },
    [position.x, position.y],
  );

  const handleDragMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) > 4) drag.moved = true;
      if (!drag.moved) return;
      setPosition({
        x: clamp(
          drag.originX + deltaX,
          VIEWPORT_GUTTER,
          window.innerWidth - toolbarSize.width - VIEWPORT_GUTTER,
        ),
        y: clamp(
          drag.originY + deltaY,
          VIEWPORT_GUTTER,
          window.innerHeight - toolbarSize.height - VIEWPORT_GUTTER,
        ),
      });
    },
    [toolbarSize.height, toolbarSize.width],
  );

  const handleDragEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      setDragging(false);
      if (drag.moved) {
        const next = {
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        };
        snapToolbar(next);
        suppressCollapseClickRef.current = true;
        window.setTimeout(() => {
          suppressCollapseClickRef.current = false;
        }, 0);
      }
      dragRef.current.pointerId = -1;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      wakeToolbar();
    },
    [snapToolbar, wakeToolbar],
  );

  const handleHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const directions: Record<string, Point> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const direction = directions[event.key];
      if (!event.altKey || !direction) return;
      event.preventDefault();
      if (event.shiftKey) {
        const edge: Exclude<DockEdge, null> =
          direction.x < 0
            ? "left"
            : direction.x > 0
              ? "right"
              : direction.y < 0
                ? "top"
                : "bottom";
        const maxX = window.innerWidth - toolbarSize.width - VIEWPORT_GUTTER;
        const maxY = window.innerHeight - toolbarSize.height - VIEWPORT_GUTTER;
        setDockEdge(edge);
        setPosition((current) => ({
          x: edge === "left" ? VIEWPORT_GUTTER : edge === "right" ? maxX : current.x,
          y: edge === "top" ? VIEWPORT_GUTTER : edge === "bottom" ? maxY : current.y,
        }));
      } else {
        setDockEdge(null);
        setPosition((current) => ({
          x: clamp(
            current.x + direction.x * 8,
            VIEWPORT_GUTTER,
            window.innerWidth - toolbarSize.width - VIEWPORT_GUTTER,
          ),
          y: clamp(
            current.y + direction.y * 8,
            VIEWPORT_GUTTER,
            window.innerHeight - toolbarSize.height - VIEWPORT_GUTTER,
          ),
        }));
      }
    },
    [toolbarSize.height, toolbarSize.width],
  );

  const setCollapsedSafely = useCallback((next: boolean) => {
    setPopover(null);
    setIdle(false);
    setCollapsed(next);
    setAnnouncement(next ? "툴바를 접었습니다" : "툴바를 펼쳤습니다");
  }, []);

  const inkTool = activeTool === "pen" || activeTool === "highlighter" ? activeTool : null;
  const widthTool =
    activeTool === "pen" || activeTool === "highlighter" || activeTool === "eraser"
      ? activeTool
      : null;
  const canUndo = historyState.undo > 0;
  const canRedo = historyState.redo > 0;
  const canClear = strokesRef.current.length > 0;

  const popoverDimensions =
    popover === "settings"
      ? { width: 286, height: 320 }
      : popover === "width"
        ? { width: 250, height: 232 }
        : { width: 250, height: 144 };
  const popoverAbove =
    position.y > popoverDimensions.height + VIEWPORT_GUTTER + 16;
  const popoverLeft = clamp(
    position.x + toolbarSize.width / 2 - popoverDimensions.width / 2,
    VIEWPORT_GUTTER,
    viewport.width - popoverDimensions.width - VIEWPORT_GUTTER,
  );
  const popoverTop = popoverAbove
    ? position.y - popoverDimensions.height - 10
    : position.y + toolbarSize.height + 10;
  const popoverStyle = {
    left: popoverLeft,
    top: clamp(
      popoverTop,
      VIEWPORT_GUTTER,
      viewport.height - popoverDimensions.height - VIEWPORT_GUTTER,
    ),
    width: popoverDimensions.width,
    "--popover-origin-x": `${clamp(
      position.x + toolbarSize.width / 2 - popoverLeft,
      24,
      popoverDimensions.width - 24,
    )}px`,
    "--popover-origin-y": popoverAbove ? "100%" : "0%",
  } as CSSProperties;

  const toolbarClassName = [
    "floating-toolbar",
    collapsed ? "is-collapsed" : "is-expanded",
    idle && !dragging && !popover ? "is-idle" : "",
    dragging ? "is-dragging" : "",
    snapping ? "is-snapping" : "",
    glassEnabled ? "has-glass" : "no-glass",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={`annotation-app scene-${sceneTheme}`}>
      <section className="shared-stage" aria-label="수업 화면 미리보기">
        <header className="screen-header">
          <div className="class-context">
            <span className="brand-mark" aria-hidden="true">
              <Sparkles />
            </span>
            <div>
              <strong>Concept Board</strong>
              <span>경제와 사회 · 4교시</span>
            </div>
          </div>
          <div className="share-status">
            <span className="live-dot" aria-hidden="true" />
            화면 공유 중
          </div>
        </header>

        <div className="presentation-frame">
          <aside className="slide-rail" aria-label="슬라이드 목록">
            <span className="rail-title">오늘의 수업</span>
            <button type="button" className="slide-thumb is-current" aria-label="슬라이드 1, 현재 페이지">
              <span>01</span>
              <i />
              <i />
            </button>
            <button type="button" className="slide-thumb" aria-label="슬라이드 2">
              <span>02</span>
              <i />
              <i />
            </button>
            <button type="button" className="slide-thumb" aria-label="슬라이드 3">
              <span>03</span>
              <i />
              <i />
            </button>
          </aside>

          <article className="lesson-slide">
            <div className="slide-copy">
              <div className="chapter-label">CHAPTER 04 · MARKET DYNAMICS</div>
              <h1>
                가격이 오르면,
                <br />
                <em>수요는 어떻게 변할까?</em>
              </h1>
              <p>
                다른 조건이 같을 때 가격과 수요량은 반대 방향으로 움직입니다.
                핵심 구간을 직접 표시하며 설명해 보세요.
              </p>
              <div className="concept-tags" aria-label="핵심 개념">
                <span>가격 상승</span>
                <b aria-hidden="true">→</b>
                <span>수요량 감소</span>
              </div>
            </div>

            <div className="chart-card" aria-label="가격과 수요량 관계 예시 차트">
              <div className="chart-meta">
                <span>수요 곡선</span>
                <strong>D</strong>
              </div>
              <div className="chart-area" aria-hidden="true">
                <span className="axis axis-y" />
                <span className="axis axis-x" />
                <span className="grid-line grid-one" />
                <span className="grid-line grid-two" />
                <span className="demand-line" />
                <span className="chart-point point-a"><i>A</i></span>
                <span className="chart-point point-b"><i>B</i></span>
                <small className="axis-label label-price">가격</small>
                <small className="axis-label label-demand">수요량</small>
              </div>
              <div className="chart-note">
                <CircleDot />
                <span>펜으로 A와 B를 연결해 보세요</span>
              </div>
            </div>
          </article>
        </div>

        <div className="shortcut-strip" aria-hidden="true">
          <span><kbd>P</kbd> 펜</span>
          <span><kbd>H</kbd> 형광펜</span>
          <span><kbd>L</kbd> 레이저</span>
          <span><kbd>Ctrl Z</kbd> 실행 취소</span>
        </div>
      </section>

      <canvas
        ref={canvasRef}
        className={`drawing-canvas tool-${activeTool}`}
        aria-label="화면 주석 드로잉 영역"
        data-active-tool={activeTool}
        style={{ pointerEvents: activeTool === "pointer" ? "none" : "auto" }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerCancel}
        onPointerLeave={() => {
          if (activeTool === "laser" && activePointerRef.current === null) hideLaser();
        }}
      />

      <div ref={laserRef} className="laser-pointer" aria-hidden="true">
        <span className="laser-ring" />
        <span className="laser-core" />
      </div>

      <div
        ref={toolbarRef}
        className={toolbarClassName}
        role="toolbar"
        aria-label="화면 주석 도구"
        aria-orientation="horizontal"
        data-theme={toolbarTheme}
        data-dock-edge={dockEdge ?? "free"}
        data-state={collapsed ? "collapsed" : "expanded"}
        style={{
          left: position.x,
          top: position.y,
          visibility: positioned ? "visible" : "hidden",
        }}
        onPointerEnter={wakeToolbar}
        onFocusCapture={wakeToolbar}
      >
        {collapsed ? (
          <button
            type="button"
            className="collapsed-button"
            aria-label={`툴바 펼치기, 현재 ${TOOL_LABELS[activeTool]}`}
            aria-expanded="false"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            onKeyDown={handleHandleKeyDown}
            onClick={() => {
              if (!suppressCollapseClickRef.current) setCollapsedSafely(false);
            }}
          >
            <ActiveToolIcon tool={activeTool} />
            <span
              className="collapsed-indicator"
              style={{
                backgroundColor:
                  activeTool === "pen" || activeTool === "highlighter"
                    ? colors[activeTool]
                    : "#0A84FF",
              }}
              aria-hidden="true"
            />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="drag-handle"
              aria-label="툴바 이동, Alt와 방향키로 이동"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              onKeyDown={handleHandleKeyDown}
            >
              <GripVertical />
              <span className="tooltip" aria-hidden="true">이동</span>
            </button>

            <ToolButton
              label="실행 취소"
              shortcut="Ctrl Z"
              disabled={!canUndo}
              className="mobile-optional"
              onClick={undo}
            >
              <RotateCcw />
            </ToolButton>

            <span className="toolbar-separator mobile-optional" aria-hidden="true" />

            <ToolButton
              label="포인터"
              shortcut="V"
              selected={activeTool === "pointer"}
              onClick={() => selectTool("pointer")}
            >
              <MousePointer2 />
            </ToolButton>
            <ToolButton
              label="펜"
              shortcut="P"
              selected={activeTool === "pen"}
              colorIndicator={colors.pen}
              onClick={() => selectTool("pen")}
            >
              <PenLine />
            </ToolButton>
            <ToolButton
              label="형광펜"
              shortcut="H"
              selected={activeTool === "highlighter"}
              colorIndicator={colors.highlighter}
              onClick={() => selectTool("highlighter")}
            >
              <Highlighter />
            </ToolButton>
            <ToolButton
              label="레이저"
              shortcut="L"
              selected={activeTool === "laser"}
              onClick={() => selectTool("laser")}
            >
              <Focus />
            </ToolButton>
            <ToolButton
              label="지우개"
              shortcut="E"
              selected={activeTool === "eraser"}
              onClick={() => selectTool("eraser")}
            >
              <Eraser />
            </ToolButton>

            <span className="toolbar-separator mobile-optional" aria-hidden="true" />

            <ToolButton
              label={inkTool ? `${TOOL_LABELS[inkTool]} 색상` : "색상"}
              disabled={!inkTool}
              className="mobile-optional"
              colorIndicator={inkTool ? colors[inkTool] : undefined}
              ariaExpanded={popover === "color"}
              ariaControls="color-popover"
              onClick={(event) => togglePopover("color", event)}
            >
              <Palette />
            </ToolButton>
            <ToolButton
              label="굵기"
              disabled={!widthTool}
              className="mobile-optional"
              ariaExpanded={popover === "width"}
              ariaControls="width-popover"
              onClick={(event) => togglePopover("width", event)}
            >
              <Minus className="width-icon" />
            </ToolButton>
            <ToolButton
              label="모두 지우기"
              danger
              disabled={!canClear}
              className="mobile-optional"
              onClick={clearCanvas}
            >
              <Trash2 />
            </ToolButton>
            <ToolButton
              label="더보기"
              ariaExpanded={popover === "settings"}
              ariaControls="settings-popover"
              onClick={(event) => togglePopover("settings", event)}
            >
              <MoreHorizontal />
            </ToolButton>
            <ToolButton
              label="툴바 접기"
              onClick={() => setCollapsedSafely(true)}
            >
              <ChevronDown />
            </ToolButton>
          </>
        )}
      </div>

      {popover ? (
        <div
          ref={popoverRef}
          id={`${popover}-popover`}
          className={`floating-popover popover-${popover} ${glassEnabled ? "has-glass" : "no-glass"}`}
          data-theme={toolbarTheme}
          role="dialog"
          aria-label={
            popover === "color" ? "펜 색상" : popover === "width" ? "선 굵기" : "빠른 설정"
          }
          style={popoverStyle}
        >
          <div className="popover-header">
            <div>
              <strong>
                {popover === "color" ? "색상" : popover === "width" ? "굵기" : "빠른 설정"}
              </strong>
              <span>
                {popover === "color"
                  ? inkTool
                    ? `${TOOL_LABELS[inkTool]}에 바로 적용됩니다`
                    : "펜 또는 형광펜을 선택하세요"
                  : popover === "width"
                    ? widthTool
                      ? `${TOOL_LABELS[widthTool]} 선 미리보기`
                      : "도구를 선택하세요"
                    : "화면과 도구 표시를 조정합니다"}
              </span>
            </div>
            <button type="button" className="popover-close" aria-label="닫기" onClick={() => closePopover(true)}>
              <X />
            </button>
          </div>

          {popover === "color" && inkTool ? (
            <div className="swatch-grid" role="radiogroup" aria-label={`${TOOL_LABELS[inkTool]} 색상`}>
              {COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`color-swatch ${colors[inkTool] === color.value ? "is-selected" : ""}`}
                  role="radio"
                  aria-label={color.name}
                  aria-checked={colors[inkTool] === color.value}
                  title={color.name}
                  style={{ "--swatch": color.value } as CSSProperties}
                  onClick={() => {
                    setColors((current) => ({ ...current, [inkTool]: color.value }));
                    setAnnouncement(`${TOOL_LABELS[inkTool]} 색상을 ${color.name}(으)로 변경했습니다`);
                  }}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}

          {popover === "width" && widthTool ? (
            <div className="width-options" role="radiogroup" aria-label={`${TOOL_LABELS[widthTool]} 굵기`}>
              {WIDTH_OPTIONS[widthTool].map((width, index) => (
                <button
                  key={width}
                  type="button"
                  className={`width-option ${widths[widthTool] === width ? "is-selected" : ""}`}
                  role="radio"
                  aria-checked={widths[widthTool] === width}
                  aria-label={`${WIDTH_LABELS[index]}, ${width}픽셀`}
                  onClick={() => {
                    setWidths((current) => ({ ...current, [widthTool]: width }));
                    setAnnouncement(`${TOOL_LABELS[widthTool]} 굵기를 ${width}픽셀로 변경했습니다`);
                  }}
                >
                  <span>{WIDTH_LABELS[index]}</span>
                  <i style={{ height: Math.min(width, 12) }} aria-hidden="true" />
                  <small>{width}px</small>
                </button>
              ))}
            </div>
          ) : null}

          {popover === "settings" ? (
            <div className="settings-list">
              <div className="mobile-setting-tools" aria-label="모바일 빠른 도구">
                <button
                  type="button"
                  disabled={!inkTool}
                  onClick={(event) => togglePopover("color", event)}
                >
                  <Palette /> 색상
                </button>
                <button
                  type="button"
                  disabled={!widthTool}
                  onClick={(event) => togglePopover("width", event)}
                >
                  <Minus /> 굵기
                </button>
                <button type="button" disabled={!canUndo} onClick={undo}>
                  <RotateCcw /> 취소
                </button>
              </div>
              <button
                type="button"
                className="setting-row"
                role="switch"
                aria-checked={toolbarTheme === "light"}
                onClick={() => setToolbarTheme((current) => (current === "dark" ? "light" : "dark"))}
              >
                <span><strong>밝은 툴바</strong><small>밝은 패널 테마 사용</small></span>
                <i className={`switch ${toolbarTheme === "light" ? "is-on" : ""}`} aria-hidden="true"><b /></i>
              </button>
              <button
                type="button"
                className="setting-row"
                role="switch"
                aria-checked={sceneTheme === "dark"}
                onClick={() => setSceneTheme((current) => (current === "light" ? "dark" : "light"))}
              >
                <span><strong>어두운 화면</strong><small>배경 대비 확인</small></span>
                <i className={`switch ${sceneTheme === "dark" ? "is-on" : ""}`} aria-hidden="true"><b /></i>
              </button>
              <button
                type="button"
                className="setting-row"
                role="switch"
                aria-checked={glassEnabled}
                onClick={() => setGlassEnabled((current) => !current)}
              >
                <span><strong>글래스 효과</strong><small>블러와 투명도</small></span>
                <i className={`switch ${glassEnabled ? "is-on" : ""}`} aria-hidden="true"><b /></i>
              </button>
              <div className="settings-actions">
                <button type="button" disabled={!canRedo} onClick={redo}><Redo2 /> 다시 실행</button>
                <button type="button" className="danger-action" disabled={!canClear} onClick={clearCanvas}><Trash2 /> 모두 지우기</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </main>
  );
}
