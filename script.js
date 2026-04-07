const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: false });

const toolSelect = document.getElementById("toolSelect");
const colorInput = document.getElementById("colorInput");
const sizeInput = document.getElementById("sizeInput");
const opacityInput = document.getElementById("opacityInput");

const mirrorBtn = document.getElementById("mirrorBtn");
const rainbowBtn = document.getElementById("rainbowBtn");
const fillBtn = document.getElementById("fillBtn");
const gridBtn = document.getElementById("gridBtn");
const helpBtn = document.getElementById("helpBtn");

const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");

const canvasShell = document.getElementById("canvasShell");
const helpPanel = document.getElementById("helpPanel");
const hud = document.getElementById("hud");

const MAX_HISTORY = 30;
const state = {
  tool: "pen",
  color: "#1f2937",
  size: 10,
  opacity: 1,
  mirror: false,
  rainbow: false,
  fill: false,
  grid: true,
  help: true,
  hue: 0,
};

let dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
let drawing = false;
let pointerId = null;
let lastPoint = null;
let startPoint = null;
let baseSnapshot = null;
let sprayTimer = null;

const undoStack = [];
const redoStack = [];

let exploding = false;
let explosionRaf = null;
let explosionStartMs = 0;
let explosionDurationMs = 850;
let explosionParticles = [];
let explodeTimeout = null;

function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cssToCanvasPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  return { x, y };
}

function clearCanvas() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function snapshotCanvas() {
  const snap = document.createElement("canvas");
  snap.width = canvas.width;
  snap.height = canvas.height;
  const sctx = snap.getContext("2d");
  sctx.drawImage(canvas, 0, 0);
  return snap;
}

function cancelExplosion() {
  exploding = false;
  explosionParticles = [];
  if (explosionRaf) cancelAnimationFrame(explosionRaf);
  explosionRaf = null;
}

function cancelScheduledExplosion() {
  if (explodeTimeout) window.clearTimeout(explodeTimeout);
  explodeTimeout = null;
}

function scheduleExplosion() {
  cancelScheduledExplosion();
  explodeTimeout = window.setTimeout(() => {
    explodeTimeout = null;
    startExplosionThenDisappear();
  }, 750);
}

function buildExplosionParticlesFromSnapshot(snap) {
  const sctx = snap.getContext("2d");
  const { width, height } = snap;
  const img = sctx.getImageData(0, 0, width, height);
  const data = img.data;

  const maxParticles = 1400;
  const particles = [];
  const tries = maxParticles * 14;

  for (let i = 0; i < tries && particles.length < maxParticles; i++) {
    const x = (Math.random() * width) | 0;
    const y = (Math.random() * height) | 0;
    const idx = (y * width + x) * 4;
    const a = data[idx + 3];
    if (a < 22) continue;

    const r = data[idx + 0];
    const g = data[idx + 1];
    const b = data[idx + 2];

    const cx = x / dpr;
    const cy = y / dpr;

    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 520;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 0.8 + Math.random() * 2.8,
      color: `rgba(${r}, ${g}, ${b}, ${a / 255})`,
    });
  }

  return particles;
}

function startExplosionThenDisappear() {
  if (exploding) return;
  cancelScheduledExplosion();

  const snap = snapshotCanvas();
  const particles = buildExplosionParticlesFromSnapshot(snap);

  // Even if the drawing is tiny, we still clear (disappear).
  clearCanvas();
  baseSnapshot = null;
  stopSpray();

  // Reset history: the drawing is meant to disappear.
  undoStack.length = 0;
  redoStack.length = 0;
  syncActionButtons();

  if (particles.length === 0) {
    updateHud("Poof!");
    window.setTimeout(() => updateHud("Ready"), 280);
    return;
  }

  exploding = true;
  explosionStartMs = performance.now();
  explosionDurationMs = 850;
  explosionParticles = particles;
  updateHud("BOOM!");

  let lastMs = explosionStartMs;
  const drag = 0.985;
  const gravity = 260;

  function frame(nowMs) {
    if (!exploding) return;
    const t = (nowMs - explosionStartMs) / explosionDurationMs;
    const done = t >= 1;

    const dt = Math.min(0.033, Math.max(0.001, (nowMs - lastMs) / 1000));
    lastMs = nowMs;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Slight glow/afterimage
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (const p of explosionParticles) {
      p.vx *= Math.pow(drag, 60 * dt);
      p.vy = p.vy * Math.pow(drag, 60 * dt) + gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life = 1 - t;

      const a = clamp(p.life, 0, 1);
      if (a <= 0) continue;

      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (done) {
      cancelExplosion();
      clearCanvas();
      updateHud("Ready");
      return;
    }

    explosionRaf = requestAnimationFrame(frame);
  }

  explosionRaf = requestAnimationFrame(frame);
}

function drawSnapshot(snap) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(snap, 0, 0);
  ctx.restore();
}

