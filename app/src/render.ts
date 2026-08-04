// Build the whole scene as one SVG string. Full re-render on every change keeps the
// renderer stateless; interaction listeners live on the container, so replacing
// innerHTML never detaches them.

import {
  axis,
  borderPoint,
  busChannel,
  clearChannel,
  dims,
  edgeGeom,
  metrics,
  orthogonalGeom,
  type Box,
  type Lane,
} from "./geometry";
import { edgeKey, edgeStyle } from "./edge";
import { renderGroups, renderImages, renderNotes, wrap } from "./renderItems";
import type { Point, SeedNode , SeedRelation } from "./model";
import type { Store } from "./store";

const { LINE_H, TITLE_H, PAD } = metrics;

interface BoxKind {
  fill: string;
  stroke: string;
  ink: string; // title text
  ink2: string; // member / stereotype text
}
// Each UML kind gets its own colour so classes, abstracts, interfaces and structs are
// distinguishable at a glance (and tell apart from the rose doc-notes and yellow notes).
const BOX_KINDS: Record<string, BoxKind> = {
  class: { fill: "#ab9fd6", stroke: "#877ac0", ink: "#ffffff", ink2: "#efeafb" },
  abstract: { fill: "#cbc987", stroke: "#aeab63", ink: "#33320c", ink2: "#4b4820" },
  interface: { fill: "#a0cdc5", stroke: "#77b2a8", ink: "#14352f", ink2: "#274d45" },
  struct: { fill: "#aabfe0", stroke: "#7f9fca", ink: "#16304f", ink2: "#2b476b" },
  // Functions are neutral grey so they read as a different layer from the coloured types.
  function: { fill: "#aeb3bd", stroke: "#8b909c", ink: "#232630", ink2: "#3a3d47" },
};

// Language is a second visual channel (box colour already encodes the UML kind): a coloured
// left stripe on every box plus a short tag, so Python / TypeScript / Go tell apart at a
// glance and mixed-language scans are readable.
export const LANG_STYLE: Record<string, { tag: string; color: string; label: string }> = {
  python: { tag: "py", color: "#2b6cb0", label: "Python" },
  typescript: { tag: "ts", color: "#d97706", label: "TypeScript" },
  go: { tag: "go", color: "#0e9aa7", label: "Go" },
};

