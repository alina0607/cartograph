// The data contract shared with the extractor (seed.json) plus the canvas overlay.

export interface SeedMethod {
  name: string;
  doc: string; // docstring, extracted from the source
  source: string; // the method's own source text, shown in the detail popup
}

export interface SeedNode {
  key: string;
  name: string;
  module: string;
  kind: string; // class | abstract | interface | struct
  lang: string; // python | typescript | go
  doc: string; // the class docstring
  attributes: [string, string][]; // [name, type]
  methods: SeedMethod[];
}

export interface SeedRelation {
  src: string;
  dst: string;
  kind: string; // inherits | implements | composition | aggregation | association | dependency | import
  lazy: boolean;
}

export interface Seed {
  version: number;
  nodes: SeedNode[];
  relations: SeedRelation[];
}

export interface Point {
  x: number;
  y: number;
}

// A box position is its CENTRE, so edge geometry is symmetric and box resizing
// (from a longer method name after a re-scan) keeps the box visually anchored.
export interface BoxOverlay {
  x: number;
  y: number;
}

// A line's curvature (offset of its handle from the straight midpoint, relative so it
// follows when either box moves) plus an optional per-line routing override.
export interface EdgeOverlay {
  bend: [number, number];
  mode?: "curved" | "orthogonal";
}

// Canvas viewport: world = screen translated by pan, scaled by zoom.
export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

// Free-floating canvas items the user adds — all in world coordinates.
export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface NoteItem extends Rect {
  text: string;
  color: string;
}
export interface ImageItem extends Rect {
  src: string; // data: URI
}
export interface GroupItem extends Rect {
  label: string;
}

export type ItemKind = "note" | "image" | "group";

export interface Overlay {
  boxes: Record<string, BoxOverlay>;
  edges: Record<string, EdgeOverlay>;
  collapsed: Record<string, boolean>; // keyed by node key; decoupled from box position
  view?: ViewState;
  notes: NoteItem[];
  images: ImageItem[];
  groups: GroupItem[];
  docNotes: Record<string, Point>; // per-class doc-note position override (keyed by node key)
  hideDocs?: boolean; // global toggle for the auto class-docstring notes
  hideFunctions?: boolean; // global toggle for standalone-function nodes + call edges
  edgeMode?: "curved" | "orthogonal"; // relationship line routing (default curved)
}

export type EdgeMode = "curved" | "orthogonal";

export function emptyOverlay(): Overlay {
  return { boxes: {}, edges: {}, collapsed: {}, notes: [], images: [], groups: [], docNotes: {} };
}

// A whole board: facts + the hand-made layer. This is what save/load reads and writes.
export interface CodeboardDoc {
  version: number;
  scope: string;
  seed: Seed;
  overlay: Overlay;
}
