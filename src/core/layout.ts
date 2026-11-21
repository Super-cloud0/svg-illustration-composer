import type { CompositionItem, TemplateId, Variant } from './types';

export interface LayoutObject {
  key: string;
  variant: Variant;
  /** native size in L units (already multiplied by the size-set factor) */
  w: number;
  h: number;
}

export interface LayoutResult {
  scale: number;
  items: Omit<CompositionItem, 'uid'>[];
}

export const TEMPLATES: { id: TemplateId; name: string; hint: string }[] = [
  { id: 'title', name: 'Под заголовок', hint: 'Объекты внизу/справа, сверху слева — место для заголовка' },
  { id: 'offset', name: 'Со смещением', hint: 'Кластер смещён к краю и частично выходит за кадр' },
  { id: 'collected', name: 'Собранно', hint: 'Компактная группа по центру' },
];

// Isometric directions (30° axes), the way objects are stacked in the reference examples.
const C = Math.cos(Math.PI / 6);
const DIRS = {
  DR: [C, 0.5],
  UL: [-C, -0.5],
  DL: [-C, 0.5],
  UR: [C, -0.5],
  R: [1, 0],
  D: [0, 1],
} as const;
type Dir = keyof typeof DIRS;
const ORDERS: Dir[][] = [
  ['DR', 'UL', 'DL', 'UR', 'R'],
  ['DL', 'UR', 'DR', 'UL', 'D'],
  ['UR', 'DL', 'UL', 'DR', 'R'],
  ['UL', 'DR', 'UR', 'DL', 'D'],
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Deterministic PRNG so "shuffle" variants are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function halfExtent(b: Box, dx: number, dy: number) {
  return Math.abs(dx) * (b.w / 2) + Math.abs(dy) * (b.h / 2);
}

function overlapArea(a: Box, b: Box, shrink = 0.8) {
  const aw = (a.w * shrink) / 2,
    ah = (a.h * shrink) / 2,
    bw = (b.w * shrink) / 2,
    bh = (b.h * shrink) / 2;
  const ox = Math.min(a.x + aw, b.x + bw) - Math.max(a.x - aw, b.x - bw);
  const oy = Math.min(a.y + ah, b.y + bh) - Math.max(a.y - ah, b.y - bh);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/**
 * Arrange objects in unscaled space: the largest main object is the hero at
 * the origin, the others are attached along isometric diagonals with a
 * moderate overlap, then pushed apart if they cover each other too much.
 */
function arrange(objs: LayoutObject[], seed: number, template: TemplateId): Box[] {
  const rand = rng(seed);
  const order = ORDERS[seed % ORDERS.length];
  const boxes: Box[] = objs.map((o) => ({ x: 0, y: 0, w: o.w, h: o.h }));
  if (boxes.length === 0) return boxes;
  const hero = boxes[0];
  // In "title" the upper-left is reserved for the heading, so bg objects go right.
  const BG_ORDER: Dir[] = template === 'title' ? ['UR', 'DR', 'R'] : seed % 2 ? ['UR', 'UL', 'DL'] : ['UL', 'UR', 'DR'];
  let mi = 0,
    bi = 0;
  boxes.slice(1).forEach((b, i) => {
    const isBg = objs[i + 1].variant === 'bg';
    // Background variants peek out from behind (upper side), mains attach along diagonals.
    const [dx, dy] = DIRS[isBg ? BG_ORDER[bi++ % BG_ORDER.length] : order[mi++ % order.length]];
    const overlap = isBg ? 0.72 : 0.56 + rand() * 0.1; // < 1 => boxes overlap a bit
    const dist = (halfExtent(hero, dx, dy) + halfExtent(b, dx, dy)) * overlap;
    b.x = hero.x + dx * dist;
    b.y = hero.y + dy * dist;
  });
  // Relaxation: push apart non-hero pairs that cover each other too much.
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        const limit = 0.18 * Math.min(a.w * a.h, b.w * b.h);
        if (overlapArea(a, b) <= limit) continue;
        let vx = b.x - a.x,
          vy = b.y - a.y;
        const len = Math.hypot(vx, vy) || 1;
        vx /= len;
        vy /= len;
        const step = 0.04 * Math.max(b.w, b.h);
        if (i === 0) {
          b.x += vx * step;
          b.y += vy * step;
        } else {
          a.x -= (vx * step) / 2;
          a.y -= (vy * step) / 2;
          b.x += (vx * step) / 2;
          b.y += (vy * step) / 2;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return boxes;
}

function bounds(boxes: Box[]) {
  const x0 = Math.min(...boxes.map((b) => b.x - b.w / 2));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w / 2));
  const y0 = Math.min(...boxes.map((b) => b.y - b.h / 2));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h / 2));
  return { x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Target region (in canvas units) per template. */
function region(template: TemplateId, W: number, H: number, seed: number) {
  const landscape = W / H > 1.2;
  if (template === 'title') {
    return landscape
      ? { x: 0.42 * W, y: 0.14 * H, w: 0.6 * W, h: 0.9 * H } // may bleed a little over right/bottom edges
      : { x: 0.04 * W, y: 0.4 * H, w: 1.0 * W, h: 0.64 * H };
  }
  if (template === 'offset') {
    // Cluster bigger than the frame, shifted so it bleeds over one edge.
    const right = seed % 2 === 0;
    const w = 1.0 * W,
      h = 1.05 * H;
    const cx = (right ? 0.62 : 0.38) * W,
      cy = 0.55 * H;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  return { x: 0.07 * W, y: 0.08 * H, w: 0.86 * W, h: 0.84 * H };
}

export const MAX_SCALE = 1; // the designer's examples use objects at native size

/**
 * Auto-layout: returns a single scale factor for the whole composition and a
 * center position for each object. Background variants go to the back, larger
 * main objects behind smaller ones (like the reference compositions).
 */
export function autoLayout(objs: LayoutObject[], W: number, H: number, template: TemplateId, seed = 0): LayoutResult {
  if (objs.length === 0) return { scale: 0.5, items: [] };
  // Hero = largest main object; then other mains by size; bg objects last in arrangement.
  const indexed = objs.map((o, i) => ({ o, i }));
  const mains = indexed.filter((e) => e.o.variant === 'main').sort((a, b) => b.o.w * b.o.h - a.o.w * a.o.h);
  const bgs = indexed.filter((e) => e.o.variant === 'bg').sort((a, b) => b.o.w * b.o.h - a.o.w * a.o.h);
  const ordered = mains.length ? [...mains, ...bgs] : bgs;
  const boxes = arrange(
    ordered.map((e) => e.o),
    seed,
    template,
  );

  // Fit the cluster into the template region.
  // Background variants count with half their size: they may bleed, but stay visible.
  const fitBoxes = boxes.map((bx, k) => (ordered[k].o.variant === 'main' || !mains.length ? bx : { ...bx, w: bx.w / 2, h: bx.h / 2 }));
  const b = bounds(fitBoxes);
  const r = region(template, W, H, seed);
  const scale = Math.min(r.w / b.w, r.h / b.h, MAX_SCALE);
  const tx = r.x + r.w / 2 - b.cx * scale;
  let ty = r.y + r.h / 2 - b.cy * scale;
  if (template === 'title') ty = r.y + r.h - (b.y0 + b.h) * scale; // sit on the bottom of the region

  const placed = ordered.map((e, k) => ({
    key: e.o.key,
    variant: e.o.variant,
    x: round(tx + boxes[k].x * scale),
    y: round(ty + boxes[k].y * scale),
    rotation: 0,
    area: e.o.w * e.o.h,
  }));
  // Paint order: bg first, then mains from large to small.
  placed.sort((a, b2) => (a.variant === b2.variant ? b2.area - a.area : a.variant === 'bg' ? -1 : 1));
  return { scale: round(scale, 4), items: placed.map(({ area: _a, ...it }) => it) };
}

function round(n: number, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