export function renderScene(store: Store): string {
  const showFns = store.showFunctions();
  const visible = store.seed.nodes.filter((n) => showFns || n.kind !== "function");
  const boxes = new Map<string, Box>();
  const collapsedOf = new Map<string, boolean>();
  for (const node of visible) {
    const collapsed = store.isCollapsed(node.key);
    collapsedOf.set(node.key, collapsed);
    const d = dims(node, collapsed);
    const a = store.boxPos(node.key); // top-left anchor -> centre for edge geometry
    boxes.set(node.key, { cx: a.x + d.w / 2, cy: a.y + d.h / 2, w: d.w, h: d.h });
  }

  // Edges leaving the same box in the same direction share a corridor, so their turns must be
  // spread across it. Grouping by (source, axis, sign) is what a reader perceives as "one fan":
  // the four children of a class, not every edge in the diagram.
  const corridor = (rel: SeedRelation): string | null => {
    const s = boxes.get(rel.src);
    const d = boxes.get(rel.dst);
    if (!s || !d) return null;
    // Same axis decision the geometry will make. Deciding it independently here put edges in a
    // corridor they do not actually travel down, so their lanes were spread along the wrong side.
    const a = axis(s, d);
    const sign = Math.sign(a === "h" ? d.cx - s.cx : d.cy - s.cy);
    return `${rel.src}|${a}|${sign}`;
  };
  // Within a corridor, the edges of ONE kind are drawn as one bus: they share a lane, so their
  // stem and trunk coincide and the fan reads as a single line that branches at the turn. Kinds
  // stay apart because they are drawn in different colours and styles — a shared trunk could only
  // show one of them. So a corridor holds as many lanes as it has kinds, not as it has edges.
  const buses = new Map<string, SeedRelation[]>();
  for (const rel of store.seed.relations) {
    const c = corridor(rel);
    if (c) {
      const k = `${c}|${rel.kind}`;
      buses.set(k, [...(buses.get(k) ?? []), rel]);
    }
  }
  const byCorridor = new Map<string, SeedRelation[][]>();
  for (const [k, rels] of buses) {
    const c = k.slice(0, k.lastIndexOf("|"));
    byCorridor.set(c, [...(byCorridor.get(c) ?? []), rels]);
  }

  const lanes = new Map<string, Lane>();
  const near = (rels: SeedRelation[]): number =>
    Math.min(...rels.map((r) => boxes.get(r.dst)!.cx));
  for (const [, group] of byCorridor) {
    // Ordered by where the nearest far end sits, so lane order matches what the eye expects and a
    // re-render never reshuffles them.
    const ordered = [...group].sort((a, b) => near(a) - near(b));
    ordered.forEach((rels, index) => {
      const src = boxes.get(rels[0]!.src)!;
      const dsts = rels.map((r) => boxes.get(r.dst)!);
      const own = new Set([rels[0]!.src, ...rels.map((r) => r.dst)]);
      const others = [...boxes].filter(([k]) => !own.has(k)).map(([, b]) => b);
      const channel = busChannel(src, dsts, others);
      if (channel) {
        const lane = { index, count: ordered.length, channel };
        for (const rel of rels) lanes.set(edgeKey(rel), lane); // one lane -> one trunk
        return;
      }
      // No band clears every destination at once. Rather than draw a trunk through a box, fall
      // back to what the bus replaced: each edge turns in its own pairwise-clear band.
      const spread = [...rels].sort((a, b) => boxes.get(a.dst)!.cx - boxes.get(b.dst)!.cx);
      spread.forEach((rel, i) =>
        lanes.set(edgeKey(rel), {
          index: i,
          count: spread.length,
          channel: clearChannel(
            src,
            boxes.get(rel.dst)!,
            [...boxes].filter(([k]) => k !== rel.src && k !== rel.dst).map(([, b]) => b),
          ),
        }),
      );
    });
  }

  const edgeParts: string[] = [];
  const handleParts: string[] = [];
  for (const rel of store.seed.relations) {
    const src = boxes.get(rel.src);
    const dst = boxes.get(rel.dst);
    if (!src || !dst) continue;
    const key = edgeKey(rel);
    const bend = store.edgeBend(key);
    const geom =
      store.edgeModeFor(key) === "orthogonal"
        ? orthogonalGeom(src, dst, bend, lanes.get(key))
        : edgeGeom(src, dst, bend);
    const st = edgeStyle(rel);
    const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : "";
    edgeParts.push(
      `<path d="${geom.path}" fill="none" stroke="${st.color}" stroke-width="1.8"${dash}/>`,
    );
    if (st.markerEnd) edgeParts.push(decoration(st.markerEnd, geom.p1, geom.dirEnd, st.color));
    if (st.markerStart) edgeParts.push(decoration(st.markerStart, geom.p0, geom.dirStart, st.color));
    handleParts.push(
      `<circle class="eh" data-edge="${attr(key)}" cx="${round(geom.handle.x)}" cy="${round(
        geom.handle.y,
      )}" r="5"/>`,
    );
  }

  const boxParts = visible.map((n) => renderBox(n, boxes.get(n.key)!, collapsedOf.get(n.key)!));

  // Auto class-docstring notes: a distinct card dashed-linked to its class.
  const docParts: string[] = [];
  if (store.showDocs()) {
    for (const node of visible) {
      if (node.doc) docParts.push(docNote(node, boxes.get(node.key)!, store));
    }
  }

  // The SVG fills the container; a single #world group carries pan/zoom, so every child
  // stays in world coordinates and getScreenCTM() on #world maps screen<->world for drags.
  const b = bounds([...boxes.values()], handleParts.length ? extractHandleXY(handleParts) : []);
  const view = store.ensureView({ panX: -b.minX, panY: -b.minY, zoom: 1 });

  return (
    `<svg id="scene" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">` +
    defs() +
    `<g id="world" transform="translate(${round(view.panX)} ${round(view.panY)}) ` +
    `scale(${round(view.zoom)})">` +
    renderGroups(store) + // behind the classes
    renderImages(store) +
    edgeParts.join("") +
    boxParts.join("") +
    docParts.join("") + // class docstring cards, linked to their class
    handleParts.join("") +
    renderNotes(store) + // sticky notes sit on top
    `</g></svg>`
  );
}

