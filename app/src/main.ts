import "@fontsource-variable/inter";
import type { CodeboardDoc, Seed, SeedNode } from "./model";
import { Store } from "./store";
import { LANG_STYLE, ORIGIN_STYLE, renderScene } from "./render";
import { wireInteractions } from "./interactions";
import { openMethodModal } from "./ui/modal";

const LAST_PATH_KEY = "cartograph.lastpath";

const app = document.getElementById("app")!;
const pathInput = document.getElementById("path") as HTMLInputElement;
const hint = document.getElementById("hint")!;
const legendEl = document.getElementById("legend")!;

let store: Store | undefined;
let byKey = new Map<string, SeedNode>();
// An exported file IS the viewer template, so it can re-export itself after a rearrange with no
// server and no network. Captured before the first render, while the DOM is still the empty shell.
let selfTemplate: string | undefined;

const rerender = () => {
  if (store) app.innerHTML = renderScene(store);
};

function mount(seed: Seed, scope: string): void {
  store = new Store(seed, scope);
  const fresh = !store.hasSavedView(); // a brand-new scan gets auto-fitted
  byKey = new Map(seed.nodes.map((n) => [n.key, n]));
  updateLegend(seed);
  updateLinesLabel();
  setStatus(nodeCounts(seed));
  rerender();
  if (fresh) requestAnimationFrame(fitToContent);
}

// Frame the whole drawing in the viewport (measured from what actually rendered, once the
// container has a size). Only called for a fresh scan or a reset — a board the user has
// already panned keeps its view.
function fitToContent(): void {
  if (!store) return;
  const rects = app.querySelectorAll<SVGRectElement>("#world .nd > rect");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  rects.forEach((r) => {
    const x = r.x.baseVal.value;
    const y = r.y.baseVal.value;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + r.width.baseVal.value);
    maxY = Math.max(maxY, y + r.height.baseVal.value);
  });
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const vw = app.clientWidth;
  const vh = app.clientHeight;
  if (!isFinite(minX) || vw < 50 || vh < 50 || spanX < 1 || spanY < 1) return;
  const pad = 50;
  const zoom = Math.min(1, Math.max(0.12, Math.min((vw - 2 * pad) / spanX, (vh - 2 * pad) / spanY)));
  store.setView({
    panX: (vw - spanX * zoom) / 2 - minX * zoom,
    panY: (vh - spanY * zoom) / 2 - minY * zoom,
    zoom,
  });
  rerender();
}