function pushUndo() {
  undoStack.push(snapshotCanvas());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  syncActionButtons();
}

function undo() {
  if (undoStack.length === 0) return;
  cancelScheduledExplosion();
  redoStack.push(snapshotCanvas());
  const snap = undoStack.pop();
  clearCanvas();
  drawSnapshot(snap);
  syncActionButtons();
}

function redo() {
  if (redoStack.length === 0) return;
  cancelScheduledExplosion();
  undoStack.push(snapshotCanvas());
  const snap = redoStack.pop();
  clearCanvas();
  drawSnapshot(snap);
  syncActionButtons();
}

function syncActionButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

function setToggle(btn, on) {
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function setTool(tool) {
  state.tool = tool;
  toolSelect.value = tool;
  updateHud();
}

function updateHud(extra = "") {
  const toolName = {
    pen: "Pen",
    line: "Line",
    rect: "Rectangle",
    circle: "Circle",
    spray: "Spray",
    eraser: "Eraser",
  }[state.tool];

  const flags = [
    state.mirror ? "Mirror" : null,
    state.rainbow ? "Rainbow" : null,
    state.fill ? "Fill" : null,
    state.grid ? "Grid" : null,
  ].filter(Boolean);

  const parts = [
    `${toolName}`,
    `Size ${Math.round(state.size)}`,
    `Opacity ${Math.round(state.opacity * 100)}%`,
    flags.length ? `• ${flags.join(" • ")}` : "",
    extra ? `• ${extra}` : "",
  ].filter(Boolean);

  hud.textContent = parts.join(" ");
}

function setGrid(on) {
  state.grid = on;
  setToggle(gridBtn, on);
  canvasShell.classList.toggle("grid-on", on);
  updateHud();
}

function setHelp(on) {
  state.help = on;
  setToggle(helpBtn, on);
  helpPanel.classList.toggle("hidden", !on);
}

function setMirror(on) {
  state.mirror = on;
  setToggle(mirrorBtn, on);
  updateHud();
}

function setRainbow(on) {
  state.rainbow = on;
  setToggle(rainbowBtn, on);
  updateHud();
}

function setFill(on) {
  state.fill = on;
  setToggle(fillBtn, on);
  updateHud();
}

function applyBrushStyle({ erasing = false } = {}) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = state.size;
  ctx.globalAlpha = state.opacity;

  if (erasing) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.fillStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    if (state.rainbow) {
      ctx.strokeStyle = `hsl(${state.hue % 360} 92% 55%)`;
      ctx.fillStyle = ctx.strokeStyle;
    } else {
      ctx.strokeStyle = state.color;
      ctx.fillStyle = state.color;
    }
  }
}

function mirrorX(x) {
  return canvas.clientWidth - x;
}

function drawLineSegment(from, to, { erasing = false } = {}) {
  applyBrushStyle({ erasing });
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  if (state.mirror) {
    ctx.beginPath();
    ctx.moveTo(mirrorX(from.x), from.y);
    ctx.lineTo(mirrorX(to.x), to.y);
    ctx.stroke();
  }

  if (state.rainbow && !erasing) state.hue = (state.hue + 2) % 360;
}

function constrainRect(start, current) {
  const w = current.x - start.x;
  const h = current.y - start.y;
  const size = Math.sign(w || 1) * Math.min(Math.abs(w), Math.abs(h));
  return { w: size, h: Math.sign(h || 1) * Math.abs(size) };
}