function renderBox(node: SeedNode, box: Box, collapsed: boolean): string {
  const d = dims(node, collapsed);
  const x0 = box.cx - d.w / 2;
  const y0 = box.cy - d.h / 2;
  const kind = BOX_KINDS[node.kind] ?? BOX_KINDS.class!;
  const lang = LANG_STYLE[node.lang];
  if (node.kind === "function") {
    return (
      `<g class="nd" data-key="${attr(node.key)}">` +
      `<rect x="${round(x0)}" y="${round(y0)}" width="${d.w}" height="${round(d.h)}" rx="9" ` +
      `fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1.1" filter="url(#cardshadow)"/>` +
      langStripe(x0, y0, d.h, lang) +
      centerText(box.cx, y0 + 17, d.title, kind.ink, false, 12) +
      `</g>`
    );
  }
  const parts: string[] = [
    `<rect x="${round(x0)}" y="${round(y0)}" width="${d.w}" height="${round(d.h)}" rx="12" ` +
      `fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1.2" ` +
      `filter="url(#cardshadow)"/>`,
    langStripe(x0, y0, d.h, lang),
    langBadge(x0 + d.w, y0, lang),
  ];
  let cy = y0;
  if (d.stereotype) {
    parts.push(centerText(box.cx, cy + 12, d.stereotype, kind.ink2, false, 10.5));
    cy += LINE_H;
  }
  // Chevron signals (and, via a header click, toggles) collapse.
  parts.push(leftText(x0 + 7, cy + 16, collapsed ? "▸" : "▾", kind.ink2));
  parts.push(centerText(box.cx, cy + 16, d.title, kind.ink, d.italic, 12.5, true));
  cy += TITLE_H;

  if (collapsed) {
    parts.push(sep(x0, cy, d.w, kind.stroke));
    cy += PAD;
    parts.push(centerText(box.cx, cy + 11, d.hint, kind.ink2, false, 11));
    return `<g class="nd" data-key="${attr(node.key)}">${parts.join("")}</g>`;
  }

  parts.push(sep(x0, cy, d.w, kind.stroke));
  cy += PAD;
  for (const a of d.attrs) {
    parts.push(leftText(x0 + PAD, cy + 11, a, kind.ink2));
    cy += LINE_H;
  }
  parts.push(sep(x0, cy, d.w, kind.stroke));
  cy += PAD;
  for (const m of d.methods) {
    // Whole row is a click target that opens the method's doc/source popup.
    parts.push(
      `<g class="mrow" data-key="${attr(node.key)}" data-method="${attr(m.name)}">` +
        `<rect x="${round(x0 + 2)}" y="${round(cy)}" width="${round(d.w - 4)}" height="${LINE_H}" ` +
        `rx="3" fill="transparent"/>` +
        leftText(x0 + PAD, cy + 11, m.label, kind.ink2) +
        `</g>`,
    );
    cy += LINE_H;
  }
  return `<g class="nd" data-key="${attr(node.key)}">${parts.join("")}</g>`;
}

function docNote(node: SeedNode, box: Box, store: Store): string {
  const W = 220;
  const P = 10;
  const LH = 17;
  const lines = wrap(node.doc, W - P * 2);
  const h = Math.max(38, P * 2 + lines.length * LH);
  // Default above the class (fewer collisions than to the side in a row layout).
  const pos = store.docNotePos(node.key) ?? { x: box.cx - W / 2, y: box.cy - box.h / 2 - h - 26 };
  const { x, y } = pos;
  const noteBox = { cx: x + W / 2, cy: y + h / 2, w: W, h };
  const p0 = borderPoint(box, { x: noteBox.cx, y: noteBox.cy }); // border of the class
  const p1 = borderPoint(noteBox, { x: box.cx, y: box.cy }); // border of the card
  const conn =
    `<line x1="${round(p0.x)}" y1="${round(p0.y)}" x2="${round(p1.x)}" y2="${round(p1.y)}" ` +
    `stroke="#bd7676" stroke-width="1.2" stroke-dasharray="5 4"/>`;
  const texts = lines
    .map((ln, i) => leftText(x + P + 4, y + P + 12 + i * LH, ln, "#fff1f0"))
    .join("");
  return (
    conn +
    `<g class="docnote" data-key="${attr(node.key)}">` +
    `<rect x="${round(x)}" y="${round(y)}" width="${W}" height="${round(h)}" rx="8" ` +
    `fill="#c98787" stroke="#aa6a6a" filter="url(#cardshadow)"/>` +
    `<rect x="${round(x)}" y="${round(y)}" width="4" height="${round(h)}" rx="2" fill="#8f4f4f"/>` +
    texts +
    `</g>`
  );
}

type Lang = (typeof LANG_STYLE)[string] | undefined;

// A coloured left stripe marking the source language (rounded to sit inside the card corner).
function langStripe(x0: number, y0: number, h: number, lang: Lang): string {
  if (!lang) return "";
  return `<rect x="${round(x0)}" y="${round(y0 + 2)}" width="4.5" height="${round(h - 4)}" rx="2.2" fill="${lang.color}"/>`;
}

// A small py/ts/go pill in the top-right of a type box.
function langBadge(xRight: number, yTop: number, lang: Lang): string {
  if (!lang) return "";
  const bw = 20;
  const bh = 13;
  const x = xRight - bw - 7;
  const y = yTop + 6;
  return (
    `<rect x="${round(x)}" y="${round(y)}" width="${bw}" height="${bh}" rx="6" fill="${lang.color}" fill-opacity="0.92"/>` +
    `<text x="${round(x + bw / 2)}" y="${round(y + 9.6)}" text-anchor="middle" font-size="9" fill="#ffffff" style="font-weight:600">${lang.tag}</text>`
  );
}

