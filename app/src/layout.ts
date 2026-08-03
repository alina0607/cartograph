// Deterministic initial placement. Each connected component of the relationship graph is
// laid out on its own by a spring-electrical (force-directed) model — every relationship,
// including function `calls`, is a spring pulling its two nodes together while all nodes
// repel — then the components are packed into non-overlapping regions (multi-node graphs
// shelf-packed, lone nodes gathered into a tidy grid below). Separating components this way
// keeps unrelated subgraphs from crossing each other. Seeded from a fixed spiral and run for
// a fixed number of iterations, so the same scan always lays out the same way. The user
// rearranges from here; their positions are what get remembered.

import { dims } from "./geometry";
import type { Point, Seed } from "./model";

const GAP = 40; // desired clear gap between two connected boxes
const K_SPRING = 0.05; // edge attraction stiffness
const K_REP = 2600; // repulsion strength (size-aware)
const K_GRAV = 0.03; // pull toward the component centroid so it stays compact
const ITERS = 460;
const SEED_SPACING = 46;
const MARGIN = 60;
const COMPONENT_GAP = 90; // clear space between packed components
const SINGLE_GAP = 26; // tighter spacing for the lone-node grid

export function initialPositions(seed: Seed): Record<string, Point> {
  const order = [...seed.nodes].sort((a, b) => a.key.localeCompare(b.key));
  const n = order.length;
  if (n === 0) return {};

  const w = new Float64Array(n);
  const h = new Float64Array(n);
  const r = new Float64Array(n); // node "radius" = half its diagonal, so big boxes claim space
  for (let i = 0; i < n; i++) {
    const d = dims(order[i]!);
    w[i] = d.w;
    h[i] = d.h;
    r[i] = 0.5 * Math.hypot(d.w, d.h);
  }

  const index = new Map(order.map((nd, i) => [nd.key, i]));
  const edges: Array<[number, number]> = [];
  const seenEdge = new Set<string>();
  for (const e of seed.relations) {
    const a = index.get(e.src);
    const b = index.get(e.dst);
    if (a === undefined || b === undefined || a === b) continue;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    edges.push([a, b]);
  }

  // Connected components (undirected): lay each out on its own so unrelated subgraphs
  // never overlap or cross one another.
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  const comp = new Int32Array(n).fill(-1);
  let nc = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const queue = [s];
    comp[s] = nc;
    for (let qi = 0; qi < queue.length; qi++) {
      for (const nb of adj[queue[qi]!]!) {
        if (comp[nb] === -1) {
          comp[nb] = nc;
          queue.push(nb);
        }
      }
    }
    nc++;
  }
  const members: number[][] = Array.from({ length: nc }, () => []);
  for (let i = 0; i < n; i++) members[comp[i]!]!.push(i);
  const compEdges: Array<Array<[number, number]>> = Array.from({ length: nc }, () => []);
  for (const [a, b] of edges) compEdges[comp[a]!]!.push([a, b]);

  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let c = 0; c < nc; c++) simulateComponent(members[c]!, compEdges[c]!, w, h, r, px, py);

  packComponents(members, w, h, px, py);

  let minX = Infinity;
  let minY = Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i]! - w[i]! / 2);
    minY = Math.min(minY, py[i]! - h[i]! / 2);
  }
  const pos: Record<string, Point> = {};
  for (let i = 0; i < n; i++) {
    pos[order[i]!.key] = {
      x: Math.round(px[i]! - w[i]! / 2 - minX + MARGIN),
      y: Math.round(py[i]! - h[i]! / 2 - minY + MARGIN),
    };
  }
  return pos;
}