function nodeCounts(seed: Seed): string {
  const fns = seed.nodes.filter((n) => n.kind === "function").length;
  const ext = seed.nodes.filter((n) => n.kind === "stdlib" || n.kind === "library").length;
  const cls = seed.nodes.length - fns - ext;
  const parts = [`${cls} class${cls === 1 ? "" : "es"}`];
  if (ext) parts.push(`${ext} outside`);
  if (fns) parts.push(`${fns} function${fns === 1 ? "" : "s"}`);
  parts.push(`${seed.relations.length} relation${seed.relations.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function updateLinesLabel(): void {
  const btn = document.getElementById("lines")!;
  btn.textContent = store?.edgeMode() === "orthogonal" ? "lines: 90°" : "lines: curved";
}

const LEGEND: Record<string, { glyph: string; color: string; label: string }> = {
  inherits: { glyph: "▷", color: "#a86bff", label: "inherits" },
  implements: { glyph: "▷", color: "#a86bff", label: "implements (dashed)" },
  composition: { glyph: "◆", color: "#f4c26f", label: "composition — owns" },
  aggregation: { glyph: "◇", color: "#f4c26f", label: "aggregation — has-many" },
  association: { glyph: "→", color: "#5ec8a0", label: "association — uses" },
  dependency: { glyph: "⇢", color: "#8894c4", label: "dependency — transient" },
  import: { glyph: "⇢", color: "#8894c4", label: "import" },
  contract: { glyph: "⇠⇢", color: "#db2777", label: "cross-language" },
  calls: { glyph: "→", color: "#2e78c9", label: "calls (function)" },
  instanceof: { glyph: "⇢", color: "#c2410c", label: "instance of — metaclass" },
};
const LEGEND_ORDER = [
  "inherits",
  "implements",
  "instanceof",
  "composition",
  "aggregation",
  "association",
  "dependency",
  "import",
  "contract",
  "calls",
];

function updateLegend(seed: Seed): void {
  const present = new Set(seed.relations.map((r) => r.kind));
  const rows = LEGEND_ORDER.filter((k) => present.has(k))
    .map((k) => {
      const e = LEGEND[k]!;
      return `<div class="lg-row"><span class="lg-sw" style="color:${e.color}">${e.glyph}</span>${e.label}</div>`;
    })
    .join("");
  // Which languages are on the board, so the stripe / badge colours are decoded.
  const langs = [...new Set(seed.nodes.map((n) => n.lang))]
    .filter((l) => LANG_STYLE[l])
    .sort();
  const langRows = langs
    .map((l) => {
      const e = LANG_STYLE[l]!;
      return `<div class="lg-row"><span class="lg-sw" style="color:${e.color}">■</span>${e.label}</div>`;
    })
    .join("");
  // Where outside-the-scan classes come from (standard library vs installed package).
  const kinds = new Set(seed.nodes.map((n) => n.kind));
  const originRows = Object.entries(ORIGIN_STYLE)
    .filter(([k]) => kinds.has(k))
    .map(([, e]) => `<div class="lg-row"><span class="lg-sw" style="color:${e.color}">■</span>${e.label}</div>`)
    .join("");
  const sections = [rows, originRows, langRows].filter(Boolean);
  legendEl.innerHTML = sections.join(`<div class="lg-sep"></div>`);
  legendEl.classList.toggle("on", sections.length > 0);
}

async function boot(): Promise<void> {
  wireInteractions(app, () => store!, rerender, (nodeKey, methodName) => {
    const node = byKey.get(nodeKey);
    const method = node?.methods.find((m) => m.name === methodName);
    if (node && method) openMethodModal(node, method);
  });

  document.getElementById("reset")!.addEventListener("click", () => {
    if (store) {
      store.reset();
      rerender();
      requestAnimationFrame(fitToContent);
    }
  });
  document.getElementById("scan")!.addEventListener("click", () => void scan());
  document.getElementById("browse")!.addEventListener("click", () => void browse());
  pathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void scan();
  });

  document.getElementById("add-note")!.addEventListener("click", () => {
    if (!store) return;
    const c = viewCenterWorld();
    store.addNote(c.x - 90, c.y - 60);
    rerender();
  });
  document.getElementById("add-group")!.addEventListener("click", () => {
    if (!store) return;
    const c = viewCenterWorld();
    store.addGroup(c.x - 160, c.y - 120);
    rerender();
  });
  document.getElementById("docs")!.addEventListener("click", () => {
    if (store) {
      store.toggleDocs();
      rerender();
    }
  });
  document.getElementById("lines")!.addEventListener("click", () => {
    if (store) {
      store.toggleEdgeMode();
      updateLinesLabel();
      rerender();
    }
  });
  document.getElementById("fn")!.addEventListener("click", () => {
    if (store) {
      store.toggleFunctions();
      rerender();
    }
  });
  document.getElementById("save")!.addEventListener("click", saveDoc);
  document.getElementById("export-html")!.addEventListener("click", () => void exportHtml());
  const fileInput = document.getElementById("file") as HTMLInputElement;
  document.getElementById("load")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void loadDoc(f);
    fileInput.value = "";
  });

  window.addEventListener("paste", (e) => {
    if (!store) return;
    for (const it of e.clipboardData?.items ?? []) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          void addImageFromFile(f);
        }
      }
    }
  });
  app.addEventListener("dragover", (e) => e.preventDefault());
  app.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (store && f && f.type.startsWith("image/")) {
      void addImageFromFile(f, screenToWorld(e.clientX, e.clientY));
    }
  });

  // An exported board carries its own document, and it outranks everything: opening that file
  // must show the layout it was exported with, not re-scan a folder that may have moved on (or
  // not exist on this machine at all). The controls that need the dev server are hidden — an
  // exported file is a document, not a scanner.
  const inlined = embeddedDoc();
  if (inlined) {
    document.body.classList.add("standalone");
    selfTemplate = document.documentElement.outerHTML; // still pristine: nothing rendered yet
    mountDoc(inlined, "from this file");
    return;
  }

  // ?scan=/path (from the `cartograph` CLI) wins over the last-used folder.
  const queryScan = new URLSearchParams(location.search).get("scan");
  const start = queryScan ?? localStorage.getItem(LAST_PATH_KEY);
  if (start) {
    pathInput.value = start;
    await scan();
  }
  if (!store) await loadDefault();
}

async function browse(): Promise<void> {
  setStatus("choose a folder in the dialog…");
  try {
    const res = await fetch("/api/pick");
    if (res.status === 204) {
      setStatus("cancelled");
      return;
    }
    const data = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !data.path) throw new Error(data.error ?? "pick failed");
    pathInput.value = data.path;
    await scan();
  } catch (e) {
    setStatus((e as Error).message || "pick failed");
  }
}

async function scan(): Promise<void> {
  const path = pathInput.value.trim();
  if (!path) return;
  setStatus(`scanning ${path} …`);
  try {
    const res = await fetch(`/api/scan?path=${encodeURIComponent(path)}`);
    const data = (await res.json()) as Seed & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "scan failed");
    localStorage.setItem(LAST_PATH_KEY, path);
    pathInput.classList.remove("err");
    mount(data, path);
    setStatus(nodeCounts(data));
  } catch (e) {
    pathInput.classList.add("err");
    setStatus((e as Error).message || "scan failed");
  }
}

async function loadDefault(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}seed.json`);
    if (!res.ok) throw new Error();
    mount((await res.json()) as Seed, "default");
  } catch {
    app.innerHTML =
      `<p style="padding:24px;color:#9d96c7">Type a Python project folder above ` +
      `and hit <b>scan folder</b>.</p>`;
  }
}

