import {
  ChevronDown,
  Eraser,
  Focus,
  GripVertical,
  Highlighter,
  Maximize2,
  Minimize2,
  Clock3,
  EyeOff,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Palette,
  PenLine,
  Play,
  Pause,
  Redo2,
  RotateCcw,
  Type as TextIcon,
  ZoomIn,
  Presentation,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Tool = "pointer" | "pen" | "highlighter" | "text" | "laser" | "eraser" | "magnifier";
type StrokeTool = "pen" | "highlighter" | "eraser";
type InkTool = "pen" | "highlighter";
type Popover = "color" | "width" | "settings" | null;
type Point = { x: number; y: number };
type Stroke = { tool: StrokeTool; points: Point[]; color: string; width: number; constrain?: boolean };
type TextAnnotation = { tool: "text"; x: number; y: number; text: string; color: string; fontSize: number; rotation?: number };
type ShapeAnnotation = { tool: "shape"; kind: "line" | "circle"; start: Point; end: Point; color: string; width: number };
type Annotation = Stroke | TextAnnotation | ShapeAnnotation;

const TOOL_LABEL: Record<Tool, string> = {
  pointer: "포인터",
  pen: "펜",
  highlighter: "형광펜",
  text: "텍스트",
  laser: "레이저",
  eraser: "지우개",
  magnifier: "화면 확대",
};

const COLORS = [
  ["스틸 블루", "#4778A8"],
  ["브릭 레드", "#B75A52"],
  ["오커", "#C69B43"],
  ["포레스트", "#4E8A68"],
  ["웜 화이트", "#F2F0EA"],
  ["차콜", "#22262C"],
] as const;

const WIDTHS: Record<StrokeTool, number[]> = {
  pen: [2, 4, 7, 10],
  highlighter: [10, 16, 24, 32],
  eraser: [14, 24, 40, 64],
};

const TEXT_SIZES = [18, 24, 32, 44];

const SHORTCUT: Partial<Record<Tool, string>> = {
  pointer: "Ctrl+Shift+1",
  pen: "Ctrl+Shift+2",
  highlighter: "Ctrl+Shift+3",
  text: "Ctrl+Shift+4",
  laser: "Ctrl+Shift+5",
  eraser: "Ctrl+Shift+6",
  magnifier: "Ctrl+Shift+7",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function strokeBounds(stroke: Stroke) {
  const xs = stroke.points.map((point) => point.x);
  const ys = stroke.points.map((point) => point.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

function recognizeAutoShape(stroke: Stroke): ShapeAnnotation | null {
  if (stroke.points.length < 5) return null;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const bounds = strokeBounds(stroke);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const diagonal = Math.hypot(width, height);
  if (diagonal < 38) return null;

  let pathLength = 0;
  for (let index = 1; index < stroke.points.length; index += 1) {
    pathLength += Math.hypot(stroke.points[index].x - stroke.points[index - 1].x, stroke.points[index].y - stroke.points[index - 1].y);
  }
  const directLength = Math.hypot(last.x - first.x, last.y - first.y);
  if (directLength > 42 && pathLength / directLength < 1.075) {
    return { tool: "shape", kind: "line", start: first, end: last, color: stroke.color, width: stroke.width };
  }

  const closed = directLength < Math.max(24, diagonal * .2);
  const aspect = width / Math.max(height, 1);
  if (!closed || aspect < .58 || aspect > 1.72 || stroke.points.length < 16) return null;
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  const radii = stroke.points.map((point) => Math.hypot((point.x - cx) / Math.max(width, 1), (point.y - cy) / Math.max(height, 1)));
  const mean = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  const deviation = Math.sqrt(radii.reduce((sum, radius) => sum + (radius - mean) ** 2, 0) / radii.length) / Math.max(mean, .01);
  if (deviation > .24) return null;
  return { tool: "shape", kind: "circle", start: { x: bounds.left, y: bounds.top }, end: { x: bounds.right, y: bounds.bottom }, color: stroke.color, width: stroke.width };
}

function recognizeMath(strokes: Annotation[]) {
  const ink = strokes.slice(-8).filter((item): item is Stroke => item.tool === "pen" && item.points.length > 1);
  if (ink.length < 4) return null;
  const lines = ink.map((stroke) => ({ stroke, bounds: strokeBounds(stroke) }));
  const horizontal = (item: typeof lines[number]) => item.bounds.right - item.bounds.left > (item.bounds.bottom - item.bounds.top) * 2.2;
  const vertical = (item: typeof lines[number]) => item.bounds.bottom - item.bounds.top > (item.bounds.right - item.bounds.left) * 2.2;
  const lastTwo = lines.slice(-2);
  if (!lastTwo.every(horizontal)) return null;
  const equalCenter = lastTwo.reduce((sum, item) => sum + (item.bounds.left + item.bounds.right) / 2, 0) / 2;
  if (Math.abs((lastTwo[0].bounds.left + lastTwo[0].bounds.right) / 2 - (lastTwo[1].bounds.left + lastTwo[1].bounds.right) / 2) > 24) return null;
  const beforeEqual = lines.slice(0, -2).filter((item) => item.bounds.right < equalCenter);
  let plusIndex = -1;
  for (let index = 0; index < beforeEqual.length - 1; index += 1) {
    const a = beforeEqual[index];
    const b = beforeEqual[index + 1];
    if ((horizontal(a) && vertical(b)) || (vertical(a) && horizontal(b))) {
      const ax = (a.bounds.left + a.bounds.right) / 2;
      const ay = (a.bounds.top + a.bounds.bottom) / 2;
      const bx = (b.bounds.left + b.bounds.right) / 2;
      const by = (b.bounds.top + b.bounds.bottom) / 2;
      if (Math.hypot(ax - bx, ay - by) < 32) { plusIndex = index; break; }
    }
  }
  if (plusIndex < 1 || plusIndex + 2 >= beforeEqual.length) return null;
  const left = beforeEqual.slice(0, plusIndex);
  const right = beforeEqual.slice(plusIndex + 2);
  if (!left.every(vertical) || !right.every(vertical)) return null;
  const equalAngles = lastTwo.map(({ stroke }) => {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    return Math.atan2(last.y - first.y, last.x - first.x);
  });
  const rotation = equalAngles.reduce((sum, angle) => sum + angle, 0) / equalAngles.length;
  const writingHeight = Math.max(...beforeEqual.map((item) => item.bounds.bottom)) - Math.min(...beforeEqual.map((item) => item.bounds.top));
  const fontSize = clamp(writingHeight * .82, 18, 56);
  const equalRight = Math.max(...lastTwo.map((item) => item.bounds.right));
  const equalMidY = lastTwo.reduce((sum, item) => sum + (item.bounds.top + item.bounds.bottom) / 2, 0) / 2;
  return { answer: left.length + right.length, x: equalRight + Math.cos(rotation) * 14, y: equalMidY - fontSize * .48 + Math.sin(rotation) * 14, fontSize, rotation };
}

function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === "pointer") return <MousePointer2 />;
  if (tool === "pen") return <PenLine />;
  if (tool === "highlighter") return <Highlighter />;
  if (tool === "text") return <TextIcon />;
  if (tool === "laser") return <Focus />;
  if (tool === "magnifier") return <ZoomIn />;
  return <Eraser />;
}

function ToolbarButton({
  label,
  shortcut,
  selected,
  disabled,
  danger,
  indicator,
  expanded,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
  indicator?: string;
  expanded?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool-button ${danger ? "danger" : ""}`}
      aria-label={shortcut ? `${label}, ${shortcut}` : label}
      aria-pressed={selected}
      aria-expanded={expanded}
      disabled={disabled}
      data-state={selected ? "selected" : "idle"}
      onClick={onClick}
    >
      {children}
      {indicator ? <i className="color-indicator" style={{ background: indicator }} /> : null}
      <span className="tooltip">{label}{shortcut ? <kbd>{shortcut}</kbd> : null}</span>
    </button>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const laserTrailRef = useRef<HTMLCanvasElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const laserRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const strokesRef = useRef<Annotation[]>([]);
  const mathInkRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Annotation[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const gestureToolRef = useRef<Tool | null>(null);
  const lastLaserPointRef = useRef<Point | null>(null);
  const cancelTextRef = useRef(false);
  const clickThroughRef = useRef(false);
  const dragRef = useRef({ id: -1, startX: 0, startY: 0, x: 0, y: 0, moved: false });
  const whiteboardDragRef = useRef({ id: -1, startX: 0, startY: 0, x: 0, y: 0 });
  const shapeResizeRef = useRef<{ id: number; index: number; edge: "start" | "end" } | null>(null);
  const laserTimerRef = useRef<number | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>("pen");
  const [colors, setColors] = useState<Record<InkTool, string>>({ pen: "#4778A8", highlighter: "#C69B43" });
  const [widths, setWidths] = useState<Record<StrokeTool, number>>({ pen: 4, highlighter: 16, eraser: 24 });
  const [textSize, setTextSize] = useState(24);
  const [textEditor, setTextEditor] = useState<{ x: number; y: number; value: string } | null>(null);
  const [whiteboard, setWhiteboard] = useState(false);
  const [whiteboardFull, setWhiteboardFull] = useState(false);
  const [whiteboardPosition, setWhiteboardPosition] = useState(() => ({ x: Math.round(window.innerWidth * .25), y: Math.round(window.innerHeight * .25) }));
  const [blackout, setBlackout] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(300);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerVisible, setTimerVisible] = useState(false);
  const [magnifier, setMagnifier] = useState({ x: 320, y: 240, zoom: 2 });
  const [screenCapture, setScreenCapture] = useState<string | null>(null);
  const [quickTool, setQuickTool] = useState<"eraser" | "laser" | "highlighter" | "none">(() => {
    const saved = window.localStorage.getItem("point.quickTool");
    return saved === "laser" || saved === "highlighter" || saved === "none" ? saved : "eraser";
  });
  const [selectedShape, setSelectedShape] = useState<number | null>(null);
  const [, setShapeRevision] = useState(0);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [popover, setPopover] = useState<Popover>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [toolbarSize, setToolbarSize] = useState({ width: 580, height: 60 });
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [idle, setIdle] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [announcement, setAnnouncement] = useState("펜 선택됨");

  const syncHistory = useCallback(() => {
    setHistory({ undo: strokesRef.current.length, redo: redoRef.current.length });
  }, []);

  const renderStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Annotation) => {
    if (stroke.tool === "shape") {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (stroke.kind === "line") {
        ctx.moveTo(stroke.start.x, stroke.start.y);
        ctx.lineTo(stroke.end.x, stroke.end.y);
      } else {
        const cx = (stroke.start.x + stroke.end.x) / 2;
        const cy = (stroke.start.y + stroke.end.y) / 2;
        const rx = Math.abs(stroke.end.x - stroke.start.x) / 2;
        const ry = Math.abs(stroke.end.y - stroke.start.y) / 2;
        ctx.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (stroke.tool === "text") {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.translate(stroke.x, stroke.y);
      ctx.rotate(stroke.rotation ?? 0);
      ctx.font = `600 ${stroke.fontSize}px "Segoe UI Variable Text", "Segoe UI", sans-serif`;
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2.5, stroke.fontSize * 0.12);
      ctx.strokeStyle = stroke.color === "#22262C" ? "rgba(255,255,255,.48)" : "rgba(0,0,0,.38)";
      ctx.strokeText(stroke.text, 0, 0);
      ctx.fillStyle = stroke.color;
      ctx.fillText(stroke.text, 0, 0);
      ctx.restore();
      return;
    }
    if (!stroke.points.length) return;
    ctx.save();
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.globalAlpha = stroke.tool === "highlighter" ? 0.38 : 1;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      ctx.beginPath();
      ctx.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i += 1) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    strokesRef.current.forEach((stroke) => renderStroke(ctx, stroke));
  }, [renderStroke]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const laserCanvas = laserTrailRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    if (laserCanvas) {
      laserCanvas.width = Math.round(window.innerWidth * ratio);
      laserCanvas.height = Math.round(window.innerHeight * ratio);
    }
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    redraw();
  }, [redraw]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    const canvas = laserTrailRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    const fade = () => {
      const ratio = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,.055)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.restore();
      frame = requestAnimationFrame(fade);
    };
    frame = requestAnimationFrame(fade);
    return () => {
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lastLaserPointRef.current = null;
    };
  }, []);

  const drawLaserTrail = useCallback((point: Point) => {
    const canvas = laserTrailRef.current;
    const ctx = canvas?.getContext("2d");
    const previous = lastLaserPointRef.current;
    lastLaserPointRef.current = point;
    if (!canvas || !ctx || !previous) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = .72;
    ctx.strokeStyle = "#D85B55";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(216,91,85,.72)";
    ctx.shadowBlur = 11;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
  }, []);

  const drawSegment = useCallback((stroke: Stroke, from: Point, to: Point) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.globalAlpha = stroke.tool === "highlighter" ? 0.38 : 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }, []);

  const finishStroke = useCallback((commit: boolean) => {
    const stroke = activeStrokeRef.current;
    if (stroke && commit) {
      if (stroke.tool === "pen") {
        mathInkRef.current = [...mathInkRef.current.slice(-7), stroke];
        const math = recognizeMath(mathInkRef.current);
        const shape = stroke.constrain ? recognizeAutoShape(stroke) : null;
        strokesRef.current.push(shape ?? stroke);
        setSelectedShape(shape ? strokesRef.current.length - 1 : null);
        if (math) {
          strokesRef.current.push({ tool: "text", x: math.x, y: math.y, text: String(math.answer), color: stroke.color, fontSize: math.fontSize, rotation: math.rotation });
          mathInkRef.current = [];
          setAnnouncement(`계산 결과는 ${math.answer}입니다`);
        } else if (shape) {
          setAnnouncement(shape.kind === "circle" ? "원을 자동으로 보정했습니다" : "직선을 자동으로 보정했습니다");
        }
      } else {
        strokesRef.current.push(stroke);
        mathInkRef.current = [];
      }
      redoRef.current = [];
    }
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    redraw();
    syncHistory();
  }, [redraw, syncHistory]);

  useEffect(() => {
    if (!timerRunning) return;
    const timer = window.setInterval(() => setTimerSeconds((value) => {
      if (value <= 1) {
        setTimerRunning(false);
        setAnnouncement("타이머가 종료되었습니다");
        return 0;
      }
      return value - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

  useEffect(() => {
    window.localStorage.setItem("point.quickTool", quickTool);
  }, [quickTool]);

  useEffect(() => {
    if (activeTool !== "magnifier") return;
    setAnnouncement("마우스를 움직이고 휠로 확대 배율을 조절하세요");
    window.pointDesktop.captureScreen().then(setScreenCapture);
  }, [activeTool]);

  const setClickThrough = useCallback((enabled: boolean) => {
    if (clickThroughRef.current === enabled) return;
    clickThroughRef.current = enabled;
    window.pointDesktop.setClickThrough(enabled);
  }, []);

  const selectTool = useCallback((tool: Tool) => {
    if (activeStrokeRef.current) finishStroke(true);
    setTextEditor(null);
    setActiveTool(tool);
    setPopover(null);
    setClickThrough(false);
    setAnnouncement(`${TOOL_LABEL[tool]} 선택됨`);
  }, [finishStroke, setClickThrough]);

  useEffect(() => {
    if (!textEditor) return;
    const frame = requestAnimationFrame(() => {
      textInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [textEditor]);

  const commitText = useCallback(() => {
    if (!textEditor) return;
    if (cancelTextRef.current) {
      cancelTextRef.current = false;
      setTextEditor(null);
      return;
    }
    const value = textEditor.value.trim();
    if (value) {
      strokesRef.current.push({
        tool: "text",
        x: textEditor.x,
        y: textEditor.y,
        text: value,
        color: colors.pen,
        fontSize: textSize,
      });
      redoRef.current = [];
      redraw();
      syncHistory();
      setAnnouncement("텍스트를 추가했습니다");
    }
    setTextEditor(null);
  }, [colors.pen, redraw, syncHistory, textEditor, textSize]);

  const undo = useCallback(() => {
    const stroke = strokesRef.current.pop();
    if (!stroke) return;
    redoRef.current.push(stroke);
    redraw();
    syncHistory();
  }, [redraw, syncHistory]);

  const redo = useCallback(() => {
    const stroke = redoRef.current.pop();
    if (!stroke) return;
    strokesRef.current.push(stroke);
    redraw();
    syncHistory();
  }, [redraw, syncHistory]);

  const clear = useCallback(() => {
    if (!strokesRef.current.length) return;
    redoRef.current = [...strokesRef.current].reverse();
    strokesRef.current = [];
    mathInkRef.current = [];
    setSelectedShape(null);
    redraw();
    syncHistory();
    setPopover(null);
    setAnnouncement("모든 주석을 지웠습니다");
  }, [redraw, syncHistory]);

  useEffect(() => window.pointDesktop.onCommand((command) => {
    if (["pointer", "pen", "highlighter", "text", "laser", "eraser", "magnifier"].includes(command)) selectTool(command as Tool);
    if (command === "clear") clear();
    if (command === "whiteboard") { setWhiteboard((value) => { if (value) setWhiteboardFull(false); return !value; }); setBlackout(false); }
    if (command === "blackout") { setBlackout((value) => !value); setWhiteboard(false); }
    if (command === "timer") setTimerVisible((value) => !value);
    if (command === "viewport-changed") resizeCanvas();
  }), [clear, resizeCanvas, selectTool]);

  useEffect(() => {
    if (activeTool !== "pointer") {
      setClickThrough(false);
      return;
    }
    const update = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      setClickThrough(!element?.closest("[data-interactive]"));
    };
    window.addEventListener("mousemove", update, { passive: true });
    const timer = window.setTimeout(() => setClickThrough(true), 120);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", update);
      setClickThrough(false);
    };
  }, [activeTool, setClickThrough]);

  const showLaser = useCallback((x: number, y: number, pressed: boolean) => {
    const laser = laserRef.current;
    if (!laser) return;
    laser.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    laser.classList.add("visible");
    laser.classList.toggle("pressed", pressed);
    if (pressed) {
      laser.classList.remove("pulse");
      void laser.offsetWidth;
      laser.classList.add("pulse");
    }
  }, []);

  const hideLaser = useCallback((delay = 0) => {
    if (laserTimerRef.current) window.clearTimeout(laserTimerRef.current);
    laserTimerRef.current = window.setTimeout(() => laserRef.current?.classList.remove("visible", "pressed", "pulse"), delay);
  }, []);

  const onCanvasDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const effectiveTool: Tool = event.button === 2 && quickTool !== "none" ? quickTool : activeTool;
    gestureToolRef.current = effectiveTool;
    if (effectiveTool === "pointer") return;
    event.preventDefault();
    if (whiteboard && !whiteboardFull) {
      const board = { left: window.innerWidth * .25, right: window.innerWidth * .75, top: window.innerHeight * .25, bottom: window.innerHeight * .75 };
      if (event.clientX < board.left || event.clientX > board.right || event.clientY < board.top || event.clientY > board.bottom) return;
    }
    if (effectiveTool === "magnifier") {
      setMagnifier((current) => ({ ...current, x: event.clientX, y: event.clientY }));
      return;
    }
    if (effectiveTool === "text") {
      cancelTextRef.current = false;
      setTextEditor({
        x: clamp(event.clientX, 14, window.innerWidth - 294),
        y: clamp(event.clientY, 14, window.innerHeight - 96),
        value: "",
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    if (effectiveTool === "laser") {
      lastLaserPointRef.current = { x: event.clientX, y: event.clientY };
      showLaser(event.clientX, event.clientY, true);
      return;
    }
    const tool = effectiveTool as StrokeTool;
    const point = { x: event.clientX, y: event.clientY };
    const stroke: Stroke = {
      tool,
      points: [point],
      color: tool === "eraser" ? "#000" : colors[tool as InkTool],
      width: widths[tool],
      constrain: tool === "pen" && event.shiftKey,
    };
    activeStrokeRef.current = stroke;
    drawSegment(stroke, point, { x: point.x + 0.01, y: point.y + 0.01 });
  };

  const onCanvasMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const effectiveTool = gestureToolRef.current ?? activeTool;
    if (effectiveTool === "magnifier") setMagnifier((current) => ({ ...current, x: event.clientX, y: event.clientY }));
    if (effectiveTool === "laser") {
      const point = { x: event.clientX, y: event.clientY };
      showLaser(point.x, point.y, activePointerRef.current === event.pointerId);
      drawLaserTrail(point);
    }
    if (effectiveTool === "laser" || effectiveTool === "text" || effectiveTool === "magnifier" || activePointerRef.current !== event.pointerId) return;
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    events.forEach((pointerEvent) => {
      const point = whiteboard && !whiteboardFull
        ? { x: clamp(pointerEvent.clientX, window.innerWidth * .25, window.innerWidth * .75), y: clamp(pointerEvent.clientY, window.innerHeight * .25, window.innerHeight * .75) }
        : { x: pointerEvent.clientX, y: pointerEvent.clientY };
      const previous = stroke.points[stroke.points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35) return;
      stroke.points.push(point);
      drawSegment(stroke, previous, point);
    });
  };

  const onCanvasUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const effectiveTool = gestureToolRef.current ?? activeTool;
    if (effectiveTool === "magnifier") { gestureToolRef.current = null; return; }
    if (activePointerRef.current !== event.pointerId) return;
    if (effectiveTool === "laser") {
      activePointerRef.current = null;
      lastLaserPointRef.current = null;
      showLaser(event.clientX, event.clientY, false);
      hideLaser(180);
    } else finishStroke(true);
    gestureToolRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const resizeShape = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = shapeResizeRef.current;
    if (!resize || resize.id !== event.pointerId) return;
    const shape = strokesRef.current[resize.index];
    if (!shape || shape.tool !== "shape") return;
    shape[resize.edge] = { x: event.clientX, y: event.clientY };
    redraw();
    setShapeRevision((value) => value + 1);
  };

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const rect = toolbarRef.current?.getBoundingClientRect();
      if (!rect) return;
      setToolbarSize({ width: rect.width, height: rect.height });
      setPosition((current) => positioned ? {
        x: clamp(current.x, 14, window.innerWidth - rect.width - 14),
        y: clamp(current.y, 14, window.innerHeight - rect.height - 14),
      } : {
        x: Math.round((window.innerWidth - rect.width) / 2),
        y: Math.round(window.innerHeight - rect.height - 28),
      });
      setPositioned(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, positioned]);

  const dragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y, moved: false };
    setDragging(true);
    setPopover(null);
  };

  const dragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    setPosition({
      x: clamp(drag.x + dx, 14, window.innerWidth - toolbarSize.width - 14),
      y: clamp(drag.y + dy, 14, window.innerHeight - toolbarSize.height - 14),
    });
  };

  const dragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag.id !== event.pointerId) return;
    setDragging(false);
    if (drag.moved) {
      const raw = { x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY };
      const maxX = window.innerWidth - toolbarSize.width - 14;
      const maxY = window.innerHeight - toolbarSize.height - 14;
      const next = { x: clamp(raw.x, 14, maxX), y: clamp(raw.y, 14, maxY) };
      const edges = [
        { key: "left", value: Math.abs(next.x - 14) },
        { key: "right", value: Math.abs(next.x - maxX) },
        { key: "top", value: Math.abs(next.y - 14) },
        { key: "bottom", value: Math.abs(next.y - maxY) },
      ].sort((a, b) => a.value - b.value);
      if (edges[0].value <= 64) {
        if (edges[0].key === "left") next.x = 14;
        if (edges[0].key === "right") next.x = maxX;
        if (edges[0].key === "top") next.y = 14;
        if (edges[0].key === "bottom") next.y = maxY;
      }
      setSnapping(true);
      setPosition(next);
      window.setTimeout(() => setSnapping(false), 190);
    }
    dragRef.current.id = -1;
  };

  const whiteboardDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (whiteboardFull) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    whiteboardDragRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: whiteboardPosition.x, y: whiteboardPosition.y };
  };

  const whiteboardDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = whiteboardDragRef.current;
    if (drag.id !== event.pointerId || whiteboardFull) return;
    const width = viewport.width * .5;
    const height = viewport.height * .5;
    setWhiteboardPosition({
      x: clamp(drag.x + event.clientX - drag.startX, 14, viewport.width - width - 14),
      y: clamp(drag.y + event.clientY - drag.startY, 14, viewport.height - height - 14),
    });
  };

  const whiteboardDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (whiteboardDragRef.current.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    whiteboardDragRef.current.id = -1;
  };

  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 2800);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2800);
    };
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    const aura = auraRef.current;
    if (!aura) return;
    const update = (event: PointerEvent) => {
      aura.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) translate(-50%, -50%)`;
      aura.classList.add("visible");
    };
    const hide = () => aura.classList.remove("visible");
    window.addEventListener("pointermove", update, { passive: true });
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const colorTool: InkTool | null = activeTool === "text" ? "pen" : activeTool === "pen" || activeTool === "highlighter" ? activeTool : null;
  const widthTool = activeTool === "pen" || activeTool === "highlighter" || activeTool === "eraser" ? activeTool : null;
  const popoverWidth = popover === "settings" ? 294 : 248;
  const popoverHeight = popover === "settings" ? 430 : popover === "width" ? 222 : 132;
  const above = position.y > popoverHeight + 22;
  const popoverStyle = {
    left: clamp(position.x + toolbarSize.width / 2 - popoverWidth / 2, 14, viewport.width - popoverWidth - 14),
    top: above ? position.y - popoverHeight - 10 : position.y + toolbarSize.height + 10,
    width: popoverWidth,
  } as CSSProperties;
  const selectedShapeValue = selectedShape === null ? null : strokesRef.current[selectedShape];
  const selectedShapeAnnotation = selectedShapeValue?.tool === "shape" ? selectedShapeValue : null;
  const timerLabel = `${String(Math.floor(timerSeconds / 60)).padStart(2, "0")}:${String(timerSeconds % 60).padStart(2, "0")}`;
  const auraColor = activeTool === "laser" ? "#D85B55" : activeTool === "eraser" ? "#9AA6B2" : activeTool === "highlighter" ? colors.highlighter : colors.pen;
  const whiteboardWidth = viewport.width * .5;

  return (
    <div className="overlay-root">
      {whiteboard ? <div className={`whiteboard-board ${whiteboardFull ? "fullscreen" : ""}`} style={whiteboardFull ? undefined : { left: whiteboardPosition.x, top: whiteboardPosition.y }} /> : null}
      {whiteboard ? (
        <div className={`whiteboard-controls ${whiteboardFull ? "fullscreen" : ""}`} data-interactive style={{ left: whiteboardFull ? viewport.width / 2 : whiteboardPosition.x + whiteboardWidth / 2, top: whiteboardFull ? 16 : whiteboardPosition.y + 14 }}>
          <button type="button" className="whiteboard-drag" aria-label="화이트보드 이동" onPointerDown={whiteboardDragStart} onPointerMove={whiteboardDragMove} onPointerUp={whiteboardDragEnd}><GripVertical /></button>
          <strong>화이트보드</strong><span>{whiteboardFull ? "전체 화면" : "플로팅 보드"}</span>
          <button type="button" aria-label={whiteboardFull ? "축소" : "전체 화면"} onClick={() => setWhiteboardFull((value) => !value)}>{whiteboardFull ? <Minimize2 /> : <Maximize2 />}</button>
          <button type="button" aria-label="화이트보드 닫기" onClick={() => { setWhiteboard(false); setWhiteboardFull(false); }}><X /></button>
        </div>
      ) : null}
      {blackout ? <div className="screen-cover blackout"><EyeOff /><strong>화면이 가려졌습니다</strong><span>Ctrl+Shift+9로 해제</span></div> : null}
      <div ref={auraRef} className={`cursor-aura ${activeTool === "pointer" ? "" : "hidden"}`} style={{ "--aura-color": auraColor } as CSSProperties} aria-hidden="true" />
      <canvas ref={laserTrailRef} className="laser-trail" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className={`drawing-canvas tool-${activeTool}`}
        aria-label="화면 주석 영역"
        style={{ pointerEvents: activeTool === "pointer" ? "none" : "auto" }}
        onPointerDown={onCanvasDown}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={() => { gestureToolRef.current = null; lastLaserPointRef.current = null; finishStroke(false); }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerLeave={() => activeTool === "laser" && activePointerRef.current === null && hideLaser()}
        onWheel={(event) => {
          if (activeTool !== "magnifier") return;
          event.preventDefault();
          setMagnifier((current) => ({ ...current, zoom: clamp(current.zoom + (event.deltaY < 0 ? .25 : -.25), 1.25, 4) }));
        }}
      />

      {activeTool === "magnifier" && screenCapture ? (
        <div className="magnifier-lens" style={{ left: magnifier.x, top: magnifier.y }}>
          <div style={{ backgroundImage: `url(${screenCapture})`, backgroundSize: `${viewport.width * magnifier.zoom}px ${viewport.height * magnifier.zoom}px`, backgroundPosition: `${-magnifier.x * magnifier.zoom + 104}px ${-magnifier.y * magnifier.zoom + 104}px` }} />
          <span>{magnifier.zoom.toFixed(2)}×</span>
        </div>
      ) : null}

      {selectedShapeAnnotation && activeTool === "pen" ? (["start", "end"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          className="shape-handle"
          aria-label={edge === "start" ? "도형 시작점 조절" : "도형 끝점 조절"}
          style={{ left: selectedShapeAnnotation[edge].x, top: selectedShapeAnnotation[edge].y }}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); shapeResizeRef.current = { id: event.pointerId, index: selectedShape!, edge }; }}
          onPointerMove={resizeShape}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); shapeResizeRef.current = null; syncHistory(); }}
        />
      )) : null}

      {timerVisible ? (
        <section className={`timer-float ${timerSeconds === 0 ? "finished" : ""}`} data-interactive>
          <Clock3 /><strong>{timerLabel}</strong>
          <button type="button" aria-label={timerRunning ? "일시정지" : "시작"} onClick={() => { if (!timerSeconds) setTimerSeconds(300); setTimerRunning((value) => !value); }}>{timerRunning ? <Pause /> : <Play />}</button>
          <button type="button" onClick={() => setTimerSeconds((value) => Math.max(0, value - 60))}>−1</button>
          <button type="button" onClick={() => setTimerSeconds((value) => value + 60)}>+1</button>
          <button type="button" aria-label="타이머 닫기" onClick={() => { setTimerRunning(false); setTimerVisible(false); }}><X /></button>
        </section>
      ) : null}

      {textEditor ? (
        <div className="text-editor" data-interactive style={{ left: textEditor.x, top: textEditor.y }}>
          <input
            ref={textInputRef}
            value={textEditor.value}
            placeholder="텍스트를 입력하세요"
            aria-label="화면에 추가할 텍스트"
            style={{ color: colors.pen, fontSize: textSize }}
            onChange={(event) => setTextEditor((current) => current ? { ...current, value: event.target.value } : null)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                cancelTextRef.current = true;
                setTextEditor(null);
              }
            }}
            onBlur={commitText}
          />
          <span>Enter로 적용 · Esc로 취소</span>
        </div>
      ) : null}

      <div ref={laserRef} className="laser-pointer" aria-hidden="true"><i /><b /></div>

      <div
        ref={toolbarRef}
        className={`floating-toolbar ${collapsed ? "collapsed" : "expanded"} ${idle && !dragging && !popover ? "idle" : ""} ${dragging ? "dragging" : ""} ${snapping ? "snapping" : ""}`}
        role="toolbar"
        aria-label="Point 화면 주석 도구"
        data-interactive
        style={{ left: position.x, top: position.y, visibility: positioned ? "visible" : "hidden" }}
      >
        {collapsed ? (
          <button
            type="button"
            className="collapsed-button"
            aria-label={`툴바 펼치기, 현재 ${TOOL_LABEL[activeTool]}`}
            onPointerDown={dragStart}
            onPointerMove={dragMove}
            onPointerUp={dragEnd}
            onDoubleClick={() => setCollapsed(false)}
          >
            <ToolIcon tool={activeTool} />
            <i style={{ background: colorTool ? colors[colorTool] : "#4778A8" }} />
          </button>
        ) : (
          <>
            <button type="button" className="drag-handle" aria-label="툴바 이동" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd}><GripVertical /></button>
            <ToolbarButton label="실행 취소" shortcut="Ctrl+Z" disabled={!history.undo} onClick={undo}><RotateCcw /></ToolbarButton>
            <span className="separator" />
            {(["pointer", "pen", "highlighter", "text", "laser", "eraser", "magnifier"] as Tool[]).map((tool) => (
              <ToolbarButton
                key={tool}
                label={TOOL_LABEL[tool]}
                shortcut={SHORTCUT[tool]}
                selected={activeTool === tool}
                indicator={tool === "pen" ? colors.pen : tool === "highlighter" ? colors.highlighter : tool === "text" ? colors.pen : undefined}
                onClick={() => selectTool(tool)}
              ><ToolIcon tool={tool} /></ToolbarButton>
            ))}
            <span className="separator" />
            <ToolbarButton label={activeTool === "text" ? "텍스트 색상" : "색상"} disabled={!colorTool} indicator={colorTool ? colors[colorTool] : undefined} expanded={popover === "color"} onClick={() => setPopover(popover === "color" ? null : "color")}><Palette /></ToolbarButton>
            <ToolbarButton label={activeTool === "text" ? "텍스트 크기" : activeTool === "eraser" ? "지우개 크기" : "선 굵기"} disabled={!widthTool && activeTool !== "text"} expanded={popover === "width"} onClick={() => setPopover(popover === "width" ? null : "width")}><Minus className="width-icon" /></ToolbarButton>
            <ToolbarButton label="모두 지우기" shortcut="Ctrl+Shift+Backspace" danger disabled={!history.undo} onClick={clear}><Trash2 /></ToolbarButton>
            <ToolbarButton label="설정" expanded={popover === "settings"} onClick={() => setPopover(popover === "settings" ? null : "settings")}><MoreHorizontal /></ToolbarButton>
            <ToolbarButton label="툴바 접기" onClick={() => { setPopover(null); setCollapsed(true); }}><ChevronDown /></ToolbarButton>
          </>
        )}
      </div>

      {popover ? (
        <section className={`popover popover-${popover}`} data-interactive style={popoverStyle} role="dialog" aria-label={popover === "color" ? "색상" : popover === "width" ? "크기" : "설정"}>
          <header>
            <div>
              <strong>{popover === "color" ? (activeTool === "text" ? "텍스트 색상" : "색상") : popover === "width" ? (activeTool === "text" ? "텍스트 크기" : activeTool === "eraser" ? "지우개 크기" : "선 굵기") : "Point 설정"}</strong>
              <span>{popover === "settings" ? "항상 위 오버레이 실행 중" : `${TOOL_LABEL[activeTool]}에 바로 적용됩니다`}</span>
            </div>
            <button type="button" aria-label="닫기" onClick={() => setPopover(null)}><X /></button>
          </header>
          {popover === "color" && colorTool ? (
            <div className="swatches" role="radiogroup" aria-label="색상 선택">
              {COLORS.map(([name, color]) => (
                <button key={color} type="button" role="radio" aria-label={name} aria-checked={colors[colorTool] === color} className={colors[colorTool] === color ? "selected" : ""} onClick={() => setColors((current) => ({ ...current, [colorTool]: color }))}>
                  <i style={{ background: color }} />
                </button>
              ))}
            </div>
          ) : null}
          {popover === "width" && activeTool === "text" ? (
            <div className="text-sizes" role="radiogroup" aria-label="텍스트 크기">
              {TEXT_SIZES.map((size) => (
                <button key={size} type="button" role="radio" aria-checked={textSize === size} className={textSize === size ? "selected" : ""} onClick={() => setTextSize(size)}>
                  <span style={{ fontSize: Math.min(size, 28) }}>Aa</span><small>{size}px</small>
                </button>
              ))}
            </div>
          ) : null}
          {popover === "width" && widthTool ? (
            <div className={`widths ${widthTool === "eraser" ? "eraser-widths" : ""}`} role="radiogroup" aria-label={widthTool === "eraser" ? "지우개 크기" : "선 굵기"}>
              {WIDTHS[widthTool].map((width, index) => (
                <button key={width} type="button" role="radio" aria-checked={widths[widthTool] === width} className={widths[widthTool] === width ? "selected" : ""} onClick={() => setWidths((current) => ({ ...current, [widthTool]: width }))}>
                  <span>{["얇게", "보통", "굵게", "아주 굵게"][index]}</span>
                  <i className={widthTool === "eraser" ? "eraser-preview" : ""} style={widthTool === "eraser" ? { width: Math.min(width, 24), height: Math.min(width, 24) } : { height: Math.min(width, 12) }} />
                  <small>{width}px</small>
                </button>
              ))}
            </div>
          ) : null}
          {popover === "settings" ? (
            <div className="settings">
              <div className="utility-grid">
                <button type="button" className={timerVisible ? "active" : ""} onClick={() => setTimerVisible((value) => !value)}><Clock3 />타이머</button>
                <button type="button" className={whiteboard ? "active" : ""} onClick={() => { setWhiteboard((value) => { if (value) setWhiteboardFull(false); return !value; }); setBlackout(false); }}><Presentation />화이트보드</button>
                <button type="button" className={blackout ? "active danger-active" : ""} onClick={() => { setBlackout((value) => !value); setWhiteboard(false); }}><EyeOff />화면 가리기</button>
              </div>
              <label className="quick-map"><span><strong>우클릭 퀵 액션</strong><small>펜을 바꾸지 않고 누르는 동안 사용</small></span><select value={quickTool} onChange={(event) => setQuickTool(event.target.value as typeof quickTool)}><option value="eraser">지우개</option><option value="laser">레이저</option><option value="highlighter">형광펜</option><option value="none">사용 안 함</option></select></label>
              <div className="shortcut-list"><span>표시·숨김 <kbd>Ctrl+Shift+0</kbd></span><span>도구 선택 <kbd>Ctrl+Shift+1~7</kbd></span><span>화이트보드 <kbd>Ctrl+Shift+8</kbd></span><span>화면 가리기 <kbd>Ctrl+Shift+9</kbd></span><span>타이머 <kbd>Ctrl+Shift+R</kbd></span></div>
              <div className="setting-actions"><button type="button" disabled={!history.redo} onClick={redo}><Redo2 />다시 실행</button><button type="button" onClick={() => window.pointDesktop.hide()}>오버레이 숨기기</button><button type="button" className="quit" onClick={() => window.pointDesktop.quit()}>프로그램 종료</button></div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