function drawShapePreview(tool, from, to, { constrain = false } = {}) {
  if (!baseSnapshot) return;
  clearCanvas();
  drawSnapshot(baseSnapshot);

  const erasing = state.tool === "eraser";
  applyBrushStyle({ erasing });

  if (tool === "line") {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    if (state.mirror) {
      ctx.beginPath();
      ctx.moveTo(mirrorX(from.x), from.y);
      ctx.lineTo(mirrorX(to.x), to.y);
      ctx.stroke();
    }
    return;
  }

  if (tool === "rect") {
    let w = to.x - from.x;
    let h = to.y - from.y;
    if (constrain) ({ w, h } = constrainRect(from, to));

    const drawRect = (x, y, w2, h2) => {
      if (state.fill && !erasing) ctx.fillRect(x, y, w2, h2);
      ctx.strokeRect(x, y, w2, h2);
    };

    drawRect(from.x, from.y, w, h);
    if (state.mirror) drawRect(mirrorX(from.x) - w, from.y, w, h);
    return;
  }

  if (tool === "circle") {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const radius = constrain ? Math.min(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy);

    const drawCircle = (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, radius), 0, Math.PI * 2);
      if (state.fill && !erasing) ctx.fill();
      ctx.stroke();
    };

    drawCircle(from.x, from.y);
    if (state.mirror) drawCircle(mirrorX(from.x), from.y);
  }
}

function commitShape(tool, from, to, { constrain = false } = {}) {
  drawShapePreview(tool, from, to, { constrain });
  baseSnapshot = null;
}

