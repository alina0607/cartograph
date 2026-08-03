// Deterministic initial placement by a layered (Sugiyama-style) algorithm — the same family
// the professional UML tools use (PlantUML/Graphviz `dot`). Relationships that imply a
// direction give the drawing a top-down flow: a base class / interface sits above its
// subtypes, an owner above what it owns, a caller above what it calls. Each connected
// component is laid out on its own — assign nodes to layers by longest path, break cycles so
// the layers are well-defined, order within each layer to minimise crossings (barycenter
// sweeps over dummy nodes standing in for edges that span several layers), then place with
// parents centred over their children — and the finished components are packed side by side
// so unrelated subgraphs stay close instead of drifting apart. Cross-language (`contract`)
// links impose no vertical order; nodes with no directed relationship are gathered into a
// grid underneath. Fully deterministic. The user rearranges from here; their positions win.

import { dims } from "./geometry";
import type { Point, Seed } from "./model";

const RANK_GAP = 66; // vertical clearance between layers
const NODE_GAP = 44; // horizontal clearance between nodes in a layer
const VIRT_W = 22; // lane width reserved for an edge passing through a layer
const MARGIN = 60;
const COMPONENT_GAP = 84; // clearance between packed components
const LOOSE_GAP = 26; // spacing in the unrelated-nodes grid

// For a directed relationship, which endpoint belongs on the upper layer (or null for none).
function upperLower(kind: string, s: number, d: number): [number, number] | null {
  switch (kind) {
    case "inherits":
    case "implements":
      return [d, s]; // the base type sits above its subtype
    case "composition":
    case "aggregation":
    case "association":
    case "dependency":
    case "import":
    case "calls":
      return [s, d]; // the owner / caller sits above
    default:
      return null; // cross-language contract etc. impose no vertical order
  }
}

