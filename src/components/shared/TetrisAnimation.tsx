/**
 * IsometricBoxAnimation — Drop-in replacement de TetrisAnimation.
 * Misma interfaz de props; los popups existentes no necesitan cambios.
 *
 * COMPRESS : items caen en caja abierta → tapa cierra → agujero aparece → caja se hunde
 * DECOMPRESS: agujero abre → caja emerge → tapa abre → items salen
 * ERROR     : grietas sobre la caja
 * DONE      : checkmark verde
 */

import { useEffect, useRef } from "react";

// ── Canvas ────────────────────────────────────────────────────────────────────
const CW = 240;
const CH = 200;

// ── Geometría de la caja isométrica ──────────────────────────────────────────
const BX = CW / 2; // centro horizontal
const BY = 76;     // y del centro de la cara superior
const IW = 54;     // semiancho x
const ID = 17;     // semiprofundidad y (cara superior)
const BH = 44;     // altura de las caras laterales

type Pt2 = [number, number];
const shift = ([x, y]: Pt2, dy: number): Pt2 => [x, y + dy];

// Puntos de referencia sin offset
const P0 = {
  back:   [BX,       BY - ID]       as Pt2,
  left:   [BX - IW,  BY]            as Pt2,
  front:  [BX,       BY + ID]       as Pt2,
  right:  [BX + IW,  BY]            as Pt2,
  bLeft:  [BX - IW,  BY + BH]       as Pt2,
  bFront: [BX,       BY + ID + BH]  as Pt2,
  bRight: [BX + IW,  BY + BH]       as Pt2,
};

// Apertura de la caja (donde entran/salen items)
const OPEN_X = BX;
const OPEN_Y = BY + ID;

// Agujero / portal
const HOLE_CX = BX;
const HOLE_CY = BY + ID + BH + 26;
const HOLE_RX = 60;
const HOLE_RY = 15;

// ── Items ─────────────────────────────────────────────────────────────────────
const ITEM_COLORS = ["#22d3ee", "#fbbf24", "#c084fc", "#fb923c", "#4ade80"];
const N = ITEM_COLORS.length;

// ── Tiempos (ms) ──────────────────────────────────────────────────────────────
const T_ITEM  = 430; // duración de cada item cayendo
const T_WAIT  = 220; // pausa tras el último item
const T_CLOSE = 650; // tapa cerrando
const T_HOLE  = 480; // agujero abriéndose
const T_SINK  = 720; // caja hundiéndose
const T_RISE  = 580; // caja subiendo (decompress)
const T_OPENL = 580; // tapa abriéndose (decompress)
const T_EJECT = 350; // por item saliendo (decompress)

// ── Easing ────────────────────────────────────────────────────────────────────
const easeOut = (t: number) => 1 - (1 - t) ** 2;
const easeIn  = (t: number) => t ** 2;
const c01     = (t: number) => Math.max(0, Math.min(1, t));

// ── Tipos ─────────────────────────────────────────────────────────────────────
type Phase =
  | "filling" | "closing" | "hole_open" | "sink"      // compress
  | "d_hole"  | "d_rise"  | "d_open"   | "d_eject"    // decompress
  | "done_anim" | "error";

interface AS {
  phase:      Phase;
  phaseStart: number;
  mode:       "compress" | "decompress";
  errPhase:   Phase;
}