function sprayAt(point, { erasing = false } = {}) {
  const dots = Math.round(18 + state.size * 1.4);
  const spread = state.size * 1.2;
  applyBrushStyle({ erasing });

  for (let i = 0; i < dots; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * spread;
    const x = point.x + Math.cos(angle) * radius;
    const y = point.y + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, state.size * 0.08), 0, Math.PI * 2);
    ctx.fill();

    if (state.mirror) {
      ctx.beginPath();
      ctx.arc(mirrorX(x), y, Math.max(0.6, state.size * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (state.rainbow && !erasing) state.hue = (state.hue + 4) % 360;
}

function startSpray(point, { erasing = false } = {}) {
  stopSpray();
  sprayAt(point, { erasing });
  sprayTimer = window.setInterval(() => sprayAt(lastPoint || point, { erasing }), 30);
}

function stopSpray() {
  if (sprayTimer) window.clearInterval(sprayTimer);
  sprayTimer = null;
}

function resizeCanvas(keepDrawing = true) {
  const prev = keepDrawing && canvas.width ? snapshotCanvas() : null;
  const rect = canvasShell.getBoundingClientRect();

  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  canvas.style.width = `${Math.floor(rect.width)}px`;
  canvas.style.height = `${Math.floor(rect.height)}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (prev) {
    clearCanvas();
    drawSnapshot(prev);
  }
}

function downloadPng() {
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  link.download = `keyboard-sketch-${stamp}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function onPointerDown(ev) {
  if (pointerId !== null) return;
  if (exploding) return;
  if (ev.button !== undefined && ev.button !== 0) return;
  cancelScheduledExplosion();

  pointerId = ev.pointerId;
  canvas.setPointerCapture(pointerId);

  drawing = true;
  lastPoint = cssToCanvasPoint(ev);
  startPoint = { ...lastPoint };

  pushUndo();

  if (state.tool === "spray") {
    startSpray(lastPoint, { erasing: false });
    updateHud("Spraying…");
    return;
  }

  if (state.tool === "eraser") {
    updateHud("Erasing…");
    return;
  }

  if (state.tool === "line" || state.tool === "rect" || state.tool === "circle") {
    baseSnapshot = snapshotCanvas();
    updateHud("Preview…");
    return;
  }

  updateHud("Drawing…");
}

function onPointerMove(ev) {
  if (!drawing || ev.pointerId !== pointerId) return;
  const point = cssToCanvasPoint(ev);
  const shift = ev.shiftKey;

  if (state.tool === "spray") {
    lastPoint = point;
    return;
  }

  if (state.tool === "line" || state.tool === "rect" || state.tool === "circle") {
    drawShapePreview(state.tool, startPoint, point, { constrain: shift });
    lastPoint = point;
    return;
  }

  if (state.tool === "eraser") {
    drawLineSegment(lastPoint, point, { erasing: true });
    lastPoint = point;
    return;
  }

  drawLineSegment(lastPoint, point, { erasing: false });
  lastPoint = point;
}

function finishStroke(ev) {
  if (!drawing || ev.pointerId !== pointerId) return;
  const point = cssToCanvasPoint(ev);
  const shift = ev.shiftKey;

  if (state.tool === "spray") stopSpray();

  if (state.tool === "line" || state.tool === "rect" || state.tool === "circle") {
    commitShape(state.tool, startPoint, point, { constrain: shift });
  }
  if ((state.tool === "pen" || state.tool === "eraser") && startPoint) {
    const dist = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
    if (dist < 0.8) {
      const erasing = state.tool === "eraser";
      applyBrushStyle({ erasing });
      const r = Math.max(0.6, state.size * 0.5);
      ctx.beginPath();
      ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (state.mirror) {
        ctx.beginPath();
        ctx.arc(mirrorX(point.x), point.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (state.rainbow && !erasing) state.hue = (state.hue + 6) % 360;
    }
  }

  drawing = false;
  pointerId = null;
  lastPoint = null;
  startPoint = null;
  baseSnapshot = null;
  updateHud();

  // Explode after a short pause (lets you draw multiple strokes quickly).
  scheduleExplosion();
}

function cancelStroke() {
  stopSpray();
  drawing = false;
  pointerId = null;
  lastPoint = null;
  startPoint = null;
  baseSnapshot = null;
  updateHud();
}

function setSize(next) {
  state.size = clamp(next, Number(sizeInput.min), Number(sizeInput.max));
  sizeInput.value = String(state.size);
  updateHud();
}

function setOpacity(next) {
  state.opacity = clamp(next, Number(opacityInput.min), Number(opacityInput.max));
  opacityInput.value = String(state.opacity);
  updateHud();
}

toolSelect.addEventListener("change", () => setTool(toolSelect.value));
colorInput.addEventListener("input", () => {
  state.color = colorInput.value;
  updateHud();
});
sizeInput.addEventListener("input", () => setSize(Number(sizeInput.value)));
opacityInput.addEventListener("input", () => setOpacity(Number(opacityInput.value)));

mirrorBtn.addEventListener("click", () => setMirror(!state.mirror));
rainbowBtn.addEventListener("click", () => setRainbow(!state.rainbow));
fillBtn.addEventListener("click", () => setFill(!state.fill));
gridBtn.addEventListener("click", () => setGrid(!state.grid));
helpBtn.addEventListener("click", () => setHelp(!state.help));

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
saveBtn.addEventListener("click", downloadPng);
clearBtn.addEventListener("click", () => {
  if (!confirm("Clear the canvas?")) return;
  cancelExplosion();
  cancelScheduledExplosion();
  pushUndo();
  clearCanvas();
  updateHud("Cleared");
});

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", finishStroke);
canvas.addEventListener("pointercancel", cancelStroke);
canvas.addEventListener("pointerleave", (ev) => {
  if (!drawing) return;
  if (ev.pointerId !== pointerId) return;
});

window.addEventListener("resize", () => resizeCanvas(true));

window.addEventListener("keydown", (ev) => {
  if (isTypingInField()) return;
  if (ev.metaKey || ev.ctrlKey) return;
  const key = ev.key.toLowerCase();

  const handled = () => {
    ev.preventDefault();
    ev.stopPropagation();
  };

  if (key >= "1" && key <= "5") {
    const map = { "1": "pen", "2": "line", "3": "rect", "4": "circle", "5": "spray" };
    setTool(map[key]);
    handled();
    return;
  }

  if (key === "e") {
    setTool("eraser");
    handled();
    return;
  }

  if (key === "[") {
    setSize(state.size - 2);
    handled();
    return;
  }

  if (key === "]") {
    setSize(state.size + 2);
    handled();
    return;
  }

  if (key === "u") {
    undo();
    handled();
    return;
  }

  if (key === "y") {
    redo();
    handled();
    return;
  }

  if (key === "m") {
    setMirror(!state.mirror);
    handled();
    return;
  }

  if (key === "r") {
    setRainbow(!state.rainbow);
    handled();
    return;
  }

  if (key === "f") {
    setFill(!state.fill);
    handled();
    return;
  }

  if (key === "g") {
    setGrid(!state.grid);
    handled();
    return;
  }

  if (key === "h") {
    setHelp(!state.help);
    handled();
    return;
  }

  if (key === "s") {
    downloadPng();
    handled();
    return;
  }

  if (key === "x") {
    if (!confirm("Clear the canvas?")) return;
    cancelExplosion();
    cancelScheduledExplosion();
    pushUndo();
    clearCanvas();
    updateHud("Cleared");
    handled();
  }
});

function init() {
  state.tool = toolSelect.value;
  state.color = colorInput.value;
  state.size = Number(sizeInput.value);
  state.opacity = Number(opacityInput.value);

  setMirror(false);
  setRainbow(false);
  setFill(false);
  setGrid(true);
  setHelp(true);

  resizeCanvas(false);
  updateHud("Ready");
  syncActionButtons();
}

init();
