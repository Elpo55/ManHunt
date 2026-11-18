/**
 * Géométrie de grille, chemins et brouillard de guerre (côté client).
 * Les règles (disque de vision, adjacence 4 directions) sont identiques à
 * celles du serveur ; le client ne s'en sert que pour l'affichage et la
 * prévisualisation. Toute action reste validée par le serveur.
 */
import type { Cell, MapData, MapEffect } from "./types";

export const DIRS4: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function cellAt(map: MapData, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return "#";
  return map.rows[y][x];
}

export function isWalkable(map: MapData, x: number, y: number, blocked?: ReadonlySet<string>): boolean {
  return cellAt(map, x, y) === "." && !(blocked?.has(key(x, y)) ?? false);
}

export function key(x: number, y: number): string {
  return `${x},${y}`;
}

/** Disque « roguelike » : dx² + dy² <= r² + r (identique à private.in_radius). */
export function inRadius(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy <= r * r + r;
}

export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function blockedSet(effects: readonly MapEffect[], now: number): Set<string> {
  const s = new Set<string>();
  for (const e of effects) if (e.kind === "blocked" && e.expires_at > now) s.add(key(e.x, e.y));
  return s;
}

/**
 * Plus court chemin (BFS, 4 directions) de `from` vers `to`.
 * Retourne la liste des cases à parcourir (sans la case de départ),
 * ou null si inatteignable.
 */
export function findPath(
  map: MapData,
  from: Cell,
  to: Cell,
  blocked?: ReadonlySet<string>,
  maxLen = 64,
): Cell[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!isWalkable(map, to.x, to.y, blocked)) return null;
  const w = map.w;
  const start = from.y * w + from.x;
  const goal = to.y * w + to.x;
  const prev = new Int32Array(map.w * map.h).fill(-1);
  const dist = new Int16Array(map.w * map.h).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (c === goal) break;
    if (dist[c] >= maxLen) continue;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny, blocked)) continue;
      const n = ny * w + nx;
      if (dist[n] !== -1) continue;
      dist[n] = dist[c] + 1;
      prev[n] = c;
      queue.push(n);
    }
  }
  if (dist[goal] === -1) return null;
  const path: Cell[] = [];
  for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % w, y: Math.floor(c / w) });
  return path.reverse();
}

/** Cases visibles par une équipe (union des disques de vision). */
export function visibilityMask(map: MapData, viewers: readonly Cell[], radius: number): Uint8Array {
  const mask = new Uint8Array(map.w * map.h);
  for (const v of viewers) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!inRadius(dx, dy, radius)) continue;
        const x = v.x + dx;
        const y = v.y + dy;
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        mask[y * map.w + x] = 1;
      }
    }
  }
  return mask;
}

/** Cases atteignables en au plus `steps` pas (pour surligner la portée). */
export function reachable(map: MapData, from: Cell, steps: number, blocked?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  if (steps <= 0) return out;
  const dist = new Map<string, number>([[key(from.x, from.y), 0]]);
  const queue: Cell[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const d = dist.get(key(c.x, c.y))!;
    if (d >= steps) continue;
    for (const [dx, dy] of DIRS4) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = key(nx, ny);
      if (dist.has(k) || !isWalkable(map, nx, ny, blocked)) continue;
      dist.set(k, d + 1);
      out.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return out;
}

/** Libellé de coordonnée lisible : colonne lettre + ligne (ex. « C7 »). */
export function cellLabel(x: number, y: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const col = x < 26 ? letters[x] : letters[Math.floor(x / 26) - 1] + letters[x % 26];
  return `${col}${y + 1}`;
}