// Force-directed layout of one component, written into the global px/py (centred near 0).
function simulateComponent(
  memb: number[],
  cedges: Array<[number, number]>,
  w: Float64Array,
  h: Float64Array,
  r: Float64Array,
  px: Float64Array,
  py: Float64Array,
): void {
  const m = memb.length;
  if (m === 1) {
    px[memb[0]!] = 0;
    py[memb[0]!] = 0;
    return;
  }
  const g2l = new Map(memb.map((gi, li) => [gi, li]));
  const lx = new Float64Array(m);
  const ly = new Float64Array(m);
  const lw = new Float64Array(m);
  const lh = new Float64Array(m);
  const lr = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const gi = memb[k]!;
    lw[k] = w[gi]!;
    lh[k] = h[gi]!;
    lr[k] = r[gi]!;
    const a = k * 2.399963; // golden-angle spiral spreads the seed evenly
    const rad = SEED_SPACING * Math.sqrt(k + 0.5);
    lx[k] = rad * Math.cos(a);
    ly[k] = rad * Math.sin(a);
  }
  const le = cedges.map(([a, b]) => [g2l.get(a)!, g2l.get(b)!] as [number, number]);

  const fx = new Float64Array(m);
  const fy = new Float64Array(m);
  let step = 60;
  for (let it = 0; it < ITERS; it++) {
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        let dx = lx[i]! - lx[j]!;
        let dy = ly[i]! - ly[j]!;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          d2 = 1;
          dx = 0.5;
          dy = 0.5;
        }
        const d = Math.sqrt(d2);
        const f = (K_REP * (lr[i]! + lr[j]!)) / d2;
        const ux = dx / d;
        const uy = dy / d;
        fx[i]! += ux * f;
        fy[i]! += uy * f;
        fx[j]! -= ux * f;
        fy[j]! -= uy * f;
      }
    }
    for (const [a, b] of le) {
      const dx = lx[a]! - lx[b]!;
      const dy = ly[a]! - ly[b]!;
      const d = Math.hypot(dx, dy) || 0.01;
      const rest = lr[a]! + lr[b]! + GAP;
      const f = K_SPRING * (d - rest);
      const ux = dx / d;
      const uy = dy / d;
      fx[a]! -= ux * f;
      fy[a]! -= uy * f;
      fx[b]! += ux * f;
      fy[b]! += uy * f;
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < m; i++) {
      cx += lx[i]!;
      cy += ly[i]!;
    }
    cx /= m;
    cy /= m;
    for (let i = 0; i < m; i++) {
      fx[i]! += (cx - lx[i]!) * K_GRAV;
      fy[i]! += (cy - ly[i]!) * K_GRAV;
    }
    for (let i = 0; i < m; i++) {
      const mag = Math.hypot(fx[i]!, fy[i]!);
      if (mag > step) {
        fx[i]! = (fx[i]! / mag) * step;
        fy[i]! = (fy[i]! / mag) * step;
      }
      lx[i]! += fx[i]!;
      ly[i]! += fy[i]!;
    }
    step = Math.max(2, step * 0.985);
  }

  resolveOverlaps(lx, ly, lw, lh, m);
  for (let k = 0; k < m; k++) {
    px[memb[k]!] = lx[k]!;
    py[memb[k]!] = ly[k]!;
  }
}

interface CompBox {
  members: number[];
  minX: number;
  minY: number;
  w: number;
  h: number;
  slotX?: number; // assigned by shelfPack
  slotY?: number;
}

// Move each already-laid-out component into a non-overlapping slot: multi-node components
// are shelf-packed into rows, the lone nodes gathered into a compact grid beneath them.
function packComponents(
  members: number[][],
  w: Float64Array,
  h: Float64Array,
  px: Float64Array,
  py: Float64Array,
): void {
  const boxes: CompBox[] = members.map((memb) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const i of memb) {
      minX = Math.min(minX, px[i]! - w[i]! / 2);
      minY = Math.min(minY, py[i]! - h[i]! / 2);
      maxX = Math.max(maxX, px[i]! + w[i]! / 2);
      maxY = Math.max(maxY, py[i]! + h[i]! / 2);
    }
    return { members: memb, minX, minY, w: maxX - minX, h: maxY - minY };
  });

  const multi = boxes.filter((b) => b.members.length > 1).sort((a, b) => b.w * b.h - a.w * a.h);
  const singles = boxes.filter((b) => b.members.length === 1);

  const totalArea = boxes.reduce((s, b) => s + b.w * b.h, 0);
  const widest = boxes.reduce((mx, b) => Math.max(mx, b.w), 0);
  const target = Math.max(widest, Math.sqrt(totalArea) * 1.3, 700);

  const bottom = shelfPack(multi, target, COMPONENT_GAP, 0);
  shelfPack(singles, target, SINGLE_GAP, bottom > 0 ? bottom + COMPONENT_GAP : 0);

  for (const b of boxes) {
    const dx = b.slotX! - b.minX;
    const dy = b.slotY! - b.minY;
    for (const i of b.members) {
      px[i]! += dx;
      py[i]! += dy;
    }
  }
}

// Left-to-right, top-to-bottom shelf packing; records each box's slot and returns the
// y the next region can start at.
function shelfPack(items: CompBox[], target: number, gap: number, startY: number): number {
  let x = 0;
  let y = startY;
  let rowH = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > target) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    it.slotX = x;
    it.slotY = y;
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
  }
  return items.length ? y + rowH : startY;
}

// Push apart any pair of boxes whose axis-aligned rectangles overlap, along the smaller axis.
function resolveOverlaps(
  px: Float64Array,
  py: Float64Array,
  w: Float64Array,
  h: Float64Array,
  n: number,
): void {
  const pad = 18;
  for (let pass = 0; pass < 50; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ox = (w[i]! + w[j]!) / 2 + pad - Math.abs(px[i]! - px[j]!);
        const oy = (h[i]! + h[j]!) / 2 + pad - Math.abs(py[i]! - py[j]!);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const s = ((px[i]! < px[j]! ? -1 : 1) * ox) / 2;
          px[i]! += s;
          px[j]! -= s;
        } else {
          const s = ((py[i]! < py[j]! ? -1 : 1) * oy) / 2;
          py[i]! += s;
          py[j]! -= s;
        }
      }
    }
    if (!moved) break;
  }
}