function sep(x: number, y: number, w: number, color: string): string {
  return `<line x1="${round(x)}" y1="${round(y)}" x2="${round(x + w)}" y2="${round(
    y,
  )}" stroke="${color}" stroke-opacity="0.4" stroke-width="1"/>`;
}

function centerText(
  x: number,
  y: number,
  text: string,
  color: string,
  italic: boolean,
  size = 12,
  bold = false,
): string {
  const style = `${italic ? "font-style:italic;" : ""}${bold ? "font-weight:600;" : ""}`;
  return `<text x="${round(x)}" y="${round(y)}" text-anchor="middle" font-size="${size}" fill="${color}" style="${style}">${esc(
    text,
  )}</text>`;
}

function leftText(x: number, y: number, text: string, color: string): string {
  return `<text x="${round(x)}" y="${round(y)}" fill="${color}">${esc(text)}</text>`;
}

function defs(): string {
  // Clean white cards with a whisper of pink, lifted by a soft neutral shadow.
  const cardGrad =
    `<linearGradient id="card" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fdf2f7"/></linearGradient>`;
  const shadow =
    `<filter id="cardshadow" x="-25%" y="-25%" width="150%" height="150%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#8b6fae" flood-opacity="0.16"/></filter>`;
  return `<defs>${cardGrad}${shadow}</defs>`;
}

// Endpoint markers are drawn explicitly (not via <marker>) so they are always visible
// and correctly oriented, in both curved and orthogonal routing. `dir` points along the
// line at that endpoint. Ids match edgeStyle: m-tri, m-arrow-*, m-diamond-fill/open.
function decoration(id: string, pt: Point, dir: Point, color: string): string {
  const px = -dir.y;
  const py = dir.x; // perpendicular
  if (id === "m-tri") {
    const L = 14;
    const W = 7.5;
    const b = { x: pt.x - dir.x * L, y: pt.y - dir.y * L };
    return poly(
      [pt, { x: b.x + px * W, y: b.y + py * W }, { x: b.x - px * W, y: b.y - py * W }],
      "#fff",
      color,
      1.5,
    );
  }
  if (id.startsWith("m-arrow")) {
    const L = 12;
    const W = 6.5;
    const b = { x: pt.x - dir.x * L, y: pt.y - dir.y * L };
    const a1 = { x: b.x + px * W, y: b.y + py * W };
    const a2 = { x: b.x - px * W, y: b.y - py * W };
    return (
      `<path d="M ${round(a1.x)} ${round(a1.y)} L ${round(pt.x)} ${round(pt.y)} ` +
      `L ${round(a2.x)} ${round(a2.y)}" fill="none" stroke="${color}" stroke-width="1.9"/>`
    );
  }
  if (id === "m-diamond-fill" || id === "m-diamond-open") {
    const Ld = 17;
    const Wd = 7.5;
    const back = { x: pt.x + dir.x * Ld, y: pt.y + dir.y * Ld };
    const mid = { x: pt.x + dir.x * (Ld / 2), y: pt.y + dir.y * (Ld / 2) };
    const fill = id === "m-diamond-fill" ? color : "#fff";
    return poly(
      [pt, { x: mid.x + px * Wd, y: mid.y + py * Wd }, back, { x: mid.x - px * Wd, y: mid.y - py * Wd }],
      fill,
      color,
      1.4,
    );
  }
  return "";
}

function poly(pts: Point[], fill: string, stroke: string, sw: number): string {
  const p = pts.map((q) => `${round(q.x)},${round(q.y)}`).join(" ");
  return `<polygon points="${p}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
function bounds(boxes: Box[], extra: { x: number; y: number }[]): Bounds {
  const M = 120;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.cx - b.w / 2);
    minY = Math.min(minY, b.cy - b.h / 2);
    maxX = Math.max(maxX, b.cx + b.w / 2);
    maxY = Math.max(maxY, b.cy + b.h / 2);
  }
  for (const p of extra) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  return { minX: minX - M, minY: minY - M, maxX: maxX + M, maxY: maxY + M };
}

function extractHandleXY(handles: string[]): { x: number; y: number }[] {
  return handles.map((h) => {
    const cx = Number(/cx="([\d.-]+)"/.exec(h)?.[1] ?? 0);
    const cy = Number(/cy="([\d.-]+)"/.exec(h)?.[1] ?? 0);
    return { x: cx, y: cy };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
