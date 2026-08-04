// Document state = seed (facts) + overlay (the user's layout), plus persistence.
// The renderer reads it; interactions mutate it. Storage lives ONLY here, so moving
// from localStorage to a server (or IndexedDB, once images arrive) is a change to
// this file and nowhere else.

import {
  emptyOverlay,
  type CodeboardDoc,
  type GroupItem,
  type ImageItem,
  type ItemKind,
  type NoteItem,
  type Overlay,
  type Point,
  type Rect,
  type Seed,
  type ViewState,
} from "./model";
import { initialPositions } from "./layout";

const STORAGE_PREFIX = "cartograph.doc.v1:";
const NOTE_COLOR = "#f4d774";

export interface Selection {
  kind: ItemKind;
  id: string;
}

export class Store {
  readonly seed: Seed;
  readonly scope: string;
  private readonly key: string; // storage key; scoped per folder so layouts never collide
  private overlay: Overlay;
  private base: Record<string, Point>; // layout fallback for un-moved boxes
  private saveTimer: number | null = null;
  private sel: Selection | null = null; // transient (not persisted)

  constructor(seed: Seed, scope = "default") {
    this.seed = seed;
    this.scope = scope;
    this.key = STORAGE_PREFIX + scope;
    this.overlay = loadOverlay(this.key);
    this.base = this.layoutForVisible();
  }

  // Layout is computed over the nodes that will actually be DRAWN. Ranking the hidden ones too
  // leaves their slots empty: the remaining boxes keep positions chosen around 143 invisible
  // neighbours, so the board reads as scattered and every edge spans a hole. Recomputed whenever
  // visibility changes — the layered ranks only mean anything for the graph on screen.
  private layoutForVisible(): Record<string, Point> {
    if (this.showFunctions()) return initialPositions(this.seed);
    const nodes = this.seed.nodes.filter((n) => n.kind !== "function");
    const keep = new Set(nodes.map((n) => n.key));
    return initialPositions({
      ...this.seed,
      nodes,
      relations: this.seed.relations.filter((r) => keep.has(r.src) && keep.has(r.dst)),
    });
  }

  // The box's top-left anchor. Anchoring at the corner (not the centre) keeps the
  // header fixed when a class collapses/expands and its height changes.
  boxPos(key: string): Point {
    return this.overlay.boxes[key] ?? this.base[key] ?? { x: 0, y: 0 };
  }

  setBoxPos(key: string, p: Point): void {
    this.overlay.boxes[key] = { x: Math.round(p.x), y: Math.round(p.y) };
    this.scheduleSave();
  }

  edgeBend(key: string): [number, number] {
    return this.overlay.edges[key]?.bend ?? [0, 0];
  }

  setEdgeBend(key: string, bend: [number, number]): void {
    const prev = this.overlay.edges[key];
    this.overlay.edges[key] = { ...prev, bend: [Math.round(bend[0]), Math.round(bend[1])] };
    this.scheduleSave();
  }

  // Effective routing for one line: its own override, else the global default.
  edgeModeFor(key: string): "curved" | "orthogonal" {
    return this.overlay.edges[key]?.mode ?? this.edgeMode();
  }

  toggleEdgeModeFor(key: string): void {
    const next = this.edgeModeFor(key) === "curved" ? "orthogonal" : "curved";
    const prev = this.overlay.edges[key];
    this.overlay.edges[key] = { bend: prev?.bend ?? [0, 0], mode: next };
    this.scheduleSave();
  }

  // The viewport, initialised on first use so the content starts framed near the top-left.
  ensureView(fit: ViewState): ViewState {
    if (!this.overlay.view) {
      this.overlay.view = fit;
      this.scheduleSave();
    }
    return this.overlay.view;
  }

  setView(v: ViewState): void {
    this.overlay.view = v;
    this.scheduleSave();
  }

  view(): ViewState {
    return this.overlay.view ?? { panX: 0, panY: 0, zoom: 1 };
  }

  // Whether this scope loaded with a remembered viewport (so a fresh scan can auto-fit,
  // while a board the user already framed is left as they left it).
  hasSavedView(): boolean {
    return this.overlay.view !== undefined;
  }

  edgeMode(): "curved" | "orthogonal" {
    // 90° is the default. The layout is layered, so a right-angle run can be placed in the clear
    // band between two ranks and provably misses every box; a curve aimed at the midpoint has no
    // such guarantee and, on a dense board, crosses whatever happens to sit between its ends.
    return this.overlay.edgeMode ?? "orthogonal";
  }
  toggleEdgeMode(): void {
    this.overlay.edgeMode = this.edgeMode() === "curved" ? "orthogonal" : "curved";
    this.scheduleSave();
  }

  // Functions are hidden until asked for. A repo written as module-level functions over frozen
  // data — which is the common shape — has two to three times as many functions as types, and
  // three times as many call edges as type relations, so showing them first buries the
  // architecture the reader opened the board to see.
  showFunctions(): boolean {
    return this.overlay.showFunctions === true;
  }
  toggleFunctions(): void {
    this.overlay.showFunctions = !this.showFunctions();
    this.base = this.layoutForVisible(); // ranks are only meaningful for the visible graph
    this.scheduleSave();
  }

