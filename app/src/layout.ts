// Deterministic initial placement. It only needs to be readable and stable — the user
// rearranges from here, and their positions are what get remembered.
//
// Two zones keep a scan legible: class-like types up top in a roomy flow (with tall row
// gaps so each type's doc-note card has clearance above it), and standalone functions
// packed into a tighter grid below, so 40 small pills never crowd the classes.

import { dims } from "./geometry";
import type { Point, Seed, SeedNode } from "./model";

const MARGIN = 60;
const MAX_ROW = 1500;
const TOP_MARGIN = 150; // room for the first row's doc-note cards
const CLASS_COL_GAP = 56;
const CLASS_ROW_GAP = 150; // room above each row for doc-note cards
const FN_COL_GAP = 22;
const FN_ROW_GAP = 40;
const ZONE_GAP = 100; // between the class zone and the function zone

export function initialPositions(seed: Seed): Record<string, Point> {
  const byModule = (a: SeedNode, b: SeedNode) =>
    a.module === b.module ? a.key.localeCompare(b.key) : a.module.localeCompare(b.module);
  const classes = seed.nodes.filter((n) => n.kind !== "function").sort(byModule);
  const functions = seed.nodes.filter((n) => n.kind === "function").sort(byModule);

  const pos: Record<string, Point> = {};
  const classBottom = flow(classes, TOP_MARGIN, CLASS_COL_GAP, CLASS_ROW_GAP, pos);
  flow(functions, classBottom + ZONE_GAP, FN_COL_GAP, FN_ROW_GAP, pos);
  return pos;
}

// Places `nodes` left-to-right, wrapping past MAX_ROW; returns the bottom y of the block.
function flow(
  nodes: SeedNode[],
  startY: number,
  colGap: number,
  rowGap: number,
  pos: Record<string, Point>,
): number {
  let x = MARGIN;
  let y = startY;
  let rowH = 0;
  for (const node of nodes) {
    const d = dims(node);
    if (x > MARGIN && x + d.w > MAX_ROW) {
      x = MARGIN;
      y += rowH + rowGap;
      rowH = 0;
    }
    pos[node.key] = { x, y }; // top-left anchor
    x += d.w + colGap;
    rowH = Math.max(rowH, d.h);
  }
  return y + rowH;
}
