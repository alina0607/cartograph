// Deterministic initial placement. It only needs to be non-overlapping and stable —
// the user rearranges from here, and their positions are what get remembered.

import { dims } from "./geometry";
import type { Point, Seed } from "./model";

const GAP = 40;
const MAX_ROW = 1200;
const MARGIN = 40;

// Flow layout: boxes left-to-right, wrapping to a new row past MAX_ROW. Classes are
// grouped by module first so a file's types start out near each other.
export function initialPositions(seed: Seed): Record<string, Point> {
  const nodes = [...seed.nodes].sort((a, b) =>
    a.module === b.module ? a.key.localeCompare(b.key) : a.module.localeCompare(b.module),
  );
  const pos: Record<string, Point> = {};
  let x = MARGIN;
  let y = MARGIN;
  let rowH = 0;
  for (const node of nodes) {
    const d = dims(node);
    if (x > MARGIN && x + d.w > MAX_ROW) {
      x = MARGIN;
      y += rowH + GAP;
      rowH = 0;
    }
    pos[node.key] = { x, y }; // top-left anchor: collapsing shrinks downward, header stays put
    x += d.w + GAP;
    rowH = Math.max(rowH, d.h);
  }
  return pos;
}