  // Auto class-docstring notes: a global on/off, plus a per-class position override. Off first:
  // a docstring card carries a paragraph, and a screenful of paragraphs hides the boxes.
  showDocs(): boolean {
    return this.overlay.showDocs === true;
  }
  toggleDocs(): void {
    this.overlay.showDocs = !this.showDocs();
    this.scheduleSave();
  }
  docNotePos(key: string): Point | null {
    return this.overlay.docNotes[key] ?? null;
  }
  setDocNotePos(key: string, p: Point): void {
    this.overlay.docNotes[key] = { x: Math.round(p.x), y: Math.round(p.y) };
    this.scheduleSave();
  }

  isCollapsed(key: string): boolean {
    return this.overlay.collapsed[key] ?? false;
  }

  toggleCollapse(key: string): void {
    if (this.overlay.collapsed[key]) delete this.overlay.collapsed[key];
    else this.overlay.collapsed[key] = true;
    this.scheduleSave();
  }

  // --- canvas items (notes / images / groups) --------------------------------------------
  notes(): NoteItem[] {
    return this.overlay.notes;
  }
  images(): ImageItem[] {
    return this.overlay.images;
  }
  groups(): GroupItem[] {
    return this.overlay.groups;
  }

  addNote(x: number, y: number): string {
    const item: NoteItem = { id: uid(), x, y, w: 180, h: 120, text: "", color: NOTE_COLOR };
    this.overlay.notes.push(item);
    this.sel = { kind: "note", id: item.id };
    this.scheduleSave();
    return item.id;
  }

  addGroup(x: number, y: number): string {
    const item: GroupItem = { id: uid(), x, y, w: 320, h: 240, label: "group" };
    this.overlay.groups.push(item);
    this.sel = { kind: "group", id: item.id };
    this.scheduleSave();
    return item.id;
  }

  addImage(src: string, x: number, y: number, w: number, h: number): string {
    const item: ImageItem = { id: uid(), x, y, w, h, src };
    this.overlay.images.push(item);
    this.sel = { kind: "image", id: item.id };
    this.scheduleSave();
    return item.id;
  }

  moveItem(kind: ItemKind, id: string, x: number, y: number): void {
    const it = this.find(kind, id);
    if (it) {
      it.x = Math.round(x);
      it.y = Math.round(y);
      this.scheduleSave();
    }
  }

  resizeItem(kind: ItemKind, id: string, w: number, h: number): void {
    const it = this.find(kind, id);
    if (it) {
      it.w = Math.max(60, Math.round(w));
      it.h = Math.max(40, Math.round(h));
      this.scheduleSave();
    }
  }

  setNoteText(id: string, text: string): void {
    const it = this.overlay.notes.find((n) => n.id === id);
    if (it) {
      it.text = text;
      this.scheduleSave();
    }
  }

  setGroupLabel(id: string, label: string): void {
    const it = this.overlay.groups.find((g) => g.id === id);
    if (it) {
      it.label = label;
      this.scheduleSave();
    }
  }

  removeItem(kind: ItemKind, id: string): void {
    const arr = this.array(kind);
    const i = arr.findIndex((it) => it.id === id);
    if (i >= 0) {
      arr.splice(i, 1);
      if (this.sel?.kind === kind && this.sel.id === id) this.sel = null;
      this.scheduleSave();
    }
  }

  item(kind: ItemKind, id: string): Rect | undefined {
    return this.find(kind, id);
  }

  selected(): Selection | null {
    return this.sel;
  }
  select(sel: Selection | null): void {
    this.sel = sel;
  }

  private array(kind: ItemKind): Rect[] {
    return kind === "note" ? this.overlay.notes : kind === "image" ? this.overlay.images : this.overlay.groups;
  }
  private find(kind: ItemKind, id: string): Rect | undefined {
    return this.array(kind).find((it) => it.id === id);
  }

  // --- whole-document save / load --------------------------------------------------------
  toDocument(): CodeboardDoc {
    return { version: 1, scope: this.scope, seed: this.seed, overlay: this.overlay };
  }

  setOverlay(overlay: Overlay): void {
    this.overlay = normalize(overlay);
    this.base = initialPositions(this.seed);
    this.save();
  }

  reset(): void {
    this.overlay = emptyOverlay();
    this.sel = null;
    this.save();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 200);
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.overlay));
    } catch {
      // storage full or unavailable — the on-screen layout still works this session.
    }
  }
}

function loadOverlay(key: string): Overlay {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyOverlay();
    return normalize(JSON.parse(raw) as Partial<Overlay>);
  } catch {
    return emptyOverlay();
  }
}

// Fill in any missing arrays/maps so older or imported overlays are safe to render.
function normalize(o: Partial<Overlay>): Overlay {
  return {
    boxes: o.boxes ?? {},
    edges: o.edges ?? {},
    collapsed: o.collapsed ?? {},
    view: o.view,
    notes: o.notes ?? [],
    images: o.images ?? [],
    groups: o.groups ?? [],
    docNotes: o.docNotes ?? {},
    // A board saved under the old inverted flags carries `hide*`. Its author's choice is what
    // matters, so translate rather than drop: `hideX: false` meant "show", and a board with
    // neither field is simply new and takes the current default (off).
    showDocs: o.showDocs ?? (o.hideDocs === undefined ? undefined : !o.hideDocs),
    showFunctions:
      o.showFunctions ?? (o.hideFunctions === undefined ? undefined : !o.hideFunctions),
    edgeMode: o.edgeMode,
  };
}

function uid(): string {
  return crypto.randomUUID();
}