export function initialPositions(seed: Seed): Record<string, Point> {
  const order = [...seed.nodes].sort((a, b) => a.key.localeCompare(b.key));
  const n = order.length;
  if (n === 0) return {};

  const w = new Float64Array(n);
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = dims(order[i]!);
    w[i] = d.w;
    h[i] = d.h;
  }
  const index = new Map(order.map((nd, i) => [nd.key, i]));

  // Connected components over every relationship (so a whole hierarchy stays together), plus
  // the directed ranking edges that drive the top-down layering.
  const adjAll: number[][] = Array.from({ length: n }, () => []);
  const redges: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const rel of seed.relations) {
    const s = index.get(rel.src);
    const d = index.get(rel.dst);
    if (s === undefined || d === undefined || s === d) continue;
    adjAll[s]!.push(d);
    adjAll[d]!.push(s);
    const p = upperLower(rel.kind, s, d);
    if (!p) continue;
    const k = `${p[0]}>${p[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    redges.push(p);
  }
  const comp = components(adjAll, n);
  const members: number[][] = Array.from({ length: comp.count }, () => []);
  for (let i = 0; i < n; i++) members[comp.id[i]!]!.push(i);
  const compRedges: Array<Array<[number, number]>> = Array.from({ length: comp.count }, () => []);
  for (const e of redges) compRedges[comp.id[e[0]]!]!.push(e);

  // Lay out each multi-node component; single, unrelated nodes go to a grid at the end.
  interface Placed {
    keys: string[];
    xy: Point[]; // top-left, normalised so the component starts at (0,0)
    w: number;
    h: number;
  }
  const placed: Placed[] = [];
  const loose: number[] = [];
  for (let c = 0; c < comp.count; c++) {
    const memb = members[c]!;
    if (memb.length === 1) {
      loose.push(memb[0]!);
    } else {
      placed.push(layeredComponent(memb, compRedges[c]!, order, w, h));
    }
  }

  const pos: Record<string, Point> = {};
  const target = Math.max(700, ...placed.map((p) => p.w));
  const bottom = shelfPack(placed, target, COMPONENT_GAP, (p, x, y) => {
    for (let i = 0; i < p.keys.length; i++) {
      pos[p.keys[i]!] = { x: p.xy[i]!.x + x, y: p.xy[i]!.y + y };
    }
  });
  packLoose(loose, order, w, h, target, bottom, pos);

  // Normalise to a top-left margin.
  let ox = Infinity;
  let oy = Infinity;
  for (const k in pos) {
    ox = Math.min(ox, pos[k]!.x);
    oy = Math.min(oy, pos[k]!.y);
  }
  for (const k in pos) {
    pos[k] = { x: Math.round(pos[k]!.x - ox + MARGIN), y: Math.round(pos[k]!.y - oy + MARGIN) };
  }
  return pos;
}

// Layered layout of one connected component. Node indices are global; everything inside works
// in a local 0..m-1 space. Returns top-left positions normalised to (0,0) plus the bounds.
function layeredComponent(
  memb: number[],
  gedges: Array<[number, number]>,
  order: Seed["nodes"],
  w: Float64Array,
  h: Float64Array,
): { keys: string[]; xy: Point[]; w: number; h: number } {
  const m = memb.length;
  const g2l = new Map(memb.map((g, l) => [g, l]));
  const lw = new Float64Array(m);
  const lh = new Float64Array(m);
  for (let l = 0; l < m; l++) {
    lw[l] = w[memb[l]!]!;
    lh[l] = h[memb[l]!]!;
  }
  const edges: Array<[number, number]> = gedges.map(([u, v]) => [g2l.get(u)!, g2l.get(v)!]);

  const dag = removeCycles(edges, m);
  const rank = longestPathRanks(dag, m);
  const maxRank = rank.reduce((mx, r) => Math.max(mx, r), 0);

  // Layers with dummy nodes so every kept edge spans exactly one layer.
  const layers: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (let l = 0; l < m; l++) layers[rank[l]!]!.push(l);
  const up = new Map<number, number[]>();
  const down = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    (down.get(a) ?? down.set(a, []).get(a)!).push(b);
    (up.get(b) ?? up.set(b, []).get(b)!).push(a);
  };
  let vid = m;
  for (const [u, v] of dag) {
    let prev = u;
    for (let r = rank[u]! + 1; r < rank[v]!; r++) {
      const nvid = vid++;
      layers[r]!.push(nvid);
      link(prev, nvid);
      prev = nvid;
    }
    link(prev, v);
  }
  const width = (id: number): number => (id < m ? lw[id]! : VIRT_W);

  for (let iter = 0; iter < 8; iter++) {
    for (let r = 1; r <= maxRank; r++) barycenter(layers, r, layers[r - 1]!, up);
    for (let r = maxRank - 1; r >= 0; r--) barycenter(layers, r, layers[r + 1]!, down);
  }

  const X = new Float64Array(vid);
  for (const layer of layers) {
    let cursor = 0;
    for (const id of layer) {
      X[id] = cursor + width(id) / 2;
      cursor += width(id) + NODE_GAP;
    }
  }
  const desired = new Float64Array(vid);
  for (let pass = 0; pass < 14; pass++) {
    for (const layer of layers) {
      for (const id of layer) {
        const nb = [...(up.get(id) ?? []), ...(down.get(id) ?? [])];
        desired[id] = nb.length ? nb.reduce((s, x) => s + X[x]!, 0) / nb.length : X[id]!;
      }
      placeLayer(layer, X, desired, width);
    }
  }

  const centerY = new Float64Array(maxRank + 1);
  let top = 0;
  for (let r = 0; r <= maxRank; r++) {
    let bandH = 30;
    for (const id of layers[r]!) if (id < m) bandH = Math.max(bandH, lh[id]!);
    centerY[r] = top + bandH / 2;
    top += bandH + RANK_GAP;
  }

  const keys: string[] = [];
  const xy: Point[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let l = 0; l < m; l++) {
    const x = X[l]! - lw[l]! / 2;
    const y = centerY[rank[l]!]! - lh[l]! / 2;
    keys.push(order[memb[l]!]!.key);
    xy.push({ x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + lw[l]!);
    maxY = Math.max(maxY, y + lh[l]!);
  }
  for (const p of xy) {
    p.x -= minX;
    p.y -= minY;
  }
  return { keys, xy, w: maxX - minX, h: maxY - minY };
}

// Undirected connected components.
function components(adj: number[][], n: number): { id: Int32Array; count: number } {
  const id = new Int32Array(n).fill(-1);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (id[s] !== -1) continue;
    const q = [s];
    id[s] = count;
    for (let qi = 0; qi < q.length; qi++) {
      for (const v of adj[q[qi]!]!) if (id[v] === -1) ((id[v] = count), q.push(v));
    }
    count++;
  }
  return { id, count };
}

// Reorder one layer by the average position of each node's neighbours in the reference layer;
// nodes with no neighbour there keep their current slot. Stable, with an index tie-break.
function barycenter(
  layers: number[][],
  r: number,
  ref: number[],
  adj: Map<number, number[]>,
): void {
  const refPos = new Map(ref.map((id, i) => [id, i]));
  const cur = layers[r]!;
  const bary = cur.map((id, i) => {
    const nb = adj.get(id) ?? [];
    if (nb.length === 0) return i;
    let s = 0;
    for (const x of nb) s += refPos.get(x) ?? i;
    return s / nb.length;
  });
  const idx = cur.map((_, i) => i);
  idx.sort((a, b) => bary[a]! - bary[b]! || a - b);
  layers[r] = idx.map((i) => cur[i]!);
}

// Place a layer at the desired centres, left to right with minimum clearance, then shift the
// whole row so its mean matches the desired mean (keeps it from drifting sideways).
function placeLayer(
  layer: number[],
  X: Float64Array,
  desired: Float64Array,
  width: (id: number) => number,
): void {
  if (layer.length === 0) return;
  let prevRight = -Infinity;
  for (let i = 0; i < layer.length; i++) {
    const id = layer[i]!;
    const half = width(id) / 2;
    let cx = desired[id]!;
    const minCx = prevRight + NODE_GAP + half;
    if (i > 0 && cx < minCx) cx = minCx;
    X[id] = cx;
    prevRight = cx + half;
  }
  let sum = 0;
  let want = 0;
  for (const id of layer) {
    sum += X[id]!;
    want += desired[id]!;
  }
  const shift = (want - sum) / layer.length;
  for (const id of layer) X[id]! += shift;
}

// Drop back edges via an iterative depth-first traversal so the kept edges form a DAG.
function removeCycles(edges: Array<[number, number]>, n: number): Array<[number, number]> {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) adj[u]!.push(v);
  const color = new Uint8Array(n); // 0 white, 1 grey (on stack), 2 black
  const kept: Array<[number, number]> = [];
  const stack: Array<{ u: number; i: number }> = [];
  for (let start = 0; start < n; start++) {
    if (color[start] !== 0) continue;
    stack.push({ u: start, i: 0 });
    color[start] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      if (top.i >= adj[top.u]!.length) {
        color[top.u] = 2;
        stack.pop();
        continue;
      }
      const v = adj[top.u]![top.i++]!;
      if (color[v] === 1) continue; // back edge -> drop
      kept.push([top.u, v]);
      if (color[v] === 0) {
        color[v] = 1;
        stack.push({ u: v, i: 0 });
      }
    }
  }
  return kept;
}

// Longest-path layering: rank(v) = max(rank(u)+1) over kept edges u->v, sources at 0.
function longestPathRanks(dag: Array<[number, number]>, n: number): Int32Array {
  const outAdj: number[][] = Array.from({ length: n }, () => []);
  const inDeg = new Int32Array(n);
  for (const [u, v] of dag) {
    outAdj[u]!.push(v);
    inDeg[v]!++;
  }
  const rank = new Int32Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (inDeg[i] === 0) queue.push(i);
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi]!;
    for (const v of outAdj[u]!) {
      if (rank[v]! < rank[u]! + 1) rank[v] = rank[u]! + 1;
      if (--inDeg[v]! === 0) queue.push(v);
    }
  }
  return rank;
}

interface Sized {
  w: number;
  h: number;
}

// Left-to-right, top-to-bottom shelf packing; reports each item's slot via `place` and
// returns the y the next region can start at.
function shelfPack<T extends Sized>(
  items: T[],
  target: number,
  gap: number,
  place: (item: T, x: number, y: number) => void,
): number {
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > target) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    place(it, x, y);
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
  }
  return items.length ? y + rowH + gap : 0;
}

// Gather unrelated single nodes into a grid below the hierarchy.
function packLoose(
  loose: number[],
  order: Seed["nodes"],
  w: Float64Array,
  h: Float64Array,
  target: number,
  startY: number,
  pos: Record<string, Point>,
): void {
  let x = 0;
  let y = startY;
  let rowH = 0;
  for (const i of loose) {
    if (x > 0 && x + w[i]! > target) {
      y += rowH + LOOSE_GAP;
      x = 0;
      rowH = 0;
    }
    pos[order[i]!.key] = { x, y };
    x += w[i]! + LOOSE_GAP;
    rowH = Math.max(rowH, h[i]!);
  }
}
