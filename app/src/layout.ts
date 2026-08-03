// Deterministic initial placement by a spring-electrical (force-directed) model: every
// relationship — including function `calls` — is a spring pulling its two nodes together,
// and all nodes repel, so connected things cluster and unrelated groups drift apart. A
// final pass nudges any overlapping boxes off each other. Seeded from a fixed spiral and
// run for a fixed number of iterations, so the same scan always lays out the same way.
// The user rearranges from here; their positions are what get remembered.

import { dims } from "./geometry";
import type { Point, Seed } from "./model";

const GAP = 40; // desired clear gap between two connected boxes
const K_SPRING = 0.05; // edge attraction stiffness
const K_REP = 2600; // repulsion strength (size-aware)
const K_GRAV = 0.03; // pull toward the centroid so unconnected groups stay compact
const ITERS = 460;
const SEED_SPACING = 46;
const MARGIN = 60;

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

  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963; // golden-angle spiral spreads the seed evenly
    const rad = SEED_SPACING * Math.sqrt(i + 0.5);
    px[i] = rad * Math.cos(a);
    py[i] = rad * Math.sin(a);
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

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  let step = 60;
  for (let it = 0; it < ITERS; it++) {
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[i]! - px[j]!;
        let dy = py[i]! - py[j]!;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          d2 = 1;
          dx = 0.5;
          dy = 0.5;
        }
        const d = Math.sqrt(d2);
        const f = (K_REP * (r[i]! + r[j]!)) / d2;
        const ux = dx / d;
        const uy = dy / d;
        fx[i]! += ux * f;
        fy[i]! += uy * f;
        fx[j]! -= ux * f;
        fy[j]! -= uy * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = px[a]! - px[b]!;
      const dy = py[a]! - py[b]!;
      const d = Math.hypot(dx, dy) || 0.01;
      const rest = r[a]! + r[b]! + GAP;
      const f = K_SPRING * (d - rest);
      const ux = dx / d;
      const uy = dy / d;
      fx[a]! -= ux * f;
      fy[a]! -= uy * f;
      fx[b]! += ux * f;
      fy[b]! += uy * f;
    }
    // Gravity toward the centroid keeps the whole drawing compact.
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += px[i]!;
      cy += py[i]!;
    }
    cx /= n;
    cy /= n;
    for (let i = 0; i < n; i++) {
      fx[i]! += (cx - px[i]!) * K_GRAV;
      fy[i]! += (cy - py[i]!) * K_GRAV;
    }
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(fx[i]!, fy[i]!);
      if (m > step) {
        fx[i]! = (fx[i]! / m) * step;
        fy[i]! = (fy[i]! / m) * step;
      }
      px[i]! += fx[i]!;
      py[i]! += fy[i]!;
    }
    step = Math.max(2, step * 0.985);
  }

  resolveOverlaps(px, py, w, h, n);

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
