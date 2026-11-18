"use client";
/**
 * Carte tactique (canvas). Affiche uniquement ce que le serveur a transmis :
 * coéquipiers, adversaires visibles, contacts radar, révélations.
 *
 * Interactions : toucher une case (déplacement / ciblage), glisser pour
 * déplacer la vue, pincer ou molette pour zoomer.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { cellLabel, inRadius, key, visibilityMask } from "@/lib/engine/grid";
import { contactRect, DIR_ANGLE, enemyOf } from "@/lib/engine/rules";
import type { Cell } from "@/lib/engine/types";
import type { GameState } from "@/lib/game/state";

const COLORS = {
  bg: "#050608",
  dot: "#2a2f39",
  building: "#1c2029",
  buildingEdge: "#262b35",
  forbidden: "#ff5a4e",
  fog: "rgba(5,6,8,0.62)",
  volt: "#2f6bff",
  hunter: "#ff5a4e",
  fugitive: "#4fd1a5",
  ivory: "#ece8df",
  fogText: "#8b919c",
  warn: "#e8b14a",
};

export interface MapHandle {
  recenter: () => void;
  zoom: (factor: number) => void;
}

export interface GameMapProps {
  state: GameState;
  now: number;
  reachable: Set<string> | null;
  path: Cell[] | null;
  target: { range: number; radius?: number } | null;
  hover: Cell | null;
  showCoordinates: boolean;
  onCellTap: (c: Cell) => void;
}

interface Camera {
  cx: number; // centre de vue en coordonnées case (float)
  cy: number;
  size: number; // px par case
  follow: boolean;
}

export const GameMap = forwardRef<MapHandle, GameMapProps>(function GameMap(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ cx: props.state.me.x + 0.5, cy: props.state.me.y + 0.5, size: 34, follow: true });
  const propsRef = useRef(props);
  propsRef.current = props;
  const frame = useRef<number | null>(null);
  const sweep = useRef<{ start: number; x: number; y: number; color: string } | null>(null);
  const lastPulse = useRef<number | null>(props.state.radar?.i ?? null);

  const draw = useCallback(() => {
    frame.current = null;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const p = propsRef.current;
    const { state, now } = p;
    const map = state.game.map;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    const c = cam.current;
    if (c.follow) {
      c.cx = state.me.x + 0.5;
      c.cy = state.me.y + 0.5;
    }
    const s = c.size;
    const ox = W / 2 - c.cx * s;
    const oy = H / 2 - c.cy * s;
    const toPx = (x: number, y: number) => [ox + x * s, oy + y * s] as const;
    const x0 = Math.max(0, Math.floor(-ox / s) - 1);
    const y0 = Math.max(0, Math.floor(-oy / s) - 1);
    const x1 = Math.min(map.w - 1, Math.ceil((W - ox) / s) + 1);
    const y1 = Math.min(map.h - 1, Math.ceil((H - oy) / s) + 1);

    const finished = state.game.phase === "finished";
    const myTeam = state.me.team;
    const vision = finished ? null : visibilityMask(
      map,
      Object.values(state.allies).filter((a) => a.status === "active" && a.team === myTeam),
      myTeam === "hunter" ? state.game.config.vision_hunter : state.game.config.vision_fugitive,
    );

    // Limites de la carte
    const [bx, by] = toPx(0, 0);
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(bx, by, map.w * s, map.h * s);

    // Cases
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ch = map.rows[y][x];
        const [px, py] = toPx(x, y);
        if (ch === "#") {
          ctx.fillStyle = COLORS.building;
          roundRect(ctx, px + 1.5, py + 1.5, s - 3, s - 3, Math.min(5, s / 6));
          ctx.fill();
        } else if (ch === "~") {
          ctx.save();
          ctx.beginPath();
          ctx.rect(px, py, s, s);
          ctx.clip();
          ctx.strokeStyle = "rgba(255,90,78,0.28)";
          ctx.lineWidth = 1;
          for (let k = -s; k < s; k += 6) {
            ctx.beginPath();
            ctx.moveTo(px + k, py + s);
            ctx.lineTo(px + k + s, py);
            ctx.stroke();
          }
          ctx.restore();
        } else {
          ctx.fillStyle = COLORS.dot;
          ctx.beginPath();
          ctx.arc(px + s / 2, py + s / 2, Math.max(1, s / 22), 0, Math.PI * 2);
          ctx.fill();
        }
        if (p.reachable?.has(key(x, y))) {
          ctx.fillStyle = "rgba(47,107,255,0.10)";
          ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
        }
      }
    }

    // Coordonnées
    if (p.showCoordinates && s >= 26) {
      ctx.fillStyle = COLORS.fogText;
      ctx.font = `${Math.round(s / 4)}px system-ui`;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (map.rows[y][x] !== ".") continue;
          const [px, py] = toPx(x, y);
          ctx.fillText(cellLabel(x, y), px + 3, py + s / 4 + 2);
        }
    }

    // Brouillard de guerre
    if (vision) {
      ctx.fillStyle = COLORS.fog;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (vision[y * map.w + x]) continue;
          const [px, py] = toPx(x, y);
          ctx.fillRect(px, py, s + 0.5, s + 0.5);
        }
    }

    // Cases bloquées (capacité Blocage)
    for (const e of state.effects) {
      if (e.expires_at <= now) continue;
      const [px, py] = toPx(e.x, e.y);
      ctx.strokeStyle = COLORS.warn;
      ctx.lineWidth = 2;
      roundRect(ctx, px + 3, py + 3, s - 6, s - 6, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + s * 0.3, py + s * 0.3);
      ctx.lineTo(px + s * 0.7, py + s * 0.7);
      ctx.moveTo(px + s * 0.7, py + s * 0.3);
      ctx.lineTo(px + s * 0.3, py + s * 0.7);
      ctx.stroke();
    }

    const enemyColor = COLORS[enemyOf(myTeam)];

    // Radar : secteurs/zones et caps
    if (state.radar && state.radar.expires_at > now) {
      const r = state.radar;
      const fade = Math.min(1, (r.expires_at - now) / 2500);
      for (const ct of r.contacts) {
        const rect = contactRect(ct);
        if (rect) {
          const [px, py] = toPx(rect.x, rect.y);
          ctx.fillStyle = hexA(enemyColor, 0.1 * fade);
          ctx.fillRect(px, py, rect.w * s, rect.h * s);
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = hexA(enemyColor, 0.7 * fade);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 0.75, py + 0.75, rect.w * s - 1.5, rect.h * s - 1.5);
          ctx.setLineDash([]);
        } else if ("dir" in ct && ct.dir !== "here") {
          const len = ct.band === "near" ? 3 : ct.band === "mid" ? 6 : 9;
          drawBearing(ctx, toPx(r.origin.x + 0.5, r.origin.y + 0.5), DIR_ANGLE[ct.dir], len * s, hexA(enemyColor, 0.85 * fade));
        }
      }
    }

    // Traqueur
    if (state.tracker?.dir && state.tracker.dir !== "here") {
      const t = state.tracker;
      const len = t.band === "near" ? 3 : t.band === "mid" ? 6 : 9;
      drawBearing(ctx, toPx(t.origin.x + 0.5, t.origin.y + 0.5), DIR_ANGLE[t.dir as Exclude<typeof t.dir, "here" | undefined>], len * s, hexA(COLORS.warn, 0.9));
    }

    // Révélations (Scan)
    for (const rv of state.reveals) {
      if (rv.expires_at <= now) continue;
      const [cxp, cyp] = toPx(rv.area.x + 0.5, rv.area.y + 0.5);
      ctx.strokeStyle = hexA(COLORS.volt, 0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cxp, cyp, (rv.area.r + 0.5) * s, 0, Math.PI * 2);
      ctx.stroke();
      for (const ct of rv.contacts) drawToken(ctx, toPx(ct.x, ct.y), s, enemyColor, { ring: COLORS.volt });
    }

    // Traces des coéquipiers
    for (const [u, trail] of Object.entries(state.trails)) {
      if (trail.length < 2 || !state.allies[u]) continue;
      ctx.strokeStyle = hexA(u === state.me.u ? COLORS.volt : COLORS[myTeam], 0.22);
      ctx.lineWidth = Math.max(1.5, s / 12);
      ctx.beginPath();
      trail.forEach((pt, i) => {
        const [px, py] = toPx(pt.x + 0.5, pt.y + 0.5);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // Prévisualisation de chemin
    if (p.path && p.path.length) {
      ctx.strokeStyle = COLORS.volt;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const [sx0, sy0] = toPx(state.me.x + 0.5, state.me.y + 0.5);
      ctx.moveTo(sx0, sy0);
      for (const pt of p.path) {
        const [px, py] = toPx(pt.x + 0.5, pt.y + 0.5);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const last = p.path[p.path.length - 1];
      const [lx, ly] = toPx(last.x, last.y);
      ctx.strokeStyle = COLORS.volt;
      ctx.lineWidth = 2;
      roundRect(ctx, lx + 2, ly + 2, s - 4, s - 4, 5);
      ctx.stroke();
    }

    // Ciblage d'une capacité
    if (p.target) {
      ctx.strokeStyle = hexA(COLORS.warn, 0.5);
      ctx.setLineDash([3, 3]);
      const r = p.target.range;
      const [tx, ty] = toPx(state.me.x - r, state.me.y - r);
      ctx.strokeRect(tx, ty, (2 * r + 1) * s, (2 * r + 1) * s);
      ctx.setLineDash([]);
      if (p.hover && p.target.radius) {
        ctx.fillStyle = hexA(COLORS.warn, 0.12);
        for (let dy = -p.target.radius; dy <= p.target.radius; dy++)
          for (let dx = -p.target.radius; dx <= p.target.radius; dx++) {
            if (!inRadius(dx, dy, p.target.radius)) continue;
            const [px, py] = toPx(p.hover.x + dx, p.hover.y + dy);
            ctx.fillRect(px, py, s, s);
          }
      }
    }

    // Adversaires visibles
    for (const v of state.visible) drawToken(ctx, toPx(v.x, v.y), s, enemyColor, {});

    // Coéquipiers (et tout le monde en fin de partie)
    for (const a of Object.values(state.allies)) {
      if (a.u === state.me.u) continue;
      const color = COLORS[a.team];
      drawToken(ctx, toPx(a.x, a.y), s, color, {
        alpha: a.status !== "active" ? 0.35 : a.ghost_until && a.ghost_until > now ? 0.5 : 1,
        cross: a.status === "captured",
        label: s >= 30 ? initials(state.players[a.u]?.username) : undefined,
      });
    }

    // Moi
    const meGhost = state.me.ghost_until && state.me.ghost_until > now;
    drawToken(ctx, toPx(state.me.x, state.me.y), s, COLORS[myTeam], {
      ring: COLORS.volt,
      alpha: state.me.status !== "active" ? 0.4 : meGhost ? 0.55 : 1,
      cross: state.me.status === "captured",
      big: true,
    });

    // Balayage sonar (seul mouvement orchestré)
    const sw = sweep.current;
    let animating = false;
    if (sw) {
      const t = (performance.now() - sw.start) / 1600;
      if (t < 1 && !document.documentElement.dataset.reducedMotion?.includes("true")) {
        const [px, py] = toPx(sw.x + 0.5, sw.y + 0.5);
        const radius = (0.1 + 0.9 * easeOut(t)) * Math.max(map.w, map.h) * s * 0.55;
        ctx.strokeStyle = hexA(sw.color, 0.55 * (1 - t));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.stroke();
        animating = true;
      } else sweep.current = null;
    }
    if (animating) frame.current = requestAnimationFrame(draw);
  }, []);

  const requestDraw = useCallback(() => {
    if (frame.current == null) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Nouvelle impulsion radar -> balayage
  useEffect(() => {
    const r = props.state.radar;
    if (r && r.i !== lastPulse.current) {
      lastPulse.current = r.i;
      sweep.current = { start: performance.now(), x: r.origin.x, y: r.origin.y, color: COLORS.volt };
    }
    requestDraw();
  });

  useImperativeHandle(ref, () => ({
    recenter: () => {
      cam.current.follow = true;
      requestDraw();
    },
    zoom: (f: number) => {
      cam.current.size = Math.min(72, Math.max(14, cam.current.size * f));
      requestDraw();
    },
  }));

  // Redimensionnement
  useEffect(() => {
    const ro = new ResizeObserver(() => requestDraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [requestDraw]);

  // Pointeurs : glisser = déplacer la vue ; toucher court = case ; pincer = zoom.
  useEffect(() => {
    const el = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; t: number; moved: boolean } | null = null;
    let pinchDist = 0;

    const cellFromEvent = (ev: PointerEvent | MouseEvent): Cell => {
      const rect = el.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      const c = cam.current;
      const x = Math.floor((ev.clientX - rect.left - W / 2) / c.size + c.cx);
      const y = Math.floor((ev.clientY - rect.top - H / 2) / c.size + c.cy);
      return { x, y };
    };

    const onDown = (ev: PointerEvent) => {
      el.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) down = { x: ev.clientX, y: ev.clientY, t: Date.now(), moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        if (down) down.moved = true;
      }
    };
    const onMove = (ev: PointerEvent) => {
      const prev = pointers.get(ev.pointerId);
      if (!prev) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const c = cam.current;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) c.size = Math.min(72, Math.max(14, c.size * (d / pinchDist)));
        pinchDist = d;
        requestDraw();
        return;
      }
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 8) down.moved = true;
      if (down?.moved) {
        c.follow = false;
        c.cx -= dx / c.size;
        c.cy -= dy / c.size;
        requestDraw();
      }
    };
    const onUp = (ev: PointerEvent) => {
      pointers.delete(ev.pointerId);
      if (down && !down.moved && pointers.size === 0) {
        const cell = cellFromEvent(ev);
        const map = propsRef.current.state.game.map;
        if (cell.x >= 0 && cell.y >= 0 && cell.x < map.w && cell.y < map.h) propsRef.current.onCellTap(cell);
      }
      if (pointers.size === 0) down = null;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const c = cam.current;
      c.size = Math.min(72, Math.max(14, c.size * (ev.deltaY < 0 ? 1.12 : 0.89)));
      requestDraw();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [requestDraw]);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 touch-none select-none">
      <canvas
        ref={canvasRef}
        className="block"
        role="img"
        aria-label={`Carte tactique, votre position ${cellLabel(props.state.me.x, props.state.me.y)}`}
      />
    </div>
  );
});

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawToken(
  ctx: CanvasRenderingContext2D,
  [px, py]: readonly [number, number],
  s: number,
  color: string,
  o: { ring?: string; alpha?: number; cross?: boolean; label?: string; big?: boolean },
) {
  const cx = px + s / 2;
  const cy = py + s / 2;
  const r = s * (o.big ? 0.33 : 0.28);
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.ring) {
    ctx.strokeStyle = o.ring;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  if (o.cross) {
    ctx.strokeStyle = "#050608";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy - r * 0.5);
    ctx.lineTo(cx + r * 0.5, cy + r * 0.5);
    ctx.moveTo(cx + r * 0.5, cy - r * 0.5);
    ctx.lineTo(cx - r * 0.5, cy + r * 0.5);
    ctx.stroke();
  }
  if (o.label) {
    ctx.fillStyle = "#050608";
    ctx.font = `600 ${Math.round(r * 0.9)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(o.label, cx, cy + 0.5);
  }
  ctx.restore();
}

function drawBearing(ctx: CanvasRenderingContext2D, [ox, oy]: readonly [number, number], angleDeg: number, len: number, color: string) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const ex = ox + Math.cos(a) * len;
  const ey = oy + Math.sin(a) * len;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  const h = 9;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(a - 0.45) * h, ey - Math.sin(a - 0.45) * h);
  ctx.lineTo(ex - Math.cos(a + 0.45) * h, ey - Math.sin(a + 0.45) * h);
  ctx.closePath();
  ctx.fill();
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function initials(name?: string) {
  return (name ?? "?").slice(0, 1).toUpperCase();
}
