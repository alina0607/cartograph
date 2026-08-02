// Edge identity and per-kind visual style.

import type { SeedRelation } from "./model";

// Stable key for an edge's overlay entry. Kind is part of the key because two classes
// can be joined by more than one relation (e.g. inherits AND association).
export function edgeKey(rel: SeedRelation): string {
  return `${rel.src}>${rel.dst}>${rel.kind}`;
}

export interface EdgeStyle {
  color: string;
  dash: string | null;
  markerStart: string | null; // marker id at the source (owner) end
  markerEnd: string | null; // marker id at the destination end
}

// Tuned for legibility on the light gradient canvas.
const PURPLE = "#7c5cf0";
const GOLD = "#d98324";
const GREEN = "#0f9d8f";
const SLATE = "#6b7280";

// Marker ids resolve to <marker> defs in render.ts. Colours are baked into each marker
// (no SVG2 context-stroke, which some engines drop — leaving hollow markers invisible).
export function edgeStyle(rel: SeedRelation): EdgeStyle {
  switch (rel.kind) {
    case "inherits":
      return { color: PURPLE, dash: null, markerStart: null, markerEnd: "m-tri" };
    case "implements":
      return { color: PURPLE, dash: "6 4", markerStart: null, markerEnd: "m-tri" };
    case "composition":
      return { color: GOLD, dash: null, markerStart: "m-diamond-fill", markerEnd: null };
    case "aggregation":
      return { color: GOLD, dash: null, markerStart: "m-diamond-open", markerEnd: null };
    case "association":
      return { color: GREEN, dash: null, markerStart: null, markerEnd: "m-arrow-green" };
    case "dependency":
    case "import":
      return {
        color: SLATE,
        dash: rel.lazy ? "2 4" : "6 4",
        markerStart: null,
        markerEnd: "m-arrow-slate",
      };
    case "contract":
      return { color: "#db2777", dash: "3 4", markerStart: null, markerEnd: null };
    default:
      return { color: SLATE, dash: null, markerStart: null, markerEnd: "m-arrow-slate" };
  }
}