function setStatus(msg: string): void {
  hint.textContent = msg;
}

function viewCenterWorld(): { x: number; y: number } {
  const v = store!.view();
  return { x: (app.clientWidth / 2 - v.panX) / v.zoom, y: (app.clientHeight / 2 - v.panY) / v.zoom };
}

function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const v = store!.view();
  const rect = app.getBoundingClientRect();
  return { x: (clientX - rect.left - v.panX) / v.zoom, y: (clientY - rect.top - v.panY) / v.zoom };
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function saveDoc(): void {
  if (!store) return;
  const json = JSON.stringify(store.toDocument(), null, 2);
  download(new Blob([json], { type: "application/json" }), `cartograph-${safeName(store.scope)}.json`);
}

// The one place a saved document becomes the live board. `load` (a .json) and an exported .html
// (its inlined copy) both arrive here, so the two cannot restore a layout differently — which is
// the entire promise of the export.
function mountDoc(doc: CodeboardDoc, origin: string): void {
  if (!doc.seed || !doc.overlay) throw new Error("not a cartograph file");
  store = new Store(doc.seed, doc.scope || "imported");
  store.setOverlay(doc.overlay);
  // A saved view is the layout and must be restored untouched. Its ABSENCE is the case that bites:
  // a board exported before the user ever panned has no view to restore, and without a fit it
  // opens wherever the auto-layout happened to land — off-screen often enough to read as empty.
  const fresh = !store.hasSavedView();
  byKey = new Map(doc.seed.nodes.map((n) => [n.key, n]));
  pathInput.value = doc.scope || "";
  updateLegend(doc.seed);
  updateLinesLabel();
  rerender();
  if (fresh) requestAnimationFrame(fitToContent);
  setStatus(`${doc.seed.nodes.length} classes ${origin}`);
}

async function loadDoc(file: File): Promise<void> {
  try {
    mountDoc(JSON.parse(await file.text()) as CodeboardDoc, "loaded from file");
  } catch (e) {
    setStatus((e as Error).message || "load failed");
  }
}

// A document inlined by `export html`; `null` in the live app.
function embeddedDoc(): CodeboardDoc | null {
  const text = document.getElementById("cartograph-doc")?.textContent;
  if (!text) return null;
  try {
    const doc = JSON.parse(text) as CodeboardDoc | null;
    return doc?.seed ? doc : null;
  } catch {
    return null;
  }
}

// Export = this board's document poured into the built single-file viewer. The viewer is the app
// itself, bundled — not a second renderer — so an exported file cannot drift from the live canvas.
async function exportHtml(): Promise<void> {
  if (!store) return;
  let template: string;
  if (selfTemplate) {
    template = selfTemplate; // re-exporting an exported file: this page is already the template
  } else {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}viewer.html`);
      if (!res.ok) throw new Error();
      template = await res.text();
    } catch {
      setStatus("no viewer template yet — run `npm run build:viewer` once, then export again");
      return;
    }
  }
  // Escaping `<` matters: a docstring or a method's source can contain `</script>`, which would
  // otherwise close the tag early and leave a truncated document that still parses as JSON.
  const payload = JSON.stringify(store.toDocument()).replace(/</g, "\\u003c");
  const filled = template.replace(
    /(<script id="cartograph-doc" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_m, open: string, close: string) => open + payload + close,
  );
  if (filled === template) {
    setStatus("that viewer template has no document slot — rebuild it");
    return;
  }
  download(new Blob([filled], { type: "text/html" }), `cartograph-${safeName(store.scope)}.html`);
  setStatus("exported — open that file anywhere and the layout comes back");
}

async function addImageFromFile(file: File, at?: { x: number; y: number }): Promise<void> {
  if (!store) return;
  const img = await loadImage(await fileToDataURL(file));
  const max = 360;
  let w = img.naturalWidth || 240;
  let h = img.naturalHeight || 180;
  if (w > max) {
    h = Math.round((h * max) / w);
    w = max;
  }
  // Re-encode at display size so a big screenshot doesn't blow the storage quota.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const src = ctx ? (ctx.drawImage(img, 0, 0, w, h), canvas.toDataURL("image/jpeg", 0.85)) : img.src;
  const p = at ?? viewCenterWorld();
  store.addImage(src, Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
  rerender();
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("image decode failed"));
    i.src = src;
  });
}

function safeName(s: string): string {
  return (s.split("/").pop() || "board").replace(/[^\w.-]/g, "_");
}

void boot();
