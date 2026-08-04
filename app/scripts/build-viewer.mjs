// Fold a finished `vite build` into ONE self-contained page: public/viewer.html.
//
// This is the template `export html` pours a board's document into. It is the app itself,
// bundled — not a second renderer — so an exported file can never drift from the live canvas.
// The alternative (writing a small read-only viewer) is exactly the kind of copy that starts
// identical and quietly stops matching.
//
// Everything the page needs is inlined, fonts included: an exported board is opened from disk,
// often on another machine, and a missing font file would silently change every box's width —
// the layout would come back subtly wrong, which is worse than obviously broken.
//
// No dependencies: the whole job is three substitutions over the built index.html.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(APP, "dist");
const OUT = join(APP, "public", "viewer.html");

const MIME = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

/** A built asset as a data: URI. `ref` is resolved the way a browser would resolve it. */
async function dataUri(ref, cssDir) {
  const ext = ref.slice(ref.lastIndexOf("."));
  const mime = MIME[ext];
  if (!mime) throw new Error(`no mime type for ${ref} — add it to MIME`);
  // Vite emits font refs RELATIVE to the stylesheet (`./inter-…woff2`), not as `/assets/…`.
  // Resolving against the wrong base is silent: the export keeps the original url, opens fine
  // on this machine (the file is still next door) and loses its fonts everywhere else — which
  // changes every box's width, so the layout comes back subtly wrong rather than visibly broken.
  const file = ref.startsWith("/") ? join(DIST, ref.slice(1)) : join(cssDir, ref);
  const bytes = await readFile(file);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Rewrite every url(…) in a stylesheet to a data: URI, except in-document references. */
async function inlineCssUrls(css, cssDir) {
  const refs = [
    ...new Set(
      [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
        .map((m) => m[1].trim())
        // `#id` points inside the document (an SVG filter); `data:` is already inlined
        .filter((r) => !r.startsWith("#") && !r.startsWith("data:") && !/^https?:/.test(r)),
    ),
  ];
  let out = css;
  for (const ref of refs) {
    out = out.split(ref).join(await dataUri(ref, cssDir));
  }
  return { css: out, count: refs.length };
}

/** `</script` inside the bundle would close the tag we are about to put it in. */
const safeForInlineScript = (js) => js.replace(/<\/script/gi, "<\\/script");

const html = await readFile(join(DIST, "index.html"), "utf8");

const cssRef = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/);
const jsRef = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"[^>]*><\/script>/);
if (!cssRef || !jsRef) {
  throw new Error("built index.html has no stylesheet/module tag — did `vite build` change shape?");
}

const cssFile = join(DIST, cssRef[1].replace(/^\//, ""));
const { css, count } = await inlineCssUrls(await readFile(cssFile, "utf8"), dirname(cssFile));
const js = safeForInlineScript(await readFile(join(DIST, jsRef[1].replace(/^\//, "")), "utf8"));

let viewer = html
  .replace(cssRef[0], `<style>\n${css}\n</style>`)
  .replace(jsRef[0], `<script type="module">\n${js}\n</script>`);

// The slot `export html` fills. Its absence is a build error, not something to paper over: an
// exported file without it would open as an empty canvas and look like a data-loss bug.
if (!/<script id="cartograph-doc" type="application\/json">/.test(viewer)) {
  throw new Error("index.html is missing the #cartograph-doc slot — export would have nowhere to write");
}

// Nothing in the viewer should reach for the network. `seed.json` is the dev fallback; a viewer
// that fetched it would show a default board instead of the document that was exported.
viewer = viewer.replace(
  "<title>",
  "<!-- Built by scripts/build-viewer.mjs from this app's own bundle. Do not edit by hand. -->\n    <title>",
);

await writeFile(OUT, viewer, "utf8");
const kb = (s) => `${Math.round(s / 1024)} KB`;
console.log(
  `wrote public/viewer.html — ${kb(viewer.length)} ` +
    `(js ${kb(js.length)}, css ${kb(css.length)}, ${count} assets inlined)`,
);