// ── Helper: polígono ──────────────────────────────────────────────────────────
function poly(
  ctx: CanvasRenderingContext2D,
  pts: Pt2[],
  fill: string,
  stroke: string,
  lw = 0.8,
) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill)   { ctx.fillStyle   = fill;   ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// ── Caja isométrica ───────────────────────────────────────────────────────────
//   dy   : offset vertical de toda la caja
//   lidT : 0 = tapa cerrada · 1 = tapa abierta (flotando arriba)
//   alpha: opacidad global
function drawBox(
  ctx: CanvasRenderingContext2D,
  dy: number,
  lidT: number,
  alpha: number,
) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const s = (p: Pt2): Pt2 => shift(p, dy);

  // Interior (visible cuando la tapa está abierta)
  if (lidT > 0) {
    poly(ctx, [s(P0.back), s(P0.left), s(P0.front), s(P0.right)], "#06060f", "transparent");

    // Líneas de profundidad sutiles
    ctx.save();
    ctx.globalAlpha = alpha * lidT * 0.22;
    ctx.strokeStyle = "#5b21b6";
    ctx.lineWidth = 0.5;
    for (let k = 1; k < 4; k++) {
      const f = k / 4;
      const lx = s(P0.back)[0]  + (s(P0.left)[0]  - s(P0.back)[0])  * f;
      const ly = s(P0.back)[1]  + (s(P0.left)[1]  - s(P0.back)[1])  * f;
      const rx = s(P0.right)[0] + (s(P0.front)[0] - s(P0.right)[0]) * f;
      const ry = s(P0.right)[1] + (s(P0.front)[1] - s(P0.right)[1]) * f;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
    }
    ctx.restore();
  }

  // Cara izquierda
  poly(ctx, [s(P0.left), s(P0.front), s(P0.bFront), s(P0.bLeft)], "#27272a", "#52525b");

  // Cara derecha
  poly(ctx, [s(P0.right), s(P0.front), s(P0.bFront), s(P0.bRight)], "#3f3f46", "#71717a");

  // Tapa: asciende lidT * 34 px cuando está abierta
  const lidDY = dy - lidT * 34;
  const L = (p: Pt2): Pt2 => shift(p, lidDY);
  poly(ctx, [L(P0.back), L(P0.left), L(P0.front), L(P0.right)], "#52525b", "#a1a1aa", 1.0);

  // Grosor visual de la tapa (visible al abrirse)
  if (lidT > 0.04) {
    ctx.save();
    ctx.globalAlpha = alpha * c01(lidT * 3) * 0.4;
    poly(ctx,
      [L(P0.left), L(P0.front), [L(P0.front)[0], L(P0.front)[1]+4], [L(P0.left)[0], L(P0.left)[1]+4]],
      "#18181b", "#52525b", 0.5);
    poly(ctx,
      [L(P0.right), L(P0.front), [L(P0.front)[0], L(P0.front)[1]+4], [L(P0.right)[0], L(P0.right)[1]+4]],
      "#27272a", "#52525b", 0.5);
    ctx.restore();
  }

  // Arista superior cuando tapa cerrada (énfasis de borde)
  if (lidT < 0.04) {
    ctx.save();
    ctx.strokeStyle = "#71717a";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    [P0.back, P0.left, P0.front, P0.right, P0.back].forEach(([x, y], i) => {
      const [sx, sy] = shift([x, y] as Pt2, dy);
      i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    });
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ── Item (diamante pequeño) ───────────────────────────────────────────────────
function drawItem(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  size: number,
  alpha: number,
) {
  if (alpha <= 0 || size <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x,          y - size);
  ctx.lineTo(x + size,   y);
  ctx.lineTo(x,          y + size * 0.55);
  ctx.lineTo(x - size,   y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // Highlight en esquina superior-izquierda
  ctx.beginPath();
  ctx.moveTo(x - size * 0.45, y - size * 0.35);
  ctx.lineTo(x,               y - size);
  ctx.lineTo(x + size * 0.45, y - size * 0.35);
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.restore();
}

// ── Agujero / portal ──────────────────────────────────────────────────────────
function drawHole(
  ctx: CanvasRenderingContext2D,
  progress: number, // 0→1: qué tan abierto
  time: number,     // para anillos giratorios
  alpha = 1,
) {
  if (progress <= 0 || alpha <= 0) return;
  const rx = HOLE_RX * progress;
  const ry = HOLE_RY * progress;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Fondo oscuro radial
  const grad = ctx.createRadialGradient(HOLE_CX, HOLE_CY, 0, HOLE_CX, HOLE_CY, rx);
  grad.addColorStop(0,    "rgba(0,0,0,1)");
  grad.addColorStop(0.55, "rgba(8,2,25,0.97)");
  grad.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.ellipse(HOLE_CX, HOLE_CY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Anillos que se expanden hacia fuera (efecto vórtice)
  for (let r = 0; r < 3; r++) {
    const rp  = (time * 0.00085 + r / 3) % 1;
    const ra  = (1 - rp) * 0.42 * progress;
    const rsc = 0.3 + rp * 0.7;
    ctx.save();
    ctx.globalAlpha = alpha * ra;
    ctx.beginPath();
    ctx.ellipse(HOLE_CX, HOLE_CY, rx * rsc, ry * rsc, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `hsl(${265 + r * 18}, 78%, 60%)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // Borde brillante
  ctx.beginPath();
  ctx.ellipse(HOLE_CX, HOLE_CY, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Halo exterior difuso
  ctx.beginPath();
  ctx.ellipse(HOLE_CX, HOLE_CY, rx + 5, ry + 2.5, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(139,92,246,0.32)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.restore();
}

// Arco frontal del agujero (se dibuja SOBRE la caja que se hunde)
function drawHoleFront(
  ctx: CanvasRenderingContext2D,
  progress: number,
  alpha = 1,
) {
  if (progress <= 0 || alpha <= 0) return;
  const rx = HOLE_RX * progress;
  const ry = HOLE_RY * progress;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Arco inferior = borde frontal del agujero (el más cercano al espectador)
  ctx.beginPath();
  ctx.ellipse(HOLE_CX, HOLE_CY, rx, ry, 0, 0, Math.PI);
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(HOLE_CX, HOLE_CY, rx + 4, ry + 2, 0, 0, Math.PI);
  ctx.strokeStyle = "rgba(139,92,246,0.42)";
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.restore();
}

// ── Grietas de error ──────────────────────────────────────────────────────────
const CRACKS: [number, number][][] = [
  [[0,0],[22,-28],[38,-14]],
  [[0,0],[-26,-18],[-44,-36]],
  [[0,0],[30,14],[44,32]],
  [[0,0],[-18,22],[-28,44]],
];

function drawCracks(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number) {
  ctx.save();
  ctx.translate(cx, cy);
  const n = Math.ceil(t * CRACKS.length);
  for (let i = 0; i < n; i++) {
    const p = CRACKS[i];
    const localT = c01(t * CRACKS.length - i);
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let j = 1; j < p.length; j++) {
      const frac = localT * (p.length - 1);
      if (j <= frac) {
        ctx.lineTo(p[j][0], p[j][1]);
      } else {
        const f = frac - (j - 1);
        ctx.lineTo(p[j-1][0] + (p[j][0]-p[j-1][0])*f, p[j-1][1] + (p[j][1]-p[j-1][1])*f);
        break;
      }
    }
    ctx.strokeStyle = i === 0 ? "#ef4444" : "rgba(239,68,68,0.70)";
    ctx.lineWidth = Math.max(0.8, 2.2 - i * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Estado inicial ────────────────────────────────────────────────────────────
function mkCompress(now: number): AS {
  return { phase: "filling", phaseStart: now, mode: "compress", errPhase: "filling" };
}
function mkDecompress(now: number): AS {
  return { phase: "d_hole", phaseStart: now, mode: "decompress", errPhase: "d_hole" };
}

// ── Máquina de estados (tick) ─────────────────────────────────────────────────
function tick(s: AS, now: number, extPhase: string): AS {
  if (extPhase === "error" && s.phase !== "error" && s.phase !== "done_anim")
    return { ...s, phase: "error", phaseStart: now, errPhase: s.phase };
  if (extPhase === "done" && s.phase !== "done_anim" && s.phase !== "error")
    return { ...s, phase: "done_anim", phaseStart: now };

  const el = now - s.phaseStart;

  switch (s.phase) {
    // compress
    case "filling":   return el >= N * T_ITEM + T_WAIT ? { ...s, phase: "closing",   phaseStart: now } : s;
    case "closing":   return el >= T_CLOSE             ? { ...s, phase: "hole_open",  phaseStart: now } : s;
    case "hole_open": return el >= T_HOLE              ? { ...s, phase: "sink",        phaseStart: now } : s;
    case "sink":      return el >= T_SINK              ? mkCompress(now) : s; // loop

    // decompress
    case "d_hole":  return el >= T_HOLE  ? { ...s, phase: "d_rise",  phaseStart: now } : s;
    case "d_rise":  return el >= T_RISE  ? { ...s, phase: "d_open",  phaseStart: now } : s;
    case "d_open":  return el >= T_OPENL ? { ...s, phase: "d_eject", phaseStart: now } : s;
    case "d_eject": return el >= N * T_EJECT ? { ...s, phase: "done_anim", phaseStart: now } : s;

    case "done_anim":
    case "error":
      return s;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(ctx: CanvasRenderingContext2D, s: AS, now: number) {
  ctx.clearRect(0, 0, CW, CH);
  const el = now - s.phaseStart;

  switch (s.phase) {

    // ── COMPRESS ──────────────────────────────────────────────────────────────
    case "filling": {
      drawBox(ctx, 0, 1, 1);
      for (let i = 0; i < N; i++) {
        const t = c01((el - i * T_ITEM) / T_ITEM);
        if (t <= 0) continue;
        if (t < 1) {
          // Cayendo desde arriba
          const eo = easeOut(t);
          const x  = OPEN_X + (i - N / 2 + 0.5) * 5 * t;
          const y  = 12 + (OPEN_Y - 12) * eo;
          drawItem(ctx, ITEM_COLORS[i], x, y, 10 - 4 * t, 1);
        } else {
          // Dentro de la caja (semi-visible)
          const ix = OPEN_X + (i - N / 2 + 0.5) * 14;
          drawItem(ctx, ITEM_COLORS[i], ix, OPEN_Y + 5, 5, 0.32);
        }
      }
      break;
    }

    case "closing": {
      const t    = c01(el / T_CLOSE);
      const lidT = easeOut(1 - t); // 1→0: cierra
      drawBox(ctx, 0, lidT, 1);
      const fade = 1 - easeIn(t);
      for (let i = 0; i < N; i++) {
        const ix = OPEN_X + (i - N / 2 + 0.5) * 14;
        drawItem(ctx, ITEM_COLORS[i], ix, OPEN_Y + 5, 5, 0.32 * fade);
      }
      break;
    }

    case "hole_open": {
      const t = c01(el / T_HOLE);
      drawHole(ctx, easeOut(t), now);
      drawBox(ctx, 0, 0, 1);
      drawHoleFront(ctx, easeOut(t));
      break;
    }

    case "sink": {
      const t    = c01(el / T_SINK);
      // La caja desciende hasta desaparecer por el agujero
      const dy    = easeIn(t) * (HOLE_RY * 2 + BH + ID + 34);
      const alpha = t < 0.5 ? 1 : 1 - easeIn((t - 0.5) / 0.5);
      drawHole(ctx, 1, now);
      drawBox(ctx, dy, 0, alpha);
      drawHoleFront(ctx, 1); // arco frontal encima de la caja
      break;
    }

    // ── DECOMPRESS ────────────────────────────────────────────────────────────
    case "d_hole": {
      // Agujero abre y la caja empieza a asomar desde abajo
      const t = c01(el / T_HOLE);
      drawHole(ctx, easeOut(t), now);
      drawBox(ctx, (1 - easeOut(t)) * 58, 0, easeOut(t) * 0.55);
      drawHoleFront(ctx, easeOut(t));
      break;
    }

    case "d_rise": {
      // Caja sube a su posición; el agujero se cierra gradualmente
      const t    = c01(el / T_RISE);
      const dy   = (1 - easeOut(t)) * 58;
      const holePr = c01(1 - t);
      drawHole(ctx, holePr, now, holePr);
      drawBox(ctx, dy, 0, 1);
      drawHoleFront(ctx, holePr, holePr);
      break;
    }

    case "d_open": {
      const t = c01(el / T_OPENL);
      drawBox(ctx, 0, easeOut(t), 1);
      break;
    }

    case "d_eject": {
      drawBox(ctx, 0, 1, 1);
      for (let i = 0; i < N; i++) {
        const t = c01((el - i * T_EJECT) / T_EJECT);
        if (t <= 0) continue;
        const eo = easeOut(t);
        const tx = OPEN_X + (i - N / 2 + 0.5) * 32;
        const ty = 18 + i * 6;
        const x  = OPEN_X + (tx - OPEN_X) * eo;
        const y  = OPEN_Y + (ty - OPEN_Y) * eo;
        drawItem(ctx, ITEM_COLORS[i], x, y, 5 + 5 * eo, 1 - t * 0.22);
      }
      break;
    }

    // ── COMUNES ───────────────────────────────────────────────────────────────
    case "done_anim": {
      ctx.save();
      const a = c01(el / 350);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#22c55e";
      ctx.font = `bold ${Math.round(28 + a * 8)}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓", CW / 2, CH / 2);
      ctx.restore();
      break;
    }

    case "error": {
      const crT = c01(el / 1000);
      drawBox(ctx, 0, 0.22, 0.45);
      drawCracks(ctx, BX, BY, crT);
      ctx.fillStyle = `rgba(220,38,38,${0.18 * (1 - crT)})`;
      ctx.fillRect(0, 0, CW, CH);
      break;
    }
  }
}

// ── Componente (interfaz idéntica al original) ────────────────────────────────
export interface TetrisAnimationProps {
  phase: string;  // "compressing" | "decompressing" | "done" | "error"
  mode: "compress" | "decompress";
}

export function TetrisAnimation({ phase, mode }: TetrisAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef<AS | null>(null);
  const phaseRef  = useRef(phase);
  const rafRef    = useRef<number>(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t0 = performance.now();
    stateRef.current = mode === "compress" ? mkCompress(t0) : mkDecompress(t0);

    const loop = (now: number) => {
      if (stateRef.current) {
        stateRef.current = tick(stateRef.current, now, phaseRef.current);
        render(ctx, stateRef.current, now);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      width={CW}
      height={CH}
      className="select-none"
      style={{ imageRendering: "pixelated" }}
    />
  );
}